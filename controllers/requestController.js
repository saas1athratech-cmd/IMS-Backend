const Request = require('../model/Request');
const Item = require('../model/item');
const User = require('../model/user');
const Stock = require('../model/Stock');
const sendEmail = require('../utils/sendEmail');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Dispatch = require('../model/Dispatch')
const Sale = require('../model/sales')
const mongoose = require('mongoose');
const multer = require('multer');


// Create upload directory if not exists
const uploadDir = path.join(__dirname, '..', 'uploads', 'invoices');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `invoice_${req.params.id}_${Date.now()}${ext}`);
  }
});

// Filter only PDFs or images (if needed)
const fileFilter = (req, file, cb) => {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only PDF, JPG, or PNG files are allowed'), false);
};

// Multer upload middleware (expecting field name "invoice")
const upload = multer({ storage, fileFilter });


exports.uploadInvoice = [
  upload.single('invoice'),
  async (req, res) => {
    try {
      if (!['admin', 'user'].includes(req.user.role)) {
        return res.status(403).json({ message: 'Unauthorized to upload invoice' });
      }

      const request = await Request.findById(req.params.id);
      if (!request) return res.status(404).json({ message: 'Request not found' });

      // 🟡 Admin rule — only after approval
      if (req.user.role === 'admin' && request.status !== 'approved') {
        return res.status(400).json({ message: 'Invoice can only be uploaded after approval' });
      }

      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded. Use field name "invoice".' });
      }

      request.invoice = {
        filePath: `/uploads/invoices/${req.file.filename}`,
        fileType: req.file.mimetype.includes('pdf') ? 'pdf' : 'image',
        uploadedBy: req.user._id,
      };

      // 🟡 Update status
      request.status = req.user.role === 'admin'
        ? 'invoice_uploaded'
        : 'invoice_uploaded_by_user';

      request.timestamps = request.timestamps || {};
      request.timestamps.invoiceUploaded = new Date();

      await request.save();

      res.status(200).json({
        message: `${req.user.role === 'admin' ? 'Admin' : 'User'} invoice uploaded successfully`,
        invoicePath: request.invoice.filePath,
      });

    } catch (err) {
      console.error('❌ Upload Invoice Error:', err);
      res.status(500).json({ message: 'Failed to upload invoice', error: err.message });
    }
  }
];




// Generate token like: REQ-2025-00001
const generateToken = (id) => {
  return `REQ-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;
};

exports.createRequest = async (req, res) => {
  try {
    const { itemName, quantity, requiredDate, priority, Decofitem, companyName } = req.body;

    if (!itemName || !quantity || quantity <= 0 || !companyName) {
      return res.status(400).json({ message: 'Item name, valid quantity, and company name are required' });
    }

    // ✅ Logged-in user
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // ✅ Find company by name (case insensitive)
    const company = await User.findOne({
      name: { $regex: new RegExp(`^${companyName}$`, 'i') },
      role: { $in: ['admin', 'superadmin'] }
    });

    if (!company) {
      return res.status(404).json({ message: `Company "${companyName}" not found or not authorized` });
    }

    // ✅ Create new request
    const request = new Request({
      user: user._id,
      itemName,
      quantity,
      requiredDate,
      Decofitem,
      priority: priority || 'Medium',
      deliveryAddress: user.location,
      company: company._id // ✅ link to found company
    });

    const saved = await request.save();

    res.status(201).json({
      message: `Request successfully submitted to company "${company.name}"`,
      request: saved
    });

  } catch (err) {
    console.error('❌ Request Create Error:', err);
    res.status(500).json({ message: 'Failed to submit request', error: err.message });
  }
};



exports.getAllRequests = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === 'admin') {
      // ✅ Admin will only see requests sent to their company
      filter.company = req.user._id;
    } else if (req.user.role === 'user') {
      // ✅ User sees only their own requests
      filter.user = req.user._id;
    }

    const requests = await Request.find(filter)
      .populate('user', 'name email branch')
      .populate('company', 'name email') // show which company it's assigned to
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching requests', error: err.message });
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    // 🔹 Logged-in user ka ID lo (JWT se)
    const userId = req.user._id;

    console.log('🟢 Fetching requests for user:', userId);

    // 🔹 Fetch all requests created by this user
    const myRequests = await Request.find({ user: userId })
      .sort({ createdAt: -1 }) // Latest first
      .lean();

    if (!myRequests || myRequests.length === 0) {
      return res.status(200).json({ message: 'No requests found for this user.', data: [] });
    }

    // 🔹 Send response
    res.status(200).json({
      message: 'User requests fetched successfully',
      count: myRequests.length,
      requests: myRequests
    });

  } catch (err) {
    console.error('❌ Error fetching user requests:', err);
    res.status(500).json({ message: 'Error fetching your requests', error: err.message });
  }
};

exports.approveRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can approve requests' });
    }

    const request = await Request.findById(req.params.id).populate('user company');
    if (!request) return res.status(404).json({ message: 'Request not found' });

    // ✅ Check company ownership
    if (request.company._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not authorized to approve this request' });
    }

    if (request.status !== 'requested')
      return res.status(400).json({ message: 'Request already processed' });

    request.status = 'approved';
    request.timestamps.approved = new Date();
    request.token = `REQ-${new Date().getFullYear()}-${String(request._id).slice(-5).toUpperCase()}`;
    await request.save();

    res.json({ message: 'Request approved successfully', request });
  } catch (err) {
    console.error('❌ Approval error:', err);
    res.status(500).json({ message: 'Approval failed', error: err.message });
  }
};

// 🔹 REJECT REQUEST (Only Admin)
exports.rejectRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin')
      return res.status(403).json({ message: 'Only admin can reject requests' });

    const request = await Request.findById(req.params.id).populate('user company');
    if (!request) return res.status(404).json({ message: 'Request not found' });

    // ✅ Check company ownership
    if (request.company._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not authorized to reject this request' });
    }

    if (request.status !== 'requested')
      return res.status(400).json({ message: 'Request already processed' });

    const { reason } = req.body;

    request.status = 'rejected';
    request.rejectionReason = reason || 'No reason provided';
    await request.save();

    res.json({ message: 'Request rejected successfully', request });
  } catch (err) {
    console.error('❌ Rejection error:', err);
    res.status(500).json({ message: 'Rejection failed', error: err.message });
  }
};

// 🔹 DISPATCH REQUEST (Only Admin)
exports.dispatchRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can dispatch requests' });
    }

    const request = await Request.findById(req.params.id)
      .populate('user', 'name email')
      .populate('company', 'name');

    if (!request) return res.status(404).json({ message: 'Request not found' });

    if (!['approved', 'invoice_uploaded', 'invoice_uploaded_by_user'].includes(request.status)) {
      return res.status(400).json({
        message: "Request must be approved or invoiced before dispatch"
      });
    }

    const { quantity, itemName, reference } = request;

    
    if (!itemName || typeof itemName !== "string") {
      return res.status(400).json({
        message: "Invalid itemName received from FR → IMS",
        received_itemName: itemName
      });
    }

    const adminUser = await User.findById(req.user._id);
    const normalizedItemName = itemName.trim().toLowerCase();
    const item = await Item.findOne({ name: normalizedItemName });

    const adminStock = await Stock.findOne({
      item: item._id,
      ownerId: adminUser._id,
      ownerType: 'admin'
    });

    if (!adminStock || adminStock.quantity < quantity) {
      return res.status(400).json({ message: 'Not enough admin stock' });
    }

    adminStock.quantity -= quantity;
    await adminStock.save();

    let userStock = await Stock.findOne({
      item: item._id,
      ownerId: request.user._id,
      ownerType: 'user'
    });

    if (userStock) {
      userStock.quantity += quantity;
    } else {
      userStock = new Stock({
        item: item._id,
        quantity,
        rate: adminStock.rate,
        branch: adminStock.branch,
        ownerId: request.user._id,
        ownerType: 'user',
        requestId: request._id
      });
    }
    await userStock.save();

    const dispatchRecord = new Dispatch({
      requestId: request._id,
      item: item._id,
      quantity,
      rate: adminStock.rate,
      branch: adminStock.branch,

      dispatchedBy: adminUser._id,
      dispatchedTo: request.user._id,
      dispatchedAt: new Date()
    });
    await dispatchRecord.save();

    if (reference?.workId && reference?.partId) {
      const frToken = jwt.sign({ system: "IMS" }, process.env.FR_JWT_SECRET);

      await axios.patch(
        `${process.env.FR_BASE_URL}/api/approverejectbyadmin`,
        {
          workId: reference.workId,
          partId: reference.partId,
          status: "ims_dispatched"
        },
        { headers: { Authorization: `Bearer ${frToken}` } }
      );

      console.log("FR Updated Successfully ");
    }

    request.status = 'dispatched';
    request.timestamps = request.timestamps || {};
    request.timestamps.dispatched = new Date();
    await request.save();

    res.status(200).json({
      message: "Request dispatched & synced with FR system",
      dispatchRecord,
      request,
      adminRemainingStock: adminStock.quantity
    });

  } catch (err) {
    console.error("❌ Dispatch error:", err);
    res.status(500).json({ message: err.message });
  }
};





exports.getDispatchCount = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // 🔹 Count all requests with status 'dispatched'
    const dispatchCount = await Request.countDocuments({ status: 'dispatched' });

    res.status(200).json({
      message: 'Total number of dispatched requests',
      totalDispatched: dispatchCount
    });

  } catch (err) {
    console.error('❌ Error fetching dispatch count:', err);
    res.status(500).json({ message: 'Failed to fetch dispatch count', error: err.message });
  }
};


exports.getDispatchSummary = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // 🔹 Count all dispatched requests
    const dispatchedRequests = await Request.find({ status: 'dispatched' })
      .populate('user', 'name email branch') // user details
      .populate('item', 'name rate')          // item details including rate/price
      .lean(); 

    const totalDispatched = dispatchedRequests.length;

    // 🔹 Map details for response
    const dispatchDetails = dispatchedRequests.map(req => {
      const quantity = typeof req.quantity === 'number' ? req.quantity : 0;
      const rate = typeof req.item?.rate === 'number' ? req.item.rate : 0;
      const value = quantity * rate;

      return {
        requestId: req._id,
        token: req.token || null,
        itemName: req.itemName || req.item?.name || 'Unknown',
        quantity,
        rate: rate.toFixed(2),
        value: value.toFixed(2),
        priority: req.priority,
        requestedBy: req.user?.name || 'Unknown',
        userEmail: req.user?.email || '-',
        branch: req.user?.branch || '-',
        dispatchedAt: req.timestamps?.dispatched || null
      };
    });

    res.status(200).json({
      message: 'Dispatched requests summary',
      totalDispatched,
      dispatchDetails
    });

  } catch (err) {
    console.error('❌ Error fetching dispatch summary:', err);
    res.status(500).json({ message: 'Failed to fetch dispatch summary', error: err.message });
  }
};





exports.getDispatchSummaryPDF = async (req, res) => {
  try {
    // ✅ Access Control
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // ✅ Filter: Admin gets only their company's dispatched requests
    const filter = { status: 'dispatched' };
    if (req.user.role === 'admin') {
      filter.company = req.user._id; // only admin’s company data
    }

    // ✅ Fetch dispatched requests with related data
    const dispatchedRequests = await Request.find(filter)
      .populate('item', 'name')
      .populate('user', 'name branch')
      .populate('company', 'name email')
      .lean();

    if (!dispatchedRequests.length) {
      return res.status(200).json({ message: 'No dispatched records found' });
    }

    // ✅ Setup PDF document
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'portrait' });
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    const fileName = `DispatchSummary_${Date.now()}.pdf`;
    const filePath = path.join(tempDir, fileName);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // ✅ Header Section
    doc.fontSize(16).text('DISPATCH SUMMARY REPORT', { align: 'center' });
    if (req.user.role === 'admin') {
      doc.fontSize(13).text(`Company: ${req.user.name}`, { align: 'center' });
    } else {
      doc.fontSize(13).text(`Company: All Companies`, { align: 'center' });
    }
    doc.fontSize(12).text(`Generated On: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // ✅ Table Header
    doc.fontSize(10).font('Helvetica-Bold');
    const headers = [
      { label: 'Item', x: 30 },
      { label: 'Qty', x: 130 },
      { label: 'Rate', x: 180 },
      { label: 'Value', x: 240 },
      { label: 'Dispatched To', x: 310 },
      { label: 'Branch', x: 420 },
      { label: 'Requested By', x: 490 },
      { label: 'Date', x: 560 }
    ];

    headers.forEach(h => doc.text(h.label, h.x, doc.y, { continued: false }));
    doc.moveDown(0.5);
    doc.moveTo(30, doc.y).lineTo(580, doc.y).stroke();

    doc.font('Helvetica').fontSize(9);

    // ✅ Table Content
    for (const record of dispatchedRequests) {
      const y = doc.y + 5;
      const itemName = record.item?.name || record.itemName || 'Unknown';
      const quantity = record.quantity || 0;

      // 🔹 Fetch stock info for rate/value (based on branch)
      const stock = await Stock.findOne({
        item: record.item?._id,
        branch: record.user?.branch
      }).lean();

      const rate = stock?.rate || 0;
      const value = quantity * rate;
      const dispatchedTo = record.user?.name || '-';
      const branch = record.user?.branch || '-';
      const requestedBy = record.company?.name || '-';
      const date = record.timestamps?.dispatched
        ? new Date(record.timestamps.dispatched).toLocaleDateString()
        : 'N/A';

      doc.text(itemName, 30, y);
      doc.text(quantity.toString(), 130, y);
      doc.text(rate.toFixed(2), 180, y);
      doc.text(value.toFixed(2), 240, y);
      doc.text(dispatchedTo, 310, y, { width: 100 });
      doc.text(branch, 420, y, { width: 60 });
      doc.text(requestedBy, 490, y, { width: 60 });
      doc.text(date, 560, y);
      doc.moveDown();
    }

    // ✅ Footer Summary
    doc.moveDown(2);
    const totalCount = dispatchedRequests.length;
    const totalValue = dispatchedRequests.reduce((acc, r) => {
      const qty = r.quantity || 0;
      const rate = r.item?.rate || 0;
      return acc + qty * rate;
    }, 0);

    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`Total Dispatches: ${totalCount}`, { align: 'left' });
    doc.text(`Total Value: ₹${totalValue.toFixed(2)}`, { align: 'left' });

    // ✅ End and send
    doc.end();

    writeStream.on('finish', () => {
      res.download(filePath, fileName, err => {
        if (err) console.error('❌ PDF download error:', err);
        fs.unlink(filePath, () => {}); // delete temp file after download
      });
    });

  } catch (err) {
    console.error('❌ Error generating dispatch PDF:', err);
    res.status(500).json({ message: 'Failed to generate dispatch PDF', error: err.message });
  }
};
exports.getOrderStatusReport = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const requests = await Request.find()
      .populate('user', 'name branch')
      .lean();

    const reportData = requests.map(req => ({
      requestId: req._id,
      token: req.token || 'Not Assigned',
      itemName: req.itemName,
      quantity: req.quantity,
      requestedBy: req.user?.name || 'Unknown',
      branch: req.user?.branch || '-',
      status: req.status, // requested / approved / dispatched / rejected
      requestedAt: req.createdAt ? new Date(req.createdAt).toLocaleString() : '-',
      approvedAt: req.timestamps?.approved ? new Date(req.timestamps.approved).toLocaleString() : '-',
      dispatchedAt: req.timestamps?.dispatched ? new Date(req.timestamps.dispatched).toLocaleString() : '-',
      rejectedAt: req.rejectionReason ? (req.timestamps?.rejected || 'N/A') : '-',
      rejectionReason: req.rejectionReason || '-'
    }));

    res.status(200).json({
      message: "Order Status Report",
      total: reportData.length,
      report: reportData
    });

  } catch (err) {
    console.error('❌ Error in Order Status Report:', err);
    res.status(500).json({ message: 'Failed to fetch order status report', error: err.message });
  }
};


exports.addSale = async (req, res) => {
  try {
    const { customerName, customerEmail, customerAddress, item, quantity, price } = req.body;

    // ✅ Validate input
    if (!item || !quantity || quantity <= 0) {
      return res.status(400).json({ message: 'Item and valid quantity required' });
    }

    // ✅ Check user stock
    const userStock = await Stock.findOne({
      item,
      ownerId: req.user.id,
      ownerType: 'user'
    });

    if (!userStock || userStock.quantity < quantity) {
      return res.status(400).json({
        message: `Insufficient stock. Available: ${userStock?.quantity || 0}`
      });
    }

    // ✅ Handle Invoice Upload (optional)
    let invoiceData = null;
    if (req.file) {
      invoiceData = {
        filePath: `/uploads/invoices/${req.file.filename}`,
        fileType: req.file.mimetype.includes('pdf') ? 'pdf' : 'image',
        uploadedAt: new Date()
      };
    }

    // ✅ Create Sale record
    const sale = new Sale({
      userId: req.user.id,
      customerName,
      customerEmail,
      customerAddress,
      item,
      quantity,
      price,
      totalValue: quantity * price,
      invoice: invoiceData
    });

    await sale.save();

    // ✅ Deduct quantity from stock
    userStock.quantity -= quantity;
    await userStock.save();

    // ✅ Response
    res.status(201).json({
      message: 'Sale added successfully with invoice info',
      sale,
      remainingStock: userStock.quantity
    });

  } catch (err) {
    console.error('❌ Sale error:', err);
    res.status(500).json({ message: 'Failed to add sale', error: err.message });
  }
};


exports.getSales = async (req, res) => {
  try {
    // Only logged-in user's sales
    const sales = await Sale.find({ userId: req.user.id })
      .populate('item', 'name') // show item name
      .sort({ saleDate: -1 })   // latest first
      .lean();

    if (!sales.length) {
      return res.status(200).json({
        message: 'No sales records found',
        count: 0,
        sales: []
      });
    }

    // Clean & formatted data
    const formattedSales = sales.map(sale => ({
      _id: sale._id,
      customerName: sale.customerName,
      customerEmail: sale.customerEmail || '-',
      customerAddress: sale.customerAddress || '-',
      itemName: sale.item?.name || 'Unknown',
      quantity: sale.quantity,
      price: sale.price,
      totalAmount: sale.totalAmount,
      saleDate: new Date(sale.saleDate).toLocaleDateString(),
      invoice: sale.invoice?.filePath 
        ? {
            filePath: sale.invoice.filePath,
            fileType: sale.invoice.fileType,
            uploadedAt: sale.invoice.uploadedAt
              ? new Date(sale.invoice.uploadedAt).toLocaleString()
              : null
          }
        : null
    }));

    res.status(200).json({
      message: 'Sales fetched successfully',
      count: formattedSales.length,
      sales: formattedSales
    });
  } catch (err) {
    console.error('❌ Error fetching sales:', err);
    res.status(500).json({ message: 'Failed to fetch sales', error: err.message });
  }
};


exports.downloadSalesPdf = async (req, res) => {
  try {
    const sales = await Sale.find({ userId: req.user.id })
      .populate('item', 'name')
      .sort({ saleDate: -1 });

    if (!sales.length)
      return res.status(404).json({ message: 'No sales found to generate report' });

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="sales_report.pdf"');
    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(18).text('SALES REPORT', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'right' });
    doc.moveDown(1);

    // Table
    const startX = 40;
    const tableTop = doc.y + 10;
    const col = { customer: 100, item: 100, qty: 50, price: 60, total: 70, date: 100 };
    const X = {
      customer: startX,
      item: startX + col.customer,
      qty: startX + col.customer + col.item,
      price: startX + col.customer + col.item + col.qty,
      total: startX + col.customer + col.item + col.qty + col.price,
      date: startX + col.customer + col.item + col.qty + col.price + col.total
    };

    // Header row
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('Customer', X.customer, tableTop);
    doc.text('Item', X.item, tableTop);
    doc.text('Qty', X.qty, tableTop, { align: 'right' });
    doc.text('Price', X.price, tableTop, { align: 'right' });
    doc.text('Total', X.total, tableTop, { align: 'right' });
    doc.text('Date', X.date, tableTop);
    doc.moveTo(startX, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    // Rows
    doc.font('Helvetica').fontSize(11);
    let y = tableTop + 25;
    let grandTotal = 0;

    for (const sale of sales) {
      doc.text(sale.customerName, X.customer, y);
      doc.text(sale.item?.name || '-', X.item, y);
      doc.text(String(sale.quantity), X.qty, y, { align: 'right' });
      doc.text(sale.price.toFixed(2), X.price, y, { align: 'right' });
      doc.text(sale.totalAmount.toFixed(2), X.total, y, { align: 'right' });
      doc.text(new Date(sale.saleDate).toLocaleDateString(), X.date, y);
      y += 20;
      grandTotal += sale.totalAmount;
    }

    doc.moveTo(startX, y).lineTo(550, y).stroke();
    doc.font('Helvetica-Bold').fontSize(13);
    doc.text(`Grand Total (₹): ${grandTotal.toFixed(2)}`, startX, y + 10, { align: 'right' });
    doc.end();
  } catch (err) {
    console.error('❌ Sales PDF error:', err);
    res.status(500).json({ message: 'Failed to generate PDF', error: err.message });
  }
};



exports.getInvoice = async (req, res) => {
  try {
    let { id, type } = req.params; // type = "request" or "sale"

    let record;

    if (type === 'sale') {
      record = await Sale.findById(id).populate('userId');
      if (!record) return res.status(404).json({ message: 'Sale not found.' });
    } else {
      record = await Request.findById(id).populate('user');
      if (!record) return res.status(404).json({ message: 'Request not found.' });
    }

    if (!record.invoice?.filePath)
      return res.status(404).json({ message: 'Invoice not uploaded yet.' });

    if (
      req.user.role !== 'admin' &&
      (record.userId?._id || record.user?._id)?.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Unauthorized access.' });
    }

    const invoicePath = path.join(__dirname, '..', record.invoice.filePath.replace(/^\/+/, ''));
    if (!fs.existsSync(invoicePath))
      return res.status(404).json({ message: 'Invoice file missing on server.' });

    res.download(invoicePath);
  } catch (err) {
    console.error('❌ Invoice fetch error:', err);
    res.status(500).json({ message: 'Error fetching invoice', error: err.message });
  }
};


exports.getAllDispatches = async (req, res) => {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role))
      return res.status(403).json({ message: 'Unauthorized' });

    const filter = { "dispatchHistory.0": { $exists: true } };
    if (req.user.role === 'admin') {
      filter.company = req.user._id; 
    }

    const requests = await Request.find(filter)
      .populate('company', 'name email phone')
      .populate('user', 'name email branch location')
      .populate('item', 'name')
      .populate('dispatchHistory.dispatchedBy', 'name email role')
      .populate('dispatchHistory.dispatchedTo', 'name email branch')
      .lean();

    if (!requests.length)
      return res.status(200).json({ message: 'No dispatch records found', totalDispatches: 0, dispatches: [] });

    const allDispatches = [];

    requests.forEach(reqDoc => {
      reqDoc.dispatchHistory.forEach(record => {
        allDispatches.push({
          requestId: reqDoc._id,
          token: reqDoc.token || '-',
          companyName: reqDoc.company?.name || 'Unknown Company',
          itemName: reqDoc.itemName || reqDoc.item?.name || 'Unknown',
          quantity: record.quantity || 0,
          rate: record.rate || 0,
          value: (record.quantity * record.rate).toFixed(2),
          branch: record.branch || reqDoc.user?.branch || '-',
          dispatchedAt: record.dispatchedAt || '-',
          dispatchedBy: record.dispatchedBy?.name || 'Admin',
          dispatchedTo: record.dispatchedTo?.name || reqDoc.user?.name || 'User',
          dispatchedToEmail: record.dispatchedTo?.email || '-',
          deliveryLocation: reqDoc.user?.location || '-',
          priority: reqDoc.priority || 'Medium'
        });
      });
    });

    const sortedDispatches = allDispatches.sort(
      (a, b) => new Date(b.dispatchedAt) - new Date(a.dispatchedAt)
    );

    res.status(200).json({
      message: 'All dispatch records fetched successfully',
      companyView: req.user.role === 'superadmin' ? 'All Companies' : req.user.name,
      totalDispatches: sortedDispatches.length,
      dispatches: sortedDispatches
    });
  } catch (err) {
    console.error('❌ Dispatch fetch error:', err);
    res.status(500).json({ message: 'Failed to fetch dispatch records', error: err.message });
  }
};
exports.getSystemOverview = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin')
      return res.status(403).json({ message: 'Only superadmin can view system overview' });

    const totalCompanies = await User.countDocuments({ role: 'admin' });
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalRequests = await Request.countDocuments();
    const totalDispatches = await Request.countDocuments({ status: 'dispatched' });
    const totalSales = await Sale.countDocuments();

    res.status(200).json({
      message: 'System overview fetched successfully',
      summary: {
        totalCompanies,
        totalUsers,
        totalRequests,
        totalDispatches,
        totalSales
      }
    });
  } catch (err) {
    console.error('❌ System overview error:', err);
    res.status(500).json({ message: 'Failed to fetch overview', error: err.message });
  }
};


exports.superAdminMonitor = async (req, res) => {
  try {
  
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied. Only superadmin can access this dashboard.' });
    }

  
    const [
      totalCompanies,
      totalUsers,
      totalRequests,
      totalApprovedRequests,
      totalRejectedRequests,
      totalDispatchedRequests,
      totalSales
    ] = await Promise.all([
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'user' }),
      Request.countDocuments(),
      Request.countDocuments({ status: 'approved' }),
      Request.countDocuments({ status: 'rejected' }),
      Request.countDocuments({ status: 'dispatched' }),
      Sale.countDocuments()
    ]);

   
    const recentRequests = await Request.find()
      .populate('user', 'name email branch')
      .populate('company', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentDispatches = await Dispatch.find()
      .populate('item', 'name')
      .populate('dispatchedBy', 'name email')
      .populate('dispatchedTo', 'name email')
      .sort({ dispatchedAt: -1 })
      .limit(5)
      .lean();

    const recentSales = await Sale.find()
      .populate('item', 'name')
      .populate('userId', 'name email')
      .sort({ saleDate: -1 })
      .limit(5)
      .lean();

  
    const summary = {
      totalCompanies,
      totalUsers,
      totalRequests,
      totalApprovedRequests,
      totalRejectedRequests,
      totalDispatchedRequests,
      totalSales
    };

    const activity = {
      recentRequests: recentRequests.map(r => ({
        id: r._id,
        item: r.itemName,
        quantity: r.quantity,
        company: r.company?.name,
        requestedBy: r.user?.name,
        status: r.status,
        date: r.createdAt ? new Date(r.createdAt).toLocaleString() : '-'
      })),
      recentDispatches: recentDispatches.map(d => ({
        id: d._id,
        item: d.item?.name,
        quantity: d.quantity,
        dispatchedBy: d.dispatchedBy?.name,
        dispatchedTo: d.dispatchedTo?.name,
        branch: d.branch,
        date: d.dispatchedAt ? new Date(d.dispatchedAt).toLocaleString() : '-'
      })),
      recentSales: recentSales.map(s => ({
        id: s._id,
        item: s.item?.name,
        quantity: s.quantity,
        soldBy: s.userId?.name,
        totalValue: s.totalValue,
        date: s.saleDate ? new Date(s.saleDate).toLocaleString() : '-'
      }))
    };

   
    res.status(200).json({
      message: 'Superadmin monitoring data fetched successfully',
      summary,
      activity
    });

  } catch (err) {
    console.error('❌ Superadmin Monitor Error:', err);
    res.status(500).json({ message: 'Failed to fetch superadmin dashboard', error: err.message });
  }
};


exports.createRequestFromFR = async (req, res) => {
  try {
    const { itemName, quantity, requiredDate, deliveryAddress, workRefId, partRefId, Decofitem,company } = req.body;

    if (!itemName || !quantity) {
      return res.status(400).json({ message: 'Item name & valid quantity required' });
    }

    let frSystemUser = await User.findOne({ role: "admin" });
    if (!frSystemUser) {
      frSystemUser = await User.findOne({ role: "superadmin" });
    }
    if (!frSystemUser) {
      return res.status(404).json({ message: "IMS System Admin Not Found" });
    }

    const request = new Request({
      user: frSystemUser._id,
      itemName,
      quantity,
      requiredDate,
      deliveryAddress,
      company,
      Decofitem: Decofitem || "not provided", 
      company: frSystemUser._id,
      status: "requested",
      source: "FR",
      reference: {
        workId: workRefId,
        partId: partRefId
      }
    });

    await request.save();

    res.status(201).json({
      success: true,
      message: "FR → IMS Request Synced",
      request
    });

  } catch (err) {
    console.error("🔥 IMS Create Error:", err);
    res.status(500).json({ message: err.message });
  }
};
