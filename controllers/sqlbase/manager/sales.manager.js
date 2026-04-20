const {
  Client,
  ClientLedger,
  Branch,
  Quotation,
  QuotationItem,
  Stock,
  Ledger,
  Invoice,
    InvoiceItem,
  sequelize
} = require("../../../model/SQL_Model");
const User=require('../../../model/SQL_Model/user')
const { QueryTypes } = require("sequelize")
const { Op } = require("sequelize");
const pdf = require("html-pdf");
const PDFDocument = require("pdfkit");
const puppeteer = require("puppeteer");
// const { invoiceHTML } = require("../../../utils/invoiceHTML");
const { generateEwayBill } = require("../../../utils/ewayService");
const { quotationHTML } = require("../../../utils/qt");
// const { generateGSTInvoicePDF } = require("../../../utils/invoice");
const { generateIRN } = require("../../../utils/taxproService");
const { generateEinvoicePayload } = require("../../../utils/einvoicePayload");



async function createInvoiceFromQuotation(quotationId, transaction) {
  const quotation = await Quotation.findByPk(quotationId, {
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!quotation) {
    throw new Error("Quotation not found");
  }

  const items = await QuotationItem.findAll({
    where: { quotation_id: quotationId },
    transaction
  });

  if (!items.length) {
    throw new Error("No quotation items found");
  }

  const client = await Client.findByPk(quotation.client_id, { transaction });
  const branch = await Branch.findByPk(quotation.branch_id, { transaction });

  if (!client || !branch) {
    throw new Error("Client or Branch not found");
  }

  let invoice = await Invoice.findOne({
    where: { quotation_id: quotation.id },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!invoice) {
    invoice = await Invoice.create({
      quotation_id: quotation.id,
      quotation_no: quotation.quotation_no,
      client_id: quotation.client_id,
      branch_id: quotation.branch_id,
      invoice_no: `INV-${quotation.quotation_no}`,
      total_amount: quotation.total_amount,
      gst_amount: quotation.gst_amount,
      status: "draft"
    }, { transaction });
  }

  // Copy quotation items to invoice items only once
  const existingCount = await InvoiceItem.count({
    where: { invoice_id: invoice.id },
    transaction
  });

  if (existingCount === 0) {
    for (const item of items) {
      await InvoiceItem.create({
        invoice_id: invoice.id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit: item.unit || "",
        hsn: item.hsn || "",
        subtotal: item.subtotal || 0,
        amount: item.amount || 0
      }, { transaction });
    }
  }

  // Stock cut + ledger + client ledger only once
  if (invoice.status !== "final") {
    for (const it of items) {
      const stock = await Stock.findOne({
        where: {
          item: it.product_name,
          branch_id: quotation.branch_id
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!stock) {
        throw new Error(`Stock not found for item: ${it.product_name}`);
      }

      if (Number(stock.quantity) < Number(it.quantity)) {
        throw new Error(`Insufficient stock for item: ${it.product_name}`);
      }

      stock.quantity = Number(stock.quantity) - Number(it.quantity);
      await stock.save({ transaction });

      await Ledger.create({
        branch_id: quotation.branch_id,
        stock_id: stock.id,
        type: "SALE",
        quantity: it.quantity,
        rate: it.unit_price,
        total: it.subtotal || it.amount || 0,
        reference_no: invoice.invoice_no
      }, { transaction });
    }

    await ClientLedger.create({
      client_id: quotation.client_id,
      branch_id: quotation.branch_id,
      type: "SALE",
      amount: quotation.total_amount,
      invoice_no: invoice.invoice_no,
      remark: "Invoice"
    }, { transaction });

    invoice.status = "final";
    await invoice.save({ transaction });

    quotation.status = "invoiced";
    await quotation.save({ transaction });
  }

  return { invoice, quotation, client, branch };
}


const getOrCreateClient = async (data, t) => {

  let client = await Client.findOne({
    where: {
      phone: data.phone,
      branch_id: data.branch_id
    },
    transaction: t
  });

  if (client) return client;

  const last = await Client.findOne({
    where: { branch_id: data.branch_id },
    order: [["createdAt", "DESC"]],
    transaction: t
  });

  let next = 1;

  if (last?.client_code) {
    next =
      Number(last.client_code.split("-")[1]) + 1;
  }

  const code =
    `BR${data.branch_id}-${String(next).padStart(4, "0")}`;

  client = await Client.create({
    name: data.name,
    phone: data.phone,
    email: data.email,
    address: data.address,
    branch_id: data.branch_id,
    gst_number: data.gst_number,
    client_code: code
  }, { transaction: t });

  return client;
};
exports.createClient = async (req, res) => {

  const t = await sequelize.transaction();

  try {

    const {
      client_type,
      company_name,
      contact_person,
      phone,
      email,
      address,
      city,
      country
    } = req.body;

    const branch_id = req.user.branch_id;

    if (!company_name) {
      await t.rollback();
      return res.status(400).json({
        error: "Company name required"
      });
    }

    // =========================
    // CLIENT CODE GENERATION
    // =========================

    const lastClient = await Client.findOne({
      where: { branch_id },
      order: [["createdAt", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    let nextNumber = 1;

    if (lastClient?.client_code) {
      const lastNumber =
        parseInt(lastClient.client_code.split("-")[1]);
      nextNumber = lastNumber + 1;
    }

    const client_code =
      `BR${branch_id}-${String(nextNumber).padStart(4, "0")}`;

    // =========================
    // CREATE CLIENT
    // =========================

    const client = await Client.create({

      client_type,
      company_name,
      contact_person,
      phone,
      email,
      address,
      city,
      country,

      branch_id,
      client_code

    }, { transaction: t });

    await t.commit();

    res.status(201).json({
      message: "Client created successfully",
      client
    });

  }
  catch (err) {

    await t.rollback();

    res.status(500).json({
      error: err.message
    });

  }

};

exports.listClients = async (req, res) => {
  try {
    const { search = "", branch_id } = req.query;

    const user = req.user;

    // role name nikal
    const roleName = user.role?.name || user.role;

    let where = {};

    // =========================
    // 🔐 ROLE BASED FILTER
    // =========================

    // 👑 SUPER SALES MANAGER → ALL DATA
    if (roleName !== "super_sales_manager") {
      where.branch_id = user.branch_id;
    }

    // optional branch filter (only super)
    if (branch_id && roleName === "super_sales_manager") {
      where.branch_id = branch_id;
    }

    // =========================
    // 🔍 SEARCH
    // =========================
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // =========================
    // 📦 FETCH DATA
    // =========================
    const clients = await Client.findAll({
      where,
      include: [
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name"]
        }
      ],
      order: [["createdAt", "DESC"]]
    });

    // =========================
    // 🧠 RESPONSE FORMAT
    // =========================
    const formatted = clients.map((c) => ({
      id: c.id,
      client_code: c.client_code,
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,

      branch_id: c.branch_id,
      branch_name: c.branch?.name || null,

      created_at: c.createdAt
    }));

    res.json({
      total: formatted.length,
      clients: formatted
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.createQuotation = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { client, products, gst_percent = 0, valid_till } = req.body;

    const branch_id = req.user.branch_id;

    if (!products || products.length === 0) {
      if (!t.finished) await t.rollback();
      return res.status(400).json({ error: "Products are required" });
    }

    // ================= CLIENT =================
    const clientData = await getOrCreateClient({ ...client, branch_id }, t);

    // ================= STOCK VALIDATION =================
    for (const p of products) {
      const stock = await Stock.findOne({
        where: { item: p.product_name, branch_id },
        transaction: t,
      });

      if (!stock) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({ error: `Stock not found for ${p.product_name}` });
      }

      if (stock.quantity < p.quantity) {
        if (!t.finished) await t.rollback();
        return res.status(400).json({ error: `Not enough stock for ${p.product_name}` });
      }
    }

    // ================= QUOTATION NO =================
    const last = await Quotation.findOne({
      where: { branch_id },
      order: [["createdAt", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let next = 1;
    if (last?.quotation_no) {
      const parts = last.quotation_no.split("-");
      next = Number(parts[2]) + 1;
    }

    const quotation_no = `QT-${branch_id}-${String(next).padStart(4, "0")}`;

    // ================= TOTAL =================
    let subtotal = 0;
    for (const p of products) {
      subtotal += p.quantity * p.unit_price;
    }

    const gst_amount = (subtotal * gst_percent) / 100;
    const grand_total = subtotal + gst_amount;

    // ================= CREATE QUOTATION =================
    const quotation = await Quotation.create(
      {
        quotation_no,
        client_id: clientData.id,
        branch_id,
        total_amount: grand_total,
        gst_amount,
        valid_till: valid_till || null,
        status: "pending",
      },
      { transaction: t }
    );

    // ================= ITEMS =================
    for (const p of products) {
      const itemTotal = p.quantity * p.unit_price;

      const cgst = (itemTotal * gst_percent) / 200;
      const sgst = (itemTotal * gst_percent) / 200;

      await QuotationItem.create(
        {
          quotation_id: quotation.id,
          product_name: p.product_name,
          quantity: p.quantity,
          unit_price: p.unit_price,
          unit: p.unit || "",
          hsn: p.hsn || "",
          specifications: p.specifications || "",
          cgst,
          sgst,
          subtotal: itemTotal,
          amount: itemTotal + cgst + sgst,
        },
        { transaction: t }
      );
    }

    await t.commit();

    // ================= FETCH DATA =================
    const branch = await Branch.findByPk(branch_id);

    const items = await QuotationItem.findAll({
      where: { quotation_id: quotation.id },
    });

    // ================= PDF WITH PDFKIT =================
    const doc = new PDFDocument({ margin: 30 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=${quotation_no}.pdf`
    );

    doc.pipe(res);

    // HEADER
    doc.fontSize(16).text(branch.name || "", { align: "center" });
    doc.fontSize(10).text(branch.address || "", { align: "center" });
    doc.text(`GST: ${branch.gst || ""}`, { align: "center" });
    doc.moveDown();

    doc.fontSize(14).text("QUOTATION", { align: "center" });
    doc.moveDown();

    // DETAILS
    doc.fontSize(10);
    doc.text(`Quotation No: ${quotation.quotation_no}`);
    doc.text(`Date: ${new Date(quotation.createdAt).toDateString()}`);
    doc.text(`Status: ${quotation.status}`);
    doc.moveDown();

    doc.text(`Billing To:`);
    doc.text(`${clientData.name}`);
    doc.text(`${clientData.address}`);
    doc.moveDown();

    // TABLE HEADER
    doc.text("No  Item  Qty  Rate  Total");
    doc.moveDown();

    // ITEMS
    items.forEach((it, i) => {
      doc.text(
        `${i + 1}  ${it.product_name}  ${it.quantity}  ${it.unit_price}  ${it.amount}`
      );
    });

    doc.moveDown(2);

    // TOTAL
    doc.text(`Subtotal: ${subtotal}`);
    doc.text(`GST: ${gst_amount}`);
    doc.text(`Grand Total: ${grand_total}`);

    doc.end();

  } catch (err) {
    try {
      if (!t.finished) await t.rollback();
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr);
    }

    console.error(err);
    return res.status(500).json({
      message: "Something went wrong!",
      error: err.message,
    });
  }
};



async function createInvoiceFromQuotation(quotationId, transaction) {
  const quotation = await Quotation.findByPk(quotationId, {
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!quotation) {
    throw new Error("Quotation not found");
  }

  const items = await QuotationItem.findAll({
    where: { quotation_id: quotationId },
    transaction
  });

  if (!items.length) {
    throw new Error("No quotation items found");
  }

  const client = await Client.findByPk(quotation.client_id, { transaction });
  const branch = await Branch.findByPk(quotation.branch_id, { transaction });

  if (!client || !branch) {
    throw new Error("Client or Branch not found");
  }

  let invoice = await Invoice.findOne({
    where: { quotation_id: quotation.id },
    transaction,
    lock: transaction.LOCK.UPDATE
  });

  if (!invoice) {
    invoice = await Invoice.create({
      quotation_id: quotation.id,
      quotation_no: quotation.quotation_no,
      client_id: quotation.client_id,
      branch_id: quotation.branch_id,
      invoice_no: `INV-${quotation.quotation_no}`,
      total_amount: quotation.total_amount,
      gst_amount: quotation.gst_amount,
      status: "draft"
    }, { transaction });
  }

  // Copy quotation items to invoice items only once
  const existingCount = await InvoiceItem.count({
    where: { invoice_id: invoice.id },
    transaction
  });

  if (existingCount === 0) {
    for (const item of items) {
      await InvoiceItem.create({
        invoice_id: invoice.id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit: item.unit || "",
        hsn: item.hsn || "",
        subtotal: item.subtotal || 0,
        amount: item.amount || 0
      }, { transaction });
    }
  }

  // Stock cut + ledger + client ledger only once
  if (invoice.status !== "final") {
    for (const it of items) {
      const stock = await Stock.findOne({
        where: {
          item: it.product_name,
          branch_id: quotation.branch_id
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!stock) {
        throw new Error(`Stock not found for item: ${it.product_name}`);
      }

      if (Number(stock.quantity) < Number(it.quantity)) {
        throw new Error(`Insufficient stock for item: ${it.product_name}`);
      }

      stock.quantity = Number(stock.quantity) - Number(it.quantity);
      await stock.save({ transaction });

      await Ledger.create({
        branch_id: quotation.branch_id,
        stock_id: stock.id,
        type: "SALE",
        quantity: it.quantity,
        rate: it.unit_price,
        total: it.subtotal || it.amount || 0,
        reference_no: invoice.invoice_no
      }, { transaction });
    }

    await ClientLedger.create({
      client_id: quotation.client_id,
      branch_id: quotation.branch_id,
      type: "SALE",
      amount: quotation.total_amount,
      invoice_no: invoice.invoice_no,
      remark: "Invoice"
    }, { transaction });

    invoice.status = "final";
    await invoice.save({ transaction });

    quotation.status = "invoiced";
    await quotation.save({ transaction });
  }

  return { invoice, quotation, client, branch };
}

function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("en-GB").replace(/\//g, "-");
}

function money(val) {
  return Number(val || 0).toFixed(2);
}

function numberToWords(num) {
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"
  ];

  const b = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
  ];

  const inWords = (n) => {
    n = Math.floor(Number(n || 0));

    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + inWords(n % 100) : "");
    if (n < 100000) return inWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + inWords(n % 1000) : "");
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + inWords(n % 100000) : "");
    return inWords(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + inWords(n % 10000000) : "");
  };

  const integerPart = Math.floor(Number(num || 0));
  const decimalPart = Math.round((Number(num || 0) - integerPart) * 100);

  let words = inWords(integerPart) + " Rupees";
  if (decimalPart > 0) {
    words += " and " + inWords(decimalPart) + " Paisa";
  }

  return words + " Only";
}




async function generateGSTInvoicePDF({ branch, invoice, client, items }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 20
      });

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      const pageWidth = doc.page.width;
      const startX = 20;
      const usableWidth = pageWidth - 40;

      // ========== CALCULATIONS ==========
      const subtotal = items.reduce((sum, i) => sum + Number(i.subtotal || i.amount || 0), 0);
      const gstAmount = Number(invoice.gst_amount || 0);
      const cgst = gstAmount / 2;
      const sgst = gstAmount / 2;
      const grandTotal = Number(invoice.total_amount || 0);

      // ========== HEADER ==========
      doc
        .font("Helvetica-Bold")
        .fontSize(28)
        .fillColor("#5DADE2")
        .text(branch.name || branch.branch_name || "Construct Ability", startX, 20, {
          width: usableWidth,
          align: "center"
        });

      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("black")
        .text(
          `Address- ${branch.address || branch.branch_address || ""}, ${branch.city || ""}, ${branch.state || ""} - ${branch.pincode || ""}`,
          startX,
          60,
          { width: usableWidth, align: "center" }
        );

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(`GST No- ${branch.gst_number || branch.gst || branch.gst_no || ""}`, startX, 74, {
          width: usableWidth,
          align: "center"
        });

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("TAX-INVOICE", startX, 92, { width: usableWidth, align: "center" });

      doc
        .font("Helvetica")
        .fontSize(8)
        .text("(Original for buyer)", startX + usableWidth - 110, 92, { width: 100, align: "right" });

      // ========== MAIN BOX ==========
      let y = 110;
      doc.rect(startX, y, usableWidth, 190).stroke();

      doc.moveTo(startX + usableWidth / 2, y).lineTo(startX + usableWidth / 2, y + 190).stroke();

      // Left top
      doc.font("Helvetica-Bold").fontSize(10).text(branch.name || branch.branch_name || "Company", startX + 5, y + 5);
      doc.font("Helvetica").fontSize(9)
        .text(`House no- ${branch.address || branch.branch_address || ""}`, startX + 5, y + 22)
        .text(`${branch.city || ""}, ${branch.state || ""} - ${branch.pincode || ""}`, startX + 5, y + 36)
        .text(`GSTIN/UIN: ${branch.gst_number || branch.gst || branch.gst_no || ""}`, startX + 5, y + 52)
        .text(`State Name: ${branch.state || ""}`, startX + 5, y + 66)
        .text(`E-Mail: ${branch.email || ""}`, startX + 5, y + 80);

      // Left bottom buyer
      doc.moveTo(startX, y + 105).lineTo(startX + usableWidth / 2, y + 105).stroke();

      doc.font("Helvetica-Bold").fontSize(10).text(
        client.name || client.company_name || client.client_name || "Client",
        startX + 5,
        y + 110
      );

      doc.font("Helvetica").fontSize(9)
        .text(`${client.address || client.client_address || ""}`, startX + 5, y + 130)
        .text(`${client.city || ""}, ${client.state || ""}`, startX + 5, y + 145)
        .text(`GST No: ${client.gst_number || client.gst || client.gst_no || ""}`, startX + 5, y + 170)
        .text(`State Name: ${client.state || ""}`, startX + 5, y + 185);

      // Right section
      const rx = startX + usableWidth / 2;
      const rw = usableWidth / 2;
      const rowH = 19;
      const labelW = 115;

      const rightRows = [
        ["Invoice No.", invoice.invoice_no || ""],
        ["Dated", formatDate(invoice.createdAt || new Date())],
        ["Delivery Note", ""],
        ["Mode/Terms of payment", "RTGS"],
        ["Supplier's Ref.", ""],
        ["Other Reference(s)", invoice.quotation_no || ""],
        ["Despatch Document No.", ""],
        ["Project Name", client.name || client.company_name || ""],
        ["", client.address || ""],
        ["", client.city || ""]
      ];

      let ry = y;
      for (let i = 0; i < rightRows.length; i++) {
        doc.rect(rx, ry, rw, rowH).stroke();
        doc.moveTo(rx + labelW, ry).lineTo(rx + labelW, ry + rowH).stroke();

        doc.font("Helvetica").fontSize(8)
          .text(rightRows[i][0], rx + 4, ry + 5, { width: labelW - 8 })
          .text(rightRows[i][1], rx + labelW + 4, ry + 5, { width: rw - labelW - 8 });

        ry += rowH;
      }

      // ========== ITEMS TABLE ==========
      y = 310;
      const tableX = startX;
      const tableW = usableWidth;

      const col = {
        sl: 35,
        desc: 255,
        hsn: 70,
        qty: 60,
        rate: 70,
        unit: 60,
        amount: 90
      };

      const headers = ["SL No.", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "Unit", "Amount"];

      const colXs = [
        tableX,
        tableX + col.sl,
        tableX + col.sl + col.desc,
        tableX + col.sl + col.desc + col.hsn,
        tableX + col.sl + col.desc + col.hsn + col.qty,
        tableX + col.sl + col.desc + col.hsn + col.qty + col.rate,
        tableX + col.sl + col.desc + col.hsn + col.qty + col.rate + col.unit
      ];

      const tableEndX = tableX + tableW;

      // Header row
      doc.rect(tableX, y, tableW, 22).stroke();
      colXs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + 22).stroke());
      doc.moveTo(tableEndX, y).lineTo(tableEndX, y + 22).stroke();

      doc.font("Helvetica-Bold").fontSize(8);
      doc.text(headers[0], tableX + 5, y + 7, { width: col.sl - 10, align: "center" });
      doc.text(headers[1], colXs[1] + 5, y + 7, { width: col.desc - 10 });
      doc.text(headers[2], colXs[2] + 5, y + 7, { width: col.hsn - 10, align: "center" });
      doc.text(headers[3], colXs[3] + 5, y + 7, { width: col.qty - 10, align: "center" });
      doc.text(headers[4], colXs[4] + 5, y + 7, { width: col.rate - 10, align: "center" });
      doc.text(headers[5], colXs[5] + 5, y + 7, { width: col.unit - 10, align: "center" });
      doc.text(headers[6], colXs[6] + 5, y + 7, { width: col.amount - 10, align: "center" });

      y += 22;

      doc.font("Helvetica").fontSize(8);

      items.forEach((item, index) => {
        const itemRowH = 20;

        doc.rect(tableX, y, tableW, itemRowH).stroke();
        colXs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + itemRowH).stroke());
        doc.moveTo(tableEndX, y).lineTo(tableEndX, y + itemRowH).stroke();

        doc.text(String(index + 1), tableX + 5, y + 6, { width: col.sl - 10, align: "center" });
        doc.text(item.product_name || "", colXs[1] + 5, y + 6, { width: col.desc - 10 });
        doc.text(item.hsn || "", colXs[2] + 5, y + 6, { width: col.hsn - 10, align: "center" });
        doc.text(String(item.quantity || 0), colXs[3] + 5, y + 6, { width: col.qty - 10, align: "center" });
        doc.text(money(item.unit_price || 0), colXs[4] + 5, y + 6, { width: col.rate - 10, align: "center" });
        doc.text(item.unit || "", colXs[5] + 5, y + 6, { width: col.unit - 10, align: "center" });
        doc.text(money(item.subtotal || item.amount || 0), colXs[6] + 5, y + 6, { width: col.amount - 10, align: "right" });

        y += itemRowH;
      });

      // Blank rows
      for (let i = items.length; i < 6; i++) {
        const blankRowH = 20;
        doc.rect(tableX, y, tableW, blankRowH).stroke();
        colXs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + blankRowH).stroke());
        doc.moveTo(tableEndX, y).lineTo(tableEndX, y + blankRowH).stroke();
        y += blankRowH;
      }

      // Totals
      const totalRows = [
        ["Total Amount", money(subtotal)],
        ["CGST @9%", money(cgst)],
        ["SGST @9%", money(sgst)],
        ["Round Off", "0.00"],
        ["Total", money(grandTotal)]
      ];

      totalRows.forEach((r) => {
        const totalRowH = 18;

        doc.rect(tableX, y, tableW, totalRowH).stroke();
        colXs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + totalRowH).stroke());
        doc.moveTo(tableEndX, y).lineTo(tableEndX, y + totalRowH).stroke();

        doc.font("Helvetica-Bold").fontSize(8)
          .text(r[0], colXs[1], y + 5, {
            width: col.desc + col.hsn + col.qty + col.rate + col.unit - 10,
            align: "right"
          })
          .text(r[1], colXs[6] + 5, y + 5, {
            width: col.amount - 10,
            align: "right"
          });

        y += totalRowH;
      });

      // Amount in words
      doc.rect(tableX, y, tableW, 28).stroke();
      doc.font("Helvetica").fontSize(8)
        .text(`Amount Chargeable (in words): ${numberToWords(grandTotal)}`, tableX + 5, y + 8, {
          width: tableW - 10
        });

      y += 28;

      // Tax summary
      doc.rect(tableX, y, tableW, 70).stroke();
      doc.moveTo(tableX + 180, y).lineTo(tableX + 180, y + 70).stroke();
      doc.moveTo(tableX + 360, y).lineTo(tableX + 360, y + 70).stroke();
      doc.moveTo(tableX + 470, y).lineTo(tableX + 470, y + 70).stroke();

      doc.font("Helvetica-Bold").fontSize(8)
        .text("HSN/SAC", tableX + 60, y + 8)
        .text("Integrated Tax", tableX + 230, y + 8)
        .text("Total Tax Amount", tableX + 490, y + 8);

      doc.font("Helvetica").fontSize(8)
        .text("CGST @9%", tableX + 220, y + 28)
        .text(money(cgst), tableX + 310, y + 28)
        .text(money(cgst + sgst), tableX + 500, y + 28)
        .text("SGST @9%", tableX + 220, y + 45)
        .text(money(sgst), tableX + 310, y + 45);

      y += 70;

      // Bank Details
      doc.rect(tableX, y, tableW, 100).stroke();
      doc.moveTo(tableX + tableW / 2, y).lineTo(tableX + tableW / 2, y + 100).stroke();

      doc.font("Helvetica").fontSize(8)
        .text(`Total Amount (in words): ${numberToWords(gstAmount)}`, tableX + 5, y + 10, {
          width: tableW / 2 - 10
        });

      doc.font("Helvetica-Bold").fontSize(9)
        .text("Company Bank's Details:", tableX + tableW / 2 + 5, y + 10);

      doc.font("Helvetica").fontSize(8)
        .text(`Bank Name: ${branch.bank_name || "HDFC"}`, tableX + tableW / 2 + 5, y + 30)
        .text(`A/c No.: ${branch.bank_account || branch.account_no || ""}`, tableX + tableW / 2 + 5, y + 45)
        .text(`Branch & IFSC Code: ${branch.ifsc || ""}`, tableX + tableW / 2 + 5, y + 60);

      y += 100;

      // Declaration
      doc.rect(tableX, y, tableW, 70).stroke();
      doc.moveTo(tableX + tableW / 2, y).lineTo(tableX + tableW / 2, y + 70).stroke();

      doc.font("Helvetica-Bold").fontSize(8)
        .text("Declaration :", tableX + 5, y + 8);

      doc.font("Helvetica").fontSize(8)
        .text(
          "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
          tableX + 5,
          y + 20,
          { width: tableW / 2 - 10 }
        );

      doc.font("Helvetica-Bold").fontSize(9)
        .text(`FOR ${String(branch.name || branch.branch_name || "COMPANY").toUpperCase()}`, tableX + tableW / 2 + 40, y + 10);

      doc.font("Helvetica").fontSize(8)
        .text("Authorised Signatory", tableX + tableW / 2 + 60, y + 50);

      y += 70;

      // Footer
      doc.font("Helvetica").fontSize(8)
        .text("SUBJECT TO JURISDICTION", tableX, y + 5, {
          width: tableW / 2,
          align: "center"
        })
        .text("(This is Computer Generated Invoice)", tableX + tableW / 2, y + 5, {
          width: tableW / 2,
          align: "center"
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}




exports.convertQuotationToInvoice = async (req, res) => {
  let t;

  try {
    const { id } = req.params;

    t = await sequelize.transaction();

    // ===== 1. FIND QUOTATION =====
    const quotation = await Quotation.findByPk(id, {
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!quotation) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        error: "Quotation not found"
      });
    }

    if (quotation.status !== "approved" && quotation.status !== "invoiced") {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: "Quotation not approved"
      });
    }

    // ===== 2. GET QUOTATION ITEMS =====
    const items = await QuotationItem.findAll({
      where: { quotation_id: id },
      transaction: t
    });

    if (!items.length) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: "No quotation items found"
      });
    }

    // ===== 3. GET CLIENT + BRANCH =====
    const client = await Client.findByPk(quotation.client_id, { transaction: t });
    const branch = await Branch.findByPk(quotation.branch_id, { transaction: t });

    if (!client || !branch) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        error: "Client or Branch not found"
      });
    }

    // ===== 4. FIND OR CREATE INVOICE =====
    let invoice = await Invoice.findOne({
      where: { quotation_id: quotation.id },
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!invoice) {
      invoice = await Invoice.create({
        quotation_id: quotation.id,
        quotation_no: quotation.quotation_no,
        client_id: quotation.client_id,
        branch_id: quotation.branch_id,
        invoice_no: `INV-${quotation.quotation_no}`,
        total_amount: quotation.total_amount,
        gst_amount: quotation.gst_amount,
        status: "draft"
      }, { transaction: t });
    }

    // ===== 5. COPY QUOTATION ITEMS TO INVOICE ITEMS ONLY ONCE =====
    const existingCount = await InvoiceItem.count({
      where: { invoice_id: invoice.id },
      transaction: t
    });

    if (existingCount === 0) {
      for (const item of items) {
        await InvoiceItem.create({
          invoice_id: invoice.id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          unit: item.unit || "",
          hsn: item.hsn || "",
          subtotal: item.subtotal || 0,
          amount: item.amount || 0
        }, { transaction: t });
      }
    }

    // ===== 6. STOCK CUT + LEDGER + CLIENT LEDGER ONLY ONCE =====
    if (invoice.status !== "final") {
      for (const it of items) {
        const stock = await Stock.findOne({
          where: {
            item: it.product_name,
            branch_id: quotation.branch_id
          },
          transaction: t,
          lock: t.LOCK.UPDATE
        });

        if (!stock) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            error: `Stock not found for item: ${it.product_name}`
          });
        }

        if (Number(stock.quantity) < Number(it.quantity)) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            error: `Insufficient stock for item: ${it.product_name}`
          });
        }

        stock.quantity = Number(stock.quantity) - Number(it.quantity);
        await stock.save({ transaction: t });

        await Ledger.create({
          branch_id: quotation.branch_id,
          stock_id: stock.id,
          type: "SALE",
          quantity: it.quantity,
          rate: it.unit_price,
          total: it.subtotal || it.amount || 0,
          reference_no: invoice.invoice_no
        }, { transaction: t });
      }

      await ClientLedger.create({
        client_id: quotation.client_id,
        branch_id: quotation.branch_id,
        type: "SALE",
        amount: quotation.total_amount,
        invoice_no: invoice.invoice_no,
        remark: "Invoice"
      }, { transaction: t });

      invoice.status = "final";
      await invoice.save({ transaction: t });

      quotation.status = "invoiced";
      await quotation.save({ transaction: t });
    }

    await t.commit();

    // ===== 7. RELOAD FINAL INVOICE ITEMS FOR PDF =====
    const invoiceItems = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id }
    });

    // ===== 8. GENERATE PDF =====
    try {
      const pdf = await generateGSTInvoicePDF({
        branch,
        invoice,
        client,
        items: invoiceItems
      });

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=${invoice.invoice_no}.pdf`
      });

      return res.send(pdf);

    } catch (pdfErr) {
      console.error("PDF error:", pdfErr);

      return res.status(200).json({
        success: true,
        message: "Invoice created successfully but PDF generation failed",
        invoice
      });
    }

  } catch (err) {
    if (t && !t.finished) {
      await t.rollback();
    }

    console.error("convertQuotationToInvoice error:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
exports.approveQuotation = async (req, res) => {
  let t;

  try {
    const { id } = req.params;

    const role = req.user?.role?.name || req.user?.role || "";
    const userBranches = Array.isArray(req.user?.branches) && req.user.branches.length
      ? req.user.branches.map(Number).filter((b) => !isNaN(b))
      : req.user?.branch_id
      ? [Number(req.user.branch_id)].filter((b) => !isNaN(b))
      : [];

    t = await sequelize.transaction();

    // ===== 1. FETCH QUOTATION =====
    const quotation = await Quotation.findByPk(id, {
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!quotation) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        error: "Quotation not found"
      });
    }

    // ===== 2. ROLE CHECK =====
    const allowedRoles = [
      "super_admin",
      "super_sales_manager",
      "super_sales_admin",
      "sales_manager"
    ];

    if (!allowedRoles.includes(role)) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "Access denied: Insufficient role"
      });
    }

    // ===== 3. BRANCH CHECK =====
    if (role === "sales_manager") {
      if (!userBranches.length) {
        await t.rollback();
        return res.status(403).json({
          success: false,
          message: "No branch access"
        });
      }

      if (!userBranches.includes(Number(quotation.branch_id))) {
        await t.rollback();
        return res.status(403).json({
          success: false,
          message: "Access denied: You can approve only your branch quotations"
        });
      }
    }

    // ===== 4. IF ALREADY INVOICED, JUST RETURN PDF =====
    if (quotation.status === "invoiced") {
      await t.commit();

      const invoice = await Invoice.findOne({
        where: { quotation_id: quotation.id }
      });

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: "Invoice not found for this quotation"
        });
      }

      const client = await Client.findByPk(quotation.client_id);
      const branch = await Branch.findByPk(quotation.branch_id);
      const invoiceItems = await InvoiceItem.findAll({
        where: { invoice_id: invoice.id }
      });

      const pdf = await generateGSTInvoicePDF({
        branch,
        invoice,
        client,
        items: invoiceItems
      });

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=${invoice.invoice_no}.pdf`
      });

      return res.send(pdf);
    }

    // ===== 5. APPROVE QUOTATION =====
    quotation.status = "approved";
    quotation.approved_by = req.user.id;   // 👈 ye add karo
quotation.approved_at = new Date();    // 👈 ye add karo
    await quotation.save({ transaction: t });

    // ===== 6. GET QUOTATION ITEMS =====
    const items = await QuotationItem.findAll({
      where: { quotation_id: id },
      transaction: t
    });

    if (!items.length) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: "No quotation items found"
      });
    }

    // ===== 7. GET CLIENT + BRANCH =====
    const client = await Client.findByPk(quotation.client_id, { transaction: t });
    const branch = await Branch.findByPk(quotation.branch_id, { transaction: t });

    if (!client || !branch) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        error: "Client or Branch not found"
      });
    }

    // ===== 8. FIND OR CREATE INVOICE =====
    let invoice = await Invoice.findOne({
      where: { quotation_id: quotation.id },
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!invoice) {
      invoice = await Invoice.create({
        quotation_id: quotation.id,
        quotation_no: quotation.quotation_no,
        client_id: quotation.client_id,
        branch_id: quotation.branch_id,
        invoice_no: `INV-${quotation.quotation_no}`,
        total_amount: quotation.total_amount,
        gst_amount: quotation.gst_amount,
        status: "draft"
      }, { transaction: t });
    }

    // ===== 9. COPY ITEMS ONLY ONCE =====
    const existingCount = await InvoiceItem.count({
      where: { invoice_id: invoice.id },
      transaction: t
    });

    if (existingCount === 0) {
      for (const item of items) {
        await InvoiceItem.create({
          invoice_id: invoice.id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          unit: item.unit || "",
          hsn: item.hsn || "",
          subtotal: item.subtotal || 0,
          amount: item.amount || 0
        }, { transaction: t });
      }
    }

    // ===== 10. STOCK CUT + LEDGER ONLY ONCE =====
    if (invoice.status !== "final") {
      for (const it of items) {
        const stock = await Stock.findOne({
          where: {
            item: it.product_name,
            branch_id: quotation.branch_id
          },
          transaction: t,
          lock: t.LOCK.UPDATE
        });

        if (!stock) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            error: `Stock not found for item: ${it.product_name}`
          });
        }

        if (Number(stock.quantity) < Number(it.quantity)) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            error: `Insufficient stock for item: ${it.product_name}`
          });
        }

        stock.quantity = Number(stock.quantity) - Number(it.quantity);
        await stock.save({ transaction: t });

        await Ledger.create({
          branch_id: quotation.branch_id,
          stock_id: stock.id,
          type: "SALE",
          quantity: it.quantity,
          rate: it.unit_price,
          total: it.subtotal || it.amount || 0,
          reference_no: invoice.invoice_no
        }, { transaction: t });
      }

      await ClientLedger.create({
        client_id: quotation.client_id,
        branch_id: quotation.branch_id,
        type: "SALE",
        amount: quotation.total_amount,
        invoice_no: invoice.invoice_no,
        remark: "Invoice"
      }, { transaction: t });

      invoice.status = "final";
      await invoice.save({ transaction: t });

      quotation.status = "invoiced";
      await quotation.save({ transaction: t });
    }

    await t.commit();

    // ===== 11. RELOAD INVOICE ITEMS =====
    const invoiceItems = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id }
    });

    // ===== 12. GENERATE PDF =====
    try {
      const pdf = await generateGSTInvoicePDF({
        branch,
        invoice,
        client,
        items: invoiceItems
      });

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=${invoice.invoice_no}.pdf`
      });

      return res.send(pdf);

    } catch (pdfErr) {
      console.error("PDF error:", pdfErr);

      return res.status(200).json({
        success: true,
        message: "Quotation approved and invoice created successfully but PDF generation failed",
        invoice
      });
    }

  } catch (err) {
    if (t && !t.finished) {
      await t.rollback();
    }

    console.error("APPROVE QUOTATION ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Server error"
    });
  }
};
exports.generateQuotationPDF = async (req, res) => {
  try {
    const { quotation_id } = req.params;

    const quotation = await Quotation.findByPk(quotation_id, {
      include: [Client, Branch],
    });

    if (!quotation) {
      return res.status(404).json({ error: "Quotation not found" });
    }

    const items = await QuotationItem.findAll({
      where: { quotation_id },
    });

    const client = quotation.Client;
    const branch = quotation.Branch;

    const doc = new PDFDocument({ margin: 30 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=${quotation.quotation_no}.pdf`
    );

    doc.pipe(res);

    // ================= HEADER =================
    doc.fontSize(16).text(branch.name || "", { align: "center" });
    doc.fontSize(10).text(branch.address || "", { align: "center" });
    doc.text(`GST: ${branch.gst || ""}`, { align: "center" });
    doc.moveDown();

    doc.fontSize(14).text("QUOTATION", { align: "center" });
    doc.moveDown();

    // ================= DETAILS =================
    doc.fontSize(10);
    doc.text(`Quotation No: ${quotation.quotation_no}`);
    doc.text(`Date: ${new Date(quotation.createdAt).toDateString()}`);
    doc.text(`Status: ${quotation.status}`);
    doc.moveDown();

    doc.text(`Billing To:`);
    doc.text(`${client.name}`);
    doc.text(`${client.address}`);
    doc.moveDown();

    // ================= TABLE HEADER =================
    doc.fontSize(9);
    doc.text("#", 30);
    doc.text("Item", 60);
    doc.text("Qty", 200);
    doc.text("Rate", 240);
    doc.text("Taxable", 300);
    doc.text("Total", 380);

    doc.moveDown();

    // ================= ITEMS =================
    let y = doc.y;

    items.forEach((it, i) => {
      doc.text(i + 1, 30, y);
      doc.text(it.product_name, 60, y);
      doc.text(it.quantity, 200, y);
      doc.text(Number(it.unit_price).toFixed(2), 240, y);
      doc.text(Number(it.subtotal).toFixed(2), 300, y);
      doc.text(Number(it.amount).toFixed(2), 380, y);

      y += 20;
    });

    doc.moveDown(2);

    // ================= TOTAL =================
    doc.fontSize(10);
    doc.text(`Subtotal: ${quotation.total_amount - quotation.gst_amount}`);
    doc.text(`GST: ${quotation.gst_amount}`);
    doc.text(`Grand Total: ${quotation.total_amount}`);

    doc.moveDown();
    doc.text("Computer generated quotation.");

    doc.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message,
    });
  }
};
exports.createSaleEntry = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { client_id, invoice_no, amount, remark } = req.body;

    if (!client_id || !amount) {
      return res.status(400).json({ error: "client_id and amount required" });
    }

    const client = await Client.findByPk(client_id);
    if (!client) return res.status(404).json({ error: "Client not found" });

    // Branch rule:
    // Sales manager normally works for his branch
    const branch_id = req.user.branch_id || client.branch_id;

    const entry = await ClientLedger.create({
      client_id,
      branch_id,
      type: "SALE",
      invoice_no: invoice_no || null,
      amount: Number(amount),
      remark: remark || "Sale"
    }, { transaction: t });

    await t.commit();

    res.status(201).json({ message: "Sale added in ledger", entry });

  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};



exports.addClientPayment = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { client_id, amount, remark } = req.body;

    if (!client_id || !amount) {
      return res.status(400).json({ error: "client_id and amount required" });
    }

    const client = await Client.findByPk(client_id);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const branch_id = req.user.branch_id || client.branch_id;

    const entry = await ClientLedger.create({
      client_id,
      branch_id,
      type: "PAYMENT",
      amount: Number(amount),
      remark: remark || "Payment received"
    }, { transaction: t });

    await t.commit();

    res.status(201).json({ message: "Payment added in ledger", entry });

  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};


exports.getClientLedger = async (req, res) => {
  try {

    const clients = await Client.findAll({
      attributes: [
        "id",
        "name",
        "phone",
        "email",
        "client_code",
        [
          sequelize.literal(`
            COALESCE(SUM(CASE WHEN ledger.type='SALE' THEN ledger.amount ELSE 0 END),0)
          `),
          "revenue"
        ],
        [
          sequelize.literal(`
            COALESCE(SUM(CASE WHEN ledger.type='PAYMENT' THEN ledger.amount ELSE 0 END),0)
          `),
          "payment"
        ],
        [
          sequelize.literal(`
            COALESCE(SUM(CASE WHEN ledger.type='SALE' THEN ledger.amount ELSE 0 END),0)
            -
            COALESCE(SUM(CASE WHEN ledger.type='PAYMENT' THEN ledger.amount ELSE 0 END),0)
          `),
          "pendingAmount"
        ]
      ],
      include: [
        {
          model: ClientLedger,
          as: "ledger",
          attributes: []
        }
      ],
      group: ["Client.id"]
    });

    res.json({
      success: true,
      totalClients: clients.length,
      clients
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

exports.getClientLedgerDetails = async (req, res) => {
  try {

    const { clientId } = req.params;

    const ledger = await ClientLedger.findAll({
      where: { client_id: clientId },
      attributes: [
        "id",
        "invoice_no",
        "type",
        "amount",
        "remark",
        "createdAt"
      ],
      include: [
        {
          model: Client,
          as: "client",
          attributes: ["id", "name"]
        }
      ],
      order: [["createdAt", "DESC"]]
    });

    res.json({
      success: true,
      totalEntries: ledger.length,
      ledger
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};



exports.listQuotations = async (req, res) => {
  try {
    const user = req.user;
    const role = user.role?.name || user.role || "";

    // super role support
    const isSuperSales =
      role === "super_sales_manager" || role === "super_sales_admin";

    // normalize branch access
    const userBranches = Array.isArray(user.branches) && user.branches.length
      ? user.branches.map(Number).filter((id) => !isNaN(id))
      : user.branch_id
      ? [Number(user.branch_id)].filter((id) => !isNaN(id))
      : [];

    let where = {};

    // =========================
    // QUERY PARAM SANITIZE
    // =========================
    const rawBranchFilter = req.query.branch_id;
    const normalizedBranchFilter =
      rawBranchFilter &&
      String(rawBranchFilter).trim() !== "" &&
      String(rawBranchFilter).trim().toUpperCase() !== "ALL"
        ? Number(rawBranchFilter)
        : null;

    // =========================
    // ROLE BASED FILTER
    // =========================
    if (isSuperSales) {
      // super sales can see all branches
      // and can optionally filter one branch
      if (normalizedBranchFilter !== null) {
        if (isNaN(normalizedBranchFilter)) {
          return res.status(400).json({
            success: false,
            error: "Invalid branch_id. Use numeric branch_id or ALL"
          });
        }

        where.branch_id = normalizedBranchFilter;
      }
    } else {
      // normal sales / branch user -> only own branch
      if (!userBranches.length) {
        return res.status(403).json({
          success: false,
          error: "No branch access"
        });
      }

      where.branch_id = {
        [Op.in]: userBranches
      };
    }

    // =========================
    // FETCH DATA
    // =========================
    const quotations = await Quotation.findAll({
      where,
      attributes: [
        "id",
        "quotation_no",
        "client_id",
        "branch_id",
        "total_amount",
        "gst_amount",
        "valid_till",
        "reference_no",
        "status",
        "createdAt"
      ],
      include: [
        {
          model: Client,
          as: "client",
          attributes: ["id", "name", "phone", "email", "address"]
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "location"]
        },
        {
          model: QuotationItem,
          as: "items"
        }
      ],
      order: [["createdAt", "DESC"]]
    });

    // =========================
    // SUPER SALES RESPONSE
    // =========================
    if (isSuperSales) {
      const grouped = {};

      quotations.forEach((q) => {
        const branchId = q.branch_id || 0;
        const branchName = q.branch?.name || "Unknown";
        const branchLocation = q.branch?.location || "Unknown";

        if (!grouped[branchId]) {
          grouped[branchId] = {
            branchId,
            branchName,
            branchLocation,
            total: 0,
            amount: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            invoiced: 0,
            quotations: []
          };
        }

        const data = grouped[branchId];

        data.total += 1;
        data.amount += Number(q.total_amount || 0);

        if (q.status === "pending") data.pending += 1;
        if (q.status === "approved") data.approved += 1;
        if (q.status === "rejected") data.rejected += 1;
        if (q.status === "invoiced") data.invoiced += 1;

        data.quotations.push(q);
      });

      // overall summary for super sales
      const summary = {
        totalQuotations: quotations.length,
        totalAmount: quotations.reduce(
          (sum, q) => sum + Number(q.total_amount || 0),
          0
        ),
        pending: quotations.filter((q) => q.status === "pending").length,
        approved: quotations.filter((q) => q.status === "approved").length,
        rejected: quotations.filter((q) => q.status === "rejected").length,
        invoiced: quotations.filter((q) => q.status === "invoiced").length
      };

      return res.json({
        success: true,
        role,
        summary,
        total: quotations.length,
        branches: Object.values(grouped)
      });
    }

    // =========================
    // NORMAL BRANCH SALES RESPONSE
    // =========================
    const summary = {
      totalQuotations: quotations.length,
      totalAmount: quotations.reduce(
        (sum, q) => sum + Number(q.total_amount || 0),
        0
      ),
      pending: quotations.filter((q) => q.status === "pending").length,
      approved: quotations.filter((q) => q.status === "approved").length,
      rejected: quotations.filter((q) => q.status === "rejected").length,
      invoiced: quotations.filter((q) => q.status === "invoiced").length
    };

    return res.json({
      success: true,
      role,
      branch_ids: userBranches,
      summary,
      total: quotations.length,
      quotations
    });
  } catch (err) {
    console.error("listQuotations error:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
exports.reportandanalysis = async (req, res) => {
  try {

    // ===============================
    // 🔐 ROLE FIX
    // ===============================
    let role = req.user?.role || "";

    if (typeof role === "object") {
      role = role.name;
    }

    const branchId = req.user?.branch_id || null;
    const isSuperSales = role === "super_sales_manager";

    const whereClause = isSuperSales
      ? ""
      : branchId
      ? `WHERE branch_id = ${branchId}`
      : "";

    const branchCondition = isSuperSales
      ? ""
      : branchId
      ? `AND branch_id = ${branchId}`
      : "";

    // ===============================
    // 1. CARDS
    // ===============================
    const cards = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        COALESCE(SUM(total_amount),0) AS revenue,
        COALESCE(AVG(total_amount),0) AS "avgOrderValue",
        COUNT(*) AS "totalOrders",
        COUNT(DISTINCT client_id) AS "activeClients"
      FROM quotations
      ${whereClause}
      GROUP BY branch_id
    `);

    // ===============================
    // 2. REVENUE TREND
    // ===============================
    const revenueTrend = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        TO_CHAR("createdAt",'Mon') AS month,
        SUM(total_amount) AS revenue,
        COUNT(*) AS orders
      FROM quotations
      ${whereClause}
      GROUP BY branch_id, month, DATE_TRUNC('month',"createdAt")
      ORDER BY branch_id, DATE_TRUNC('month',"createdAt")
    `);

    // ===============================
    // 3. CATEGORY DISTRIBUTION
    // ===============================
    const categoryDistribution = await sequelize.query(`
      SELECT 
        q.branch_id AS "branchId",
        COALESCE(qi.product_name, 'Others') AS name,
        SUM(qi.amount) AS value
      FROM quotation_items qi
      JOIN quotations q ON q.id = qi.quotation_id
      ${isSuperSales ? "" : branchId ? `WHERE q.branch_id = ${branchId}` : ""}
      GROUP BY q.branch_id, qi.product_name
    `);

    // ===============================
    // 4. WEEKLY ACTIVITY
    // ===============================
    const weeklyActivity = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        TO_CHAR("createdAt",'Dy') AS day,
        COUNT(*) FILTER (WHERE status='pending') AS quotations,
        COUNT(*) FILTER (WHERE status='approved') AS approved,
        COUNT(*) FILTER (WHERE status='invoiced') AS invoices
      FROM quotations
      WHERE "createdAt" >= NOW() - INTERVAL '7 days'
      ${branchCondition}
      GROUP BY branch_id, day
      ORDER BY branch_id, MIN("createdAt")
    `);

    // ===============================
    // 5. PROFIT ANALYSIS
    // ===============================
    const profitAnalysis = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        TO_CHAR("createdAt",'Mon') AS month,
        SUM(total_amount * 0.2) AS profit
      FROM quotations
      ${whereClause}
      GROUP BY branch_id, month, DATE_TRUNC('month',"createdAt")
      ORDER BY branch_id, DATE_TRUNC('month',"createdAt")
    `);

    // ===============================
    // 6. TOP PRODUCTS
    // ===============================
    const topProducts = await sequelize.query(`
      SELECT 
        q.branch_id AS "branchId",
        qi.product_name,
        SUM(qi.quantity) AS sales,
        SUM(qi.amount) AS revenue
      FROM quotation_items qi
      JOIN quotations q ON q.id = qi.quotation_id
      ${isSuperSales ? "" : branchId ? `WHERE q.branch_id = ${branchId}` : ""}
      GROUP BY q.branch_id, qi.product_name
      ORDER BY q.branch_id, sales DESC
    `);

    // ===============================
    // 7. RECENT TRANSACTIONS
    // ===============================
    const recentTransactions = await sequelize.query(`
      SELECT 
        q.branch_id AS "branchId",
        q.quotation_no AS invoice,
        c.name AS client,
        q.total_amount AS amount,
        q.status
      FROM quotations q
      LEFT JOIN clients c ON c.id = q.client_id
      ${isSuperSales ? "" : branchId ? `WHERE q.branch_id = ${branchId}` : ""}
      ORDER BY q.branch_id, q."createdAt" DESC
      LIMIT 20
    `);

    // ===============================
    // 8. INVENTORY STATUS
    // ===============================
    const inventoryStatus = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        COUNT(*) FILTER (WHERE status='GOOD') AS "inStock",
        COUNT(*) FILTER (WHERE status='REPAIRABLE') AS "lowStock",
        COUNT(*) FILTER (WHERE status='DAMAGED') AS "outOfStock"
      FROM stocks
      ${whereClause}
      GROUP BY branch_id
    `);

    // ===============================
    // 9. CLIENT BREAKDOWN
    // ===============================
    const clientBreakdown = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days') AS "newClients",
        COUNT(*) FILTER (WHERE "createdAt" < NOW() - INTERVAL '30 days') AS "returningClients"
      FROM clients
      ${whereClause}
      GROUP BY branch_id
    `);

    // ===============================
    // 10. QUICK STATS
    // ===============================
    const quickStats = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        COUNT(*) FILTER (WHERE status='approved') AS "approvedQuotations",
        COUNT(*) FILTER (WHERE status='invoiced') AS "invoicesGenerated",
        COUNT(*) FILTER (WHERE status='pending') AS "pendingApprovals"
      FROM quotations
      ${whereClause}
      GROUP BY branch_id
    `);

    // ===============================
    // 🔥 SUPER → GROUP DATA SAFE
    // ===============================
    let groupedData = null;

    if (isSuperSales) {
      const grouped = {};

      const init = (b) => {
        if (!grouped[b]) {
          grouped[b] = {
            branchId: b,
            cards: {},
            revenueTrend: [],
            categoryDistribution: [],
            weeklyActivity: [],
            profitAnalysis: [],
            topProducts: [],
            recentTransactions: [],
            inventoryStatus: {},
            clientBreakdown: {},
            quickStats: {}
          };
        }
      };

      (cards[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].cards = i; });
      (revenueTrend[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].revenueTrend.push(i); });
      (categoryDistribution[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].categoryDistribution.push(i); });
      (weeklyActivity[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].weeklyActivity.push(i); });
      (profitAnalysis[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].profitAnalysis.push(i); });
      (topProducts[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].topProducts.push(i); });
      (recentTransactions[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].recentTransactions.push(i); });
      (inventoryStatus[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].inventoryStatus = i; });
      (clientBreakdown[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].clientBreakdown = i; });
      (quickStats[0] || []).forEach(i => { init(i.branchId); grouped[i.branchId].quickStats = i; });

      groupedData = Object.values(grouped);
    }

    // ===============================
    // FINAL RESPONSE
    // ===============================
    return res.json({
      success: true,

      ...(isSuperSales
        ? { branches: groupedData || [] }
        : {
            cards: cards[0]?.[0] || {},
            revenueTrend: revenueTrend[0] || [],
            categoryDistribution: categoryDistribution[0] || [],
            weeklyActivity: weeklyActivity[0] || [],
            profitAnalysis: profitAnalysis[0] || [],
            topProducts: topProducts[0] || [],
            recentTransactions: recentTransactions[0] || [],
            inventoryStatus: inventoryStatus[0]?.[0] || {},
            clientBreakdown: clientBreakdown[0]?.[0] || {},
            quickStats: quickStats[0]?.[0] || {}
          })
    });

  } catch (err) {
    console.error("❌ REPORT ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

//top screen work on this 
exports.getAdvancedSalesAnalytics = async (req, res) => {
  try {
    const branchId = req.user?.branch_id || null;
    const role = req.user?.role || "";

    // super level users
    const isSuperView =
      role === "super_sales_manager" || role === "super_admin";

    const whereClause = isSuperView
      ? ""
      : branchId
      ? `WHERE branch_id = ${branchId}`
      : "";

    // ===============================
    // 1. QUICK ACTION CARDS
    // ===============================
const quickCards = await sequelize.query(`
  SELECT 
    COALESCE(SUM(total_amount),0) AS "totalSale",

    COALESCE(SUM(
      CASE 
        WHEN DATE("createdAt") = CURRENT_DATE THEN total_amount
        ELSE 0
      END
    ),0) AS "todaySale",

    COUNT(*) AS "totalOrders",

    COUNT(*) FILTER (WHERE status='pending') AS "pendingQuotation",
    COUNT(*) FILTER (WHERE status='invoiced') AS "readyToDispatch"

  FROM quotations
  ${isSuperView ? "" : branchId ? `WHERE branch_id = ${branchId}` : ""}
`);

    // ===============================
    // 2. SALES ANALYTICS
    // ===============================
    const salesAnalytics = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        TO_CHAR("createdAt",'Mon') AS month,

        SUM(CASE WHEN reference_no IS NOT NULL THEN total_amount ELSE 0 END) AS "onlineSales",
        SUM(CASE WHEN reference_no IS NULL THEN total_amount ELSE 0 END) AS "offlineSales"

      FROM quotations
      ${whereClause}
      GROUP BY branch_id, month, DATE_TRUNC('month',"createdAt")
      ORDER BY branch_id, DATE_TRUNC('month',"createdAt")
    `);

    // ===============================
    // 2B. GLOBAL SALES ANALYTICS
    // only for super users
    // ===============================
    let globalSalesAnalytics = [];

    if (isSuperView) {
      const globalAnalytics = await sequelize.query(`
        SELECT
          TO_CHAR("createdAt",'Mon') AS month,
          DATE_TRUNC('month',"createdAt") AS "monthDate",

          SUM(CASE WHEN reference_no IS NOT NULL THEN total_amount ELSE 0 END) AS "onlineSales",
          SUM(CASE WHEN reference_no IS NULL THEN total_amount ELSE 0 END) AS "offlineSales"

        FROM quotations
        GROUP BY month, DATE_TRUNC('month',"createdAt")
        ORDER BY DATE_TRUNC('month',"createdAt")
      `);

      globalSalesAnalytics = globalAnalytics[0];
    }

    // ===============================
    // 3. QUOTATION STATUS
    // ===============================
    const quotationStatus = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",

        COUNT(*) FILTER (WHERE status='pending') AS "pending",
        COUNT(*) FILTER (WHERE status='approved') AS "approved",
        COUNT(*) FILTER (WHERE status='rejected') AS "rejected",
        COUNT(*) FILTER (WHERE status='invoiced') AS "invoiced",

        COALESCE(SUM(total_amount),0) AS "totalValue"

      FROM quotations
      ${whereClause}
      GROUP BY branch_id
    `);

    // ===============================
    // 3B. GLOBAL QUOTATION STATUS
    // only for super users
    // ===============================
    let globalQuotationStatus = null;

    if (isSuperView) {
      const globalStatus = await sequelize.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status='pending') AS "pending",
          COUNT(*) FILTER (WHERE status='approved') AS "approved",
          COUNT(*) FILTER (WHERE status='rejected') AS "rejected",
          COUNT(*) FILTER (WHERE status='invoiced') AS "invoiced",
          COALESCE(SUM(total_amount),0) AS "totalValue"
        FROM quotations
      `);

      globalQuotationStatus = globalStatus[0][0];
    }

    // ===============================
    // 4. CATEGORY SALES
    // ===============================
    const categorySales = await sequelize.query(`
      SELECT 
        q.branch_id AS "branchId",
        qi.product_name AS category,
        SUM(qi.quantity) AS units,
        SUM(qi.amount) AS revenue

      FROM quotation_items qi
      JOIN quotations q ON q.id = qi.quotation_id

      ${isSuperView ? "" : branchId ? `WHERE q.branch_id = ${branchId}` : ""}

      GROUP BY q.branch_id, qi.product_name
      ORDER BY q.branch_id, units DESC
    `);

    // ===============================
    // 4B. GLOBAL CATEGORY SALES
    // only for super users
    // ===============================
    let globalCategorySales = [];

    if (isSuperView) {
      const globalCategory = await sequelize.query(`
        SELECT 
          qi.product_name AS category,
          SUM(qi.quantity) AS units,
          SUM(qi.amount) AS revenue

        FROM quotation_items qi
        JOIN quotations q ON q.id = qi.quotation_id

        GROUP BY qi.product_name
        ORDER BY units DESC
      `);

      globalCategorySales = globalCategory[0];
    }

    // ===============================
    // 5. RECENT ACTIVITY
    // ===============================
    const recentActivity = await sequelize.query(`
      SELECT 
        q.branch_id AS "branchId",
        q.quotation_no,
        c.name AS client,
        q.total_amount,
        q.status,
        q."createdAt"

      FROM quotations q
      LEFT JOIN clients c ON c.id = q.client_id

      ${isSuperView ? "" : branchId ? `WHERE q.branch_id = ${branchId}` : ""}

      ORDER BY q."createdAt" DESC
      LIMIT 20
    `);
    let globalRecentActivity = [];

if (isSuperView) {
  const globalRecent = await sequelize.query(`
    SELECT 
      q.branch_id AS "branchId",
      q.quotation_no,
      c.name AS client,
      q.total_amount,
      q.status,
      q."createdAt"

    FROM quotations q
    LEFT JOIN clients c ON c.id = q.client_id

    ORDER BY q."createdAt" DESC
    LIMIT 20
  `);

  globalRecentActivity = globalRecent[0];
}

    // ===============================
    // 6. GLOBAL SUMMARY
    // only for super users
    // ===============================
    let globalSummary = null;

    if (isSuperView) {
      const summary = await sequelize.query(`
        SELECT 
          COALESCE(SUM(total_amount),0) AS "totalSale",
          COUNT(*) AS "totalOrders",

          SUM(CASE WHEN reference_no IS NOT NULL THEN total_amount ELSE 0 END) AS "onlineSales",
          SUM(CASE WHEN reference_no IS NULL THEN total_amount ELSE 0 END) AS "offlineSales",

          COUNT(*) FILTER (WHERE status='pending') AS "pending",
          COUNT(*) FILTER (WHERE status='approved') AS "approved",
          COUNT(*) FILTER (WHERE status='rejected') AS "rejected",
          COUNT(*) FILTER (WHERE status='invoiced') AS "invoiced"
        FROM quotations
      `);

      globalSummary = summary[0][0];
    }

    // ===============================
    // SUPER → GROUP BY BRANCH
    // ===============================
    let groupedData = null;

    if (isSuperView) {
      const grouped = {};

      const init = (b) => {
        if (!grouped[b]) {
          grouped[b] = {
            branchId: b,
            salesAnalytics: [],
            quotationStatus: {},
            categorySales: [],
            recentActivity: []
          };
        }
      };

      salesAnalytics[0].forEach((i) => {
        init(i.branchId);
        grouped[i.branchId].salesAnalytics.push(i);
      });

      quotationStatus[0].forEach((i) => {
        init(i.branchId);
        grouped[i.branchId].quotationStatus = i;
      });

      categorySales[0].forEach((i) => {
        init(i.branchId);
        grouped[i.branchId].categorySales.push(i);
      });

      recentActivity[0].forEach((i) => {
        init(i.branchId);
        grouped[i.branchId].recentActivity.push(i);
      });

      groupedData = Object.values(grouped);
    }

    // ===============================
    // FINAL RESPONSE
    // ===============================
    res.json({
      success: true,
      quickAction: quickCards[0][0],

      ...(isSuperView
        ? {
            globalSummary,
            globalSalesAnalytics,
            globalQuotationStatus,
            globalCategorySales,
                   globalRecentActivity, 
            branches: groupedData
          }
        : {
            salesAnalytics: salesAnalytics[0],
            quotationStatus: quotationStatus[0][0] || {
              pending: 0,
              approved: 0,
              rejected: 0,
              invoiced: 0,
              totalValue: 0
            },
            categorySales: categorySales[0],
            recentActivity: recentActivity[0]
          })
    });
  } catch (err) {
    console.error("getAdvancedSalesAnalytics error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

exports.getClientLedgerSummary = async (req, res) => {
  try {
    const branchId = req.user?.branch_id || null;
    const role = req.user?.role || "";

    const isSuperSales = role === "super_sales_manager";

    // SAME access logic
    const whereClause = isSuperSales
      ? ""
      : branchId
      ? `WHERE c.branch_id = ${branchId}`
      : "";

    // ACTUAL DATA FROM client_ledger
    const data = await sequelize.query(`
      SELECT 
        c.id AS "clientId",
        c.name AS "companyName",
        c.email,
        c.phone,
        c.branch_id AS "branchId",
        COALESCE(c.gst_number, 'N/A') AS "gstNumber",

        COUNT(cl.id) AS "totalEntries",

        COALESCE(SUM(
          CASE WHEN cl.type = 'SALE' THEN cl.amount ELSE 0 END
        ), 0) AS "totalAmount",

        COALESCE(SUM(
          CASE WHEN cl.type = 'PAYMENT' THEN cl.amount ELSE 0 END
        ), 0) AS "revenue",

        COALESCE(SUM(
          CASE WHEN cl.type = 'SALE' THEN cl.amount ELSE 0 END
        ), 0)
        -
        COALESCE(SUM(
          CASE WHEN cl.type = 'PAYMENT' THEN cl.amount ELSE 0 END
        ), 0) AS "pendingAmount"

      FROM clients c
      LEFT JOIN client_ledger cl 
        ON cl.client_id = c.id

      ${whereClause}

      GROUP BY c.id
      ORDER BY c.branch_id, "totalAmount" DESC
    `);

    let clients = data[0];

    // SAME grouping for super_sales_manager
    if (isSuperSales) {
      const grouped = {};

      clients.forEach(client => {
        const branch = client.branchId;

        if (!grouped[branch]) {
          grouped[branch] = {
            branchId: branch,
            totalClients: 0,
            totalEntries: 0,
            totalAmount: 0,
            pendingAmount: 0,
            revenue: 0,
            clients: []
          };
        }

        grouped[branch].clients.push(client);

        grouped[branch].totalClients += 1;
        grouped[branch].totalEntries += Number(client.totalEntries || 0);
        grouped[branch].totalAmount += Number(client.totalAmount || 0);
        grouped[branch].pendingAmount += Number(client.pendingAmount || 0);
        grouped[branch].revenue += Number(client.revenue || 0);
      });

      clients = Object.values(grouped);
    }

    // SAME branchSummary
    let branchSummary = [];

    if (isSuperSales) {
      const branchData = await sequelize.query(`
        SELECT 
          c.branch_id AS "branchId",

          COUNT(DISTINCT c.id) AS "totalClients",
          COUNT(cl.id) AS "totalEntries",

          COALESCE(SUM(
            CASE WHEN cl.type = 'SALE' THEN cl.amount ELSE 0 END
          ), 0) AS "totalAmount",

          COALESCE(SUM(
            CASE WHEN cl.type = 'PAYMENT' THEN cl.amount ELSE 0 END
          ), 0) AS "revenue",

          COALESCE(SUM(
            CASE WHEN cl.type = 'SALE' THEN cl.amount ELSE 0 END
          ), 0)
          -
          COALESCE(SUM(
            CASE WHEN cl.type = 'PAYMENT' THEN cl.amount ELSE 0 END
          ), 0) AS "pendingAmount"

        FROM clients c
        LEFT JOIN client_ledger cl 
          ON cl.client_id = c.id

        GROUP BY c.branch_id
        ORDER BY "totalAmount" DESC
      `);

      branchSummary = branchData[0];
    }

    res.json({
      success: true,
      clients,
      ...(isSuperSales && { branchSummary })
    });

  } catch (err) {
    console.error("getClientLedgerSummary error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};


exports.getClientLedgerDetails = async (req, res) => {
  try {
    const { clientId } = req.params;

    const branchId = req.user?.branch_id || null;
    const role = req.user?.role || "";

    const isSuperSales = role === "super_sales_manager";

    // SAME access logic
    const branchFilter = isSuperSales
      ? ""
      : branchId
      ? `AND cl.branch_id = ${branchId}`
      : "";

    // ACTUAL LEDGER ENTRIES
    const data = await sequelize.query(`
      SELECT 
        cl.id AS "entryId",
        cl.type,
        cl.invoice_no AS "transactionId",
        c.name AS "client",
        cl.branch_id AS "branchId",
        TO_CHAR(cl."createdAt", 'DD/MM/YYYY, HH24:MI:SS') AS "dateTime",
        COALESCE(cl.amount,0) AS "amount",

        CASE 
          WHEN cl.type = 'PAYMENT' THEN cl.amount
          ELSE 0
        END AS "receivedAmount",

        CASE 
          WHEN cl.type = 'SALE' THEN cl.amount
          ELSE 0
        END AS "pendingAmount",

        cl.remark,
        cl.invoice_file AS "invoiceFile"

      FROM client_ledger cl
      LEFT JOIN clients c ON c.id = cl.client_id

      WHERE cl.client_id = :clientId
      ${branchFilter}

      ORDER BY cl."createdAt" DESC
    `, {
      replacements: { clientId }
    });

    const ledger = data[0];

    // Attach invoice items only for SALE
    for (let entry of ledger) {
      entry.items = [];

      if (entry.type === "SALE" && entry.transactionId) {
        try {
          const items = await sequelize.query(`
            SELECT 
              ii.id,
              ii.stock_id AS "stockId",
              ii.quantity,
              ii.rate,
              COALESCE(ii.total, ii.quantity * ii.rate, 0) AS total
            FROM invoice_items ii
            LEFT JOIN invoices i ON i.id = ii.invoice_id
            WHERE i.invoice_no = :invoiceNo
          `, {
            replacements: { invoiceNo: entry.transactionId }
          });

          entry.items = items[0];
        } catch (itemErr) {
          console.error("Invoice items fetch error:", itemErr.message);
          entry.items = [];
        }
      }
    }

    // REAL TOTALS
    const totalSales = ledger
      .filter(row => row.type === "SALE")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const totalReceived = ledger
      .filter(row => row.type === "PAYMENT")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const pendingAmount = totalSales - totalReceived;

    res.json({
      success: true,
      totalEntries: ledger.length,
      totalSales,
      totalReceived,
      pendingAmount,
      ledger
    });

  } catch (err) {
    console.error("getClientLedgerDetails error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
exports.getInvoiceDashboard = async (req, res) => {
  try {
    const branchId = req.user?.branch_id || null;
    const role = req.user?.role || "";

    const isSuperSales = role === "super_sales_manager";

    const whereClause = isSuperSales
      ? ""
      : branchId
      ? `WHERE branch_id = ${branchId}`
      : "";

    // ===============================
    // 1. TOP CARDS (ONLY DATA FIXED)
    // ===============================
    const stats = await sequelize.query(`
      SELECT 
        COUNT(*) AS "totalInvoice",

        COUNT(*) FILTER (
          WHERE status='draft'
          AND created_at >= NOW() - INTERVAL '7 days'
        ) AS "pendingInvoice",

        COUNT(*) FILTER (
          WHERE DATE(created_at) = CURRENT_DATE
        ) AS "todayInvoice",

        COUNT(*) FILTER (WHERE status='paid') AS "rejectedInvoice"

      FROM invoices
      ${whereClause}
    `);

    // ===============================
    // 2. INVOICE LIST (ONLY DATA FIXED)
    // ===============================
    const invoicesData = await sequelize.query(`
      SELECT 
        i.id,
        i.branch_id AS "branchId",
        i.invoice_no AS "invoiceNo",
        c.name AS client,
        i.total_amount AS amount,
        i.status,
        TO_CHAR(i.created_at, 'DD/MM/YYYY, HH24:MI') AS date,
        i.quotation_no AS "quotationRef"

      FROM invoices i
      LEFT JOIN clients c ON c.id = i.client_id

      ${isSuperSales ? "" : branchId ? `WHERE i.branch_id = ${branchId}` : ""}

      ORDER BY i.branch_id, i.created_at DESC
      LIMIT 50
    `);

    let invoices = invoicesData[0];

    // ===============================
    // 🔥 SUPER → GROUP BY BRANCH
    // ===============================
    if (isSuperSales) {
      const grouped = {};

      invoices.forEach(inv => {
        const branch = inv.branchId;

        if (!grouped[branch]) {
          grouped[branch] = {
            branchId: branch,
            totalInvoices: 0,
            totalAmount: 0,
            pending: 0,
            invoiced: 0,
            rejected: 0,
            invoices: []
          };
        }

        grouped[branch].invoices.push(inv);

        grouped[branch].totalInvoices += 1;
        grouped[branch].totalAmount += Number(inv.amount);

        if (inv.status === "draft") grouped[branch].pending++;
        if (inv.status === "final") grouped[branch].invoiced++;
        if (inv.status === "paid") grouped[branch].rejected++;
      });

      invoices = Object.values(grouped);
    }

    // ===============================
    // FINAL RESPONSE
    // ===============================
    res.json({
      success: true,
      stats: stats[0][0],
      invoices
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
exports.getSuperAdminDashboard = async (req, res) => {
  try {

    const quotations = await Quotation.findAll({
      attributes: [
        "id",
        "total_amount",
        "status",
        "createdAt"
      ],
      include: [
        {
          model: Client,
          as: "client",
          attributes: ["id", "name", "address"]
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "location"]
        }
      ]
    });

    // =========================
    // 🧠 GROUPING
    // =========================
    const dashboard = {};

    quotations.forEach((q) => {

      // 🔥 extract state + city
      let state = "Unknown";
      let city = "Unknown";

      if (q.client?.address) {
        const parts = q.client.address.split(",");

        state = parts[parts.length - 1]?.trim() || "Unknown";
        city = parts[parts.length - 2]?.trim() || "Unknown";
      }

      const branchName = q.branch?.name || "Unknown";

      // =========================
      // INIT STRUCTURE
      // =========================

      if (!dashboard[state]) dashboard[state] = {};
      if (!dashboard[state][city]) dashboard[state][city] = {};
      if (!dashboard[state][city][branchName]) {
        dashboard[state][city][branchName] = {
          total_quotations: 0,
          total_amount: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          invoiced: 0,
          top_clients: {}
        };
      }

      const branchData = dashboard[state][city][branchName];

      // =========================
      // COUNTING
      // =========================
      branchData.total_quotations += 1;
      branchData.total_amount += q.total_amount || 0;

      if (q.status === "pending") branchData.pending += 1;
      if (q.status === "approved") branchData.approved += 1;
      if (q.status === "rejected") branchData.rejected += 1;
      if (q.status === "invoiced") branchData.invoiced += 1;

      // =========================
      // TOP CLIENTS
      // =========================
      const clientName = q.client?.name || "Unknown";

      if (!branchData.top_clients[clientName]) {
        branchData.top_clients[clientName] = 0;
      }

      branchData.top_clients[clientName] += 1;
    });

    // =========================
    // 🔝 TOP CLIENT FORMAT
    // =========================
    Object.keys(dashboard).forEach((state) => {
      Object.keys(dashboard[state]).forEach((city) => {
        Object.keys(dashboard[state][city]).forEach((branch) => {

          const clients = dashboard[state][city][branch].top_clients;

          const sorted = Object.entries(clients)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

          dashboard[state][city][branch].top_clients = sorted;
        });
      });
    });

    res.json({
      success: true,
      data: dashboard
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
};

exports.getStateWiseSales = async (req, res) => {
  try {

    const branchId = req.user?.branch_id || null;
    let role = req.user?.role || "";

    if (typeof role === "object") role = role.name;

    const isSuper = role === "super_sales_manager";

    const whereClause = isSuper
      ? ""
      : branchId
      ? `WHERE q.branch_id = ${branchId}`
      : "";

    const data = await sequelize.query(`
      SELECT 
        b.state AS "state",
        b.name AS "branchName",
        b.location AS "city",
        q.branch_id AS "branchId",

        COUNT(q.id) AS "totalOrders",

        COALESCE(SUM(q.total_amount),0) AS "totalSales",

        COALESCE(SUM(
          CASE WHEN q.status != 'invoiced' THEN q.total_amount ELSE 0 END
        ),0) AS "pendingAmount",

        COALESCE(SUM(
          CASE WHEN q.status = 'invoiced' THEN q.total_amount ELSE 0 END
        ),0) AS "receivedAmount"

      FROM quotations q
      LEFT JOIN branches b ON b.id = q.branch_id

      ${whereClause}

      GROUP BY b.state, b.name, b.location, q.branch_id
      ORDER BY b.state, "totalSales" DESC
    `);

    const grouped = {};

    data[0].forEach(item => {
      const state = item.state || "Unknown";

      if (!grouped[state]) {
        grouped[state] = {
          state,
          totalSales: 0,
          pendingAmount: 0,
          receivedAmount: 0,
          branches: []
        };
      }

      grouped[state].branches.push({
        branchId: item.branchId,
        branchName: item.branchName,
        city: item.city,
        totalOrders: Number(item.totalOrders),
        totalSales: Number(item.totalSales),
        pendingAmount: Number(item.pendingAmount),
        receivedAmount: Number(item.receivedAmount)
      });

      grouped[state].totalSales += Number(item.totalSales);
      grouped[state].pendingAmount += Number(item.pendingAmount);
      grouped[state].receivedAmount += Number(item.receivedAmount);
    });

    res.json({
      success: true,
      data: Object.values(grouped)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
exports.getBranchesByState = async (req, res) => {
  try {

    const { state } = req.params;

    let role = req.user?.role || "";
    if (typeof role === "object") role = role.name;

    const branchId = req.user?.branch_id || null;
    const isSuper = role === "super_sales_manager";

    const whereClause = isSuper
      ? `WHERE TRIM(SPLIT_PART(c.address, ',', array_length(string_to_array(c.address, ','),1))) = :state`
      : branchId
      ? `WHERE q.branch_id = ${branchId}
         AND TRIM(SPLIT_PART(c.address, ',', array_length(string_to_array(c.address, ','),1))) = :state`
      : "";

    const data = await sequelize.query(`
      SELECT 
        q.branch_id AS "branchId",

        COUNT(q.id) AS "totalOrders",

        COALESCE(SUM(q.total_amount),0) AS "totalSales",

        COALESCE(SUM(
          CASE 
            WHEN q.status != 'invoiced' THEN q.total_amount 
            ELSE 0 
          END
        ),0) AS "pendingAmount",

        COALESCE(SUM(
          CASE 
            WHEN q.status = 'invoiced' THEN q.total_amount 
            ELSE 0 
          END
        ),0) AS "receivedAmount"

      FROM quotations q

      LEFT JOIN clients c ON c.id = q.client_id

      ${whereClause}

      GROUP BY q.branch_id
      ORDER BY "totalSales" DESC
    `, {
      replacements: { state }
    });

    res.json({
      success: true,
      state,
      branches: data[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};


exports.getStateDetailsDashboard = async (req, res) => {
  try {

    const user = req.user;
    const role = user?.role?.name || user?.role;

    const SUPER_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager"
    ];

    // =========================
    // 🔐 ACCESS CONTROL
    // =========================
    if (!SUPER_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "❌ Access Denied"
      });
    }

    const { stateName } = req.params;

    // =========================
    // 🔥 BRANCH FILTER (IMPORTANT)
    // =========================
    const branchFilter = getBranchFilter(user);

    let branchCondition = "";
    let replacements = { stateName };

    // 👉 APPLY FILTER ONLY IF NOT SUPER
    if (Object.keys(branchFilter).length > 0) {
      if (branchFilter.branch_id?.[Symbol.for("sequelize.operator")]) {
        // safety (optional)
      }

      if (branchFilter.branch_id?.[Op.in]) {
        branchCondition = `AND b.id IN (:branchIds)`;
        replacements.branchIds = branchFilter.branch_id[Op.in];
      } else if (branchFilter.branch_id) {
        branchCondition = `AND b.id = :branchId`;
        replacements.branchId = branchFilter.branch_id;
      }
    }

    // =========================
    // 📊 BRANCH SUMMARY
    // =========================
    const branchData = await sequelize.query(`
      SELECT 
        b.id AS "branchId",
        b.name AS "branchName",

        COUNT(DISTINCT b.id) AS "totalBranches",

        COALESCE(SUM(s.quantity),0) AS "totalStock",
        COALESCE(SUM(s.value),0) AS "totalValue",

        COALESCE(SUM(s.quantity),0) AS "currentStock",

        COALESCE(SUM(
          CASE WHEN l.type = 'PURCHASE' THEN l.quantity ELSE 0 END
        ),0) AS "stockIn",

        COALESCE(SUM(
          CASE WHEN l.type = 'SALE' THEN l.quantity ELSE 0 END
        ),0) AS "stockOut",

        COALESCE(SUM(
          CASE WHEN l.type = 'PURCHASE' THEN 1 ELSE 0 END
        ),0) AS "purchaseCount",

        COALESCE(SUM(
          CASE WHEN l.type = 'SALE' THEN 1 ELSE 0 END
        ),0) AS "salesCount"

      FROM branches b
      LEFT JOIN stocks s ON s.branch_id = b.id
      LEFT JOIN ledger l ON l.branch_id = b.id

      WHERE b.state = :stateName
      ${branchCondition}

      GROUP BY b.id
      ORDER BY "totalValue" DESC
    `, {
      replacements
    });

    // =========================
    // 📊 CHART DATA
    // =========================
    const chartData = branchData[0].map((b) => ({
      label: b.branchName,
      value: Number(b.totalValue)
    }));

    // =========================
    // 🔝 TOP BRANCHES
    // =========================
    const topBranches = [...branchData[0]]
      .sort((a, b) => Number(b.totalValue) - Number(a.totalValue))
      .slice(0, 5);

    // =========================
    // 📈 SUMMARY
    // =========================
    const summary = await sequelize.query(`
      SELECT 
        COALESCE(SUM(s.value),0) AS "totalStockValue",
        COALESCE(SUM(s.quantity),0) AS "currentStock",
        COUNT(s.id) AS "totalItems",

        COALESCE(SUM(
          CASE WHEN l.type = 'PURCHASE' THEN l.quantity ELSE 0 END
        ),0) AS "stockIn",

        COALESCE(SUM(
          CASE WHEN l.type = 'SALE' THEN l.quantity ELSE 0 END
        ),0) AS "stockOut"

      FROM branches b
      LEFT JOIN stocks s ON s.branch_id = b.id
      LEFT JOIN ledger l ON l.branch_id = b.id

      WHERE b.state = :stateName
      ${branchCondition}
    `, {
      replacements
    });

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    return res.json({
      success: true,
      state: stateName,
      summary: summary[0][0],
      branches: branchData[0],
      charts: {
        branchValueChart: chartData
      },
      topBranches
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};


exports.getAllStatesDashboard = async (req, res) => {
  try {
    const role = req.user?.role?.name || req.user?.role;

    const SUPER_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager"
    ];

    if (!SUPER_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "❌ Access Denied"
      });
    }

    // =========================
    // 🟦 CARDS
    // =========================
    const summaryData = await sequelize.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type='SALE' THEN total ELSE 0 END),0) AS "totalRevenue",
        COALESCE(SUM(CASE WHEN type='PURCHASE' THEN total ELSE 0 END),0) AS "totalPurchase",
        COALESCE(SUM(CASE WHEN type='SALE' THEN quantity ELSE 0 END),0) AS "totalSales"
      FROM ledger
    `, { type: QueryTypes.SELECT });

    const totalRevenue = Number(summaryData[0].totalRevenue || 0);
    const totalPurchase = Number(summaryData[0].totalPurchase || 0);
    const totalSales = Number(summaryData[0].totalSales || 0);

    const branchCount = await sequelize.query(`
      SELECT COUNT(*) AS count FROM branches
    `, { type: QueryTypes.SELECT });

    // =========================
    // 📊 SALES TREND (FIXED)
    // =========================
    const salesTrend = await sequelize.query(`
      SELECT 
        DATE_TRUNC('week', "createdAt") AS week,

        SUM(CASE WHEN type='SALE' THEN quantity ELSE 0 END) AS sales,
        SUM(CASE WHEN type='PURCHASE' THEN quantity ELSE 0 END) AS purchase

      FROM ledger
      GROUP BY week
      ORDER BY week ASC
    `, { type: QueryTypes.SELECT });

    // =========================
    // 📉 QUOTATION TREND (FIXED)
    // =========================
    const quotationTrend = await sequelize.query(`
      SELECT 
        DATE_TRUNC('week', "createdAt") AS week,

        COUNT(CASE WHEN status='pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN status='rejected' THEN 1 END) AS rejected

      FROM quotations
      GROUP BY week
      ORDER BY week ASC
    `, { type: QueryTypes.SELECT });

    // =========================
    // 📋 STATE TABLE (NO DUPLICATE ISSUE)
    // =========================
    const statesData = await sequelize.query(`
      SELECT 
        UPPER(TRIM(b.state)) AS state,

        COUNT(DISTINCT b.id) AS "totalBranches",

        COALESCE(SUM(l.sales_qty),0) AS "totalSales",
        COALESCE(SUM(l.sales_amount),0) AS "totalRevenue",
        COALESCE(SUM(q.pending_qt),0) AS "pendingQuotation"

      FROM branches b

      LEFT JOIN (
        SELECT 
          branch_id,
          SUM(CASE WHEN type='SALE' THEN quantity ELSE 0 END) AS sales_qty,
          SUM(CASE WHEN type='SALE' THEN total ELSE 0 END) AS sales_amount
        FROM ledger
        GROUP BY branch_id
      ) l ON l.branch_id = b.id

      LEFT JOIN (
        SELECT 
          branch_id,
          COUNT(CASE WHEN status='pending' THEN 1 END) AS pending_qt
        FROM quotations
        GROUP BY branch_id
      ) q ON q.branch_id = b.id

      WHERE 
        b.state IS NOT NULL
        AND TRIM(b.state) != ''
        AND LOWER(TRIM(b.state)) NOT IN ('state','test','dummy')

      GROUP BY UPPER(TRIM(b.state))
      ORDER BY "totalRevenue" DESC
    `, { type: QueryTypes.SELECT });

    // =========================
    // 🧹 CLEAN DATA
    // =========================
    const cleanedStates = statesData.map(s => ({
      state: s.state,
      totalBranches: Number(s.totalBranches),
      totalSales: Number(s.totalSales),
      totalRevenue: Number(s.totalRevenue),
      pendingQuotation: Number(s.pendingQuotation)
    }));

    // =========================
    // 📊 STATE CHART
    // =========================
    const stateChart = cleanedStates.map(s => ({
      label: s.state,
      value: s.totalRevenue
    }));

    // =========================
    // 🔝 TOP STATES
    // =========================
    const topStates = [...cleanedStates]
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5);

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    return res.json({
      success: true,

      // 🟦 CARDS
      cards: {
        totalRevenue,
        totalProfit: totalRevenue - totalPurchase,
        totalSales,
        totalBranches: Number(branchCount[0].count)
      },

      // 📊 CHARTS
      charts: {
        salesTrend,
        quotationTrend,
        stateRevenueChart: stateChart
      },

      // 📋 TABLE
      states: cleanedStates,

      // 🔝 TOP
      topStates
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};



exports.getStateDashboard = async (req, res) => {
  try {
    const role = req.user?.role?.name || req.user?.role;

    const SUPER_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager"
    ];

    if (!SUPER_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "❌ Access Denied"
      });
    }

    const { state } = req.params;

    // =========================
    // 🟦 CARDS
    // =========================
    const summary = await sequelize.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN l.type='SALE' THEN l.quantity ELSE 0 END),0) AS "totalSales",

        COALESCE(SUM(CASE WHEN q.status='pending' THEN 1 ELSE 0 END),0) AS "pendingQuotation",

        COALESCE(SUM(
          CASE 
            WHEN l.type='SALE' 
            AND DATE_TRUNC('month', l."createdAt") = DATE_TRUNC('month', CURRENT_DATE)
            THEN l.quantity 
            ELSE 0 
          END
        ),0) AS "salesThisMonth",

        COALESCE(COUNT(DISTINCT c.id),0) AS "totalClients"

      FROM branches b
      LEFT JOIN ledger l ON l.branch_id = b.id
      LEFT JOIN quotations q ON q.branch_id = b.id
      LEFT JOIN clients c ON c.branch_id = b.id

      WHERE UPPER(TRIM(b.state)) = UPPER(TRIM(:state))
    `, {
      replacements: { state },
      type: QueryTypes.SELECT
    });

    // =========================
    // 📊 STOCK IN / OUT CHART
    // =========================
    const stockChart = await sequelize.query(`
      SELECT 
        DATE_TRUNC('week', l."createdAt") AS week,

        SUM(CASE WHEN l.type='PURCHASE' THEN l.quantity ELSE 0 END) AS stockIn,
        SUM(CASE WHEN l.type='SALE' THEN l.quantity ELSE 0 END) AS stockOut

      FROM ledger l
      JOIN branches b ON b.id = l.branch_id

      WHERE UPPER(TRIM(b.state)) = UPPER(TRIM(:state))

      GROUP BY week
      ORDER BY week ASC
    `, {
      replacements: { state },
      type: QueryTypes.SELECT
    });

    // =========================
    // 📉 QUOTATION CHART
    // =========================
    const quotationChart = await sequelize.query(`
      SELECT 
        DATE_TRUNC('week', q."createdAt") AS week,

        COUNT(CASE WHEN q.status='pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN q.status='rejected' THEN 1 END) AS rejected

      FROM quotations q
      JOIN branches b ON b.id = q.branch_id

      WHERE UPPER(TRIM(b.state)) = UPPER(TRIM(:state))

      GROUP BY week
      ORDER BY week ASC
    `, {
      replacements: { state },
      type: QueryTypes.SELECT
    });

    // =========================
    // 📋 BRANCH TABLE (NO DUPLICATE)
    // =========================
    const branches = await sequelize.query(`
      SELECT 
        b.id,
        b.name AS "branchName",

        COALESCE(l.sales_qty,0) AS "totalSales",
        COALESCE(l.sales_amount,0) AS "totalRevenue",

        COALESCE(c.total_clients,0) AS "totalClients",

        COALESCE(q.pending_qt,0) AS "pendingQuotation",
        COALESCE(q.rejected_qt,0) AS "rejectedQuotation"

      FROM branches b

      LEFT JOIN (
        SELECT 
          branch_id,
          SUM(CASE WHEN type='SALE' THEN quantity ELSE 0 END) AS sales_qty,
          SUM(CASE WHEN type='SALE' THEN total ELSE 0 END) AS sales_amount
        FROM ledger
        GROUP BY branch_id
      ) l ON l.branch_id = b.id

      LEFT JOIN (
        SELECT 
          branch_id,
          COUNT(*) FILTER (WHERE status='pending') AS pending_qt,
          COUNT(*) FILTER (WHERE status='rejected') AS rejected_qt
        FROM quotations
        GROUP BY branch_id
      ) q ON q.branch_id = b.id

      LEFT JOIN (
        SELECT 
          branch_id,
          COUNT(*) AS total_clients
        FROM clients
        GROUP BY branch_id
      ) c ON c.branch_id = b.id

      WHERE UPPER(TRIM(b.state)) = UPPER(TRIM(:state))
      ORDER BY "totalRevenue" DESC
    `, {
      replacements: { state },
      type: QueryTypes.SELECT
    });

    // =========================
    // 🧹 FINAL CLEAN RESPONSE
    // =========================
    return res.json({
      success: true,
      state,

      cards: {
        totalSales: Number(summary[0].totalSales),
        pendingQuotation: Number(summary[0].pendingQuotation),
        salesThisMonth: Number(summary[0].salesThisMonth),
        totalClients: Number(summary[0].totalClients)
      },

      charts: {
        stockTrend: stockChart,
        quotationTrend: quotationChart
      },

      branches: branches.map(b => ({
        ...b,
        totalSales: Number(b.totalSales),
        totalRevenue: Number(b.totalRevenue),
        totalClients: Number(b.totalClients),
        pendingQuotation: Number(b.pendingQuotation),
        rejectedQuotation: Number(b.rejectedQuotation)
      }))
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

exports.getBranchDashboard = async (req, res) => {
  try {
    const role = req.user?.role?.name || req.user?.role;

    const SUPER_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager",
      "sales_manager"
    ];

    if (!SUPER_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "❌ Access Denied"
      });
    }

    const { branchId } = req.params;

    // =========================
    // 🟦 CARDS
    // =========================
    const summary = await sequelize.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type='SALE' THEN quantity ELSE 0 END),0) AS "totalSales",

        COALESCE(SUM(
          CASE WHEN type='SALE' AND DATE_TRUNC('month', "createdAt") = DATE_TRUNC('month', CURRENT_DATE)
          THEN quantity ELSE 0 END
        ),0) AS "salesThisMonth",

        COALESCE(SUM(
          CASE WHEN type='SALE' THEN total ELSE 0 END
        ),0) AS "totalRevenue"

      FROM ledger
      WHERE branch_id = :branchId
    `, {
      replacements: { branchId },
      type: QueryTypes.SELECT
    });

    // Pending QT
    const pendingQT = await sequelize.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status='pending') AS pending,
        COUNT(*) FILTER (WHERE status='rejected') AS rejected
      FROM quotations
      WHERE branch_id = :branchId
    `, {
      replacements: { branchId },
      type: QueryTypes.SELECT
    });

    // Clients
    const clientCount = await sequelize.query(`
      SELECT COUNT(*) AS total FROM clients WHERE branch_id = :branchId
    `, {
      replacements: { branchId },
      type: QueryTypes.SELECT
    });

    // =========================
    // 📊 STOCK IN / OUT CHART
    // =========================
    const stockChart = await sequelize.query(`
      SELECT 
        DATE_TRUNC('week', "createdAt") AS week,

        SUM(CASE WHEN type='PURCHASE' THEN quantity ELSE 0 END) AS stockIn,
        SUM(CASE WHEN type='SALE' THEN quantity ELSE 0 END) AS stockOut

      FROM ledger
      WHERE branch_id = :branchId

      GROUP BY week
      ORDER BY week ASC
    `, {
      replacements: { branchId },
      type: QueryTypes.SELECT
    });

    // =========================
    // 📉 QUOTATION CHART
    // =========================
    const quotationChart = await sequelize.query(`
      SELECT 
        DATE_TRUNC('week', "createdAt") AS week,

        COUNT(CASE WHEN status='pending' THEN 1 END) AS pending,
        COUNT(CASE WHEN status='rejected' THEN 1 END) AS rejected

      FROM quotations
      WHERE branch_id = :branchId

      GROUP BY week
      ORDER BY week ASC
    `, {
      replacements: { branchId },
      type: QueryTypes.SELECT
    });

    // =========================
    // 📋 PRODUCT TABLE (TOP ITEMS)
    // =========================
    const products = await sequelize.query(`
      SELECT 
        s.item AS "productName",
        s.category AS "category",

        SUM(CASE WHEN l.type='SALE' THEN l.quantity ELSE 0 END) AS "totalSales",
        SUM(CASE WHEN l.type='SALE' THEN l.total ELSE 0 END) AS "totalRevenue",

        COUNT(DISTINCT c.id) AS "clients",

        COUNT(CASE WHEN q.status='pending' THEN 1 END) AS "pendingQuotation",
        COUNT(CASE WHEN q.status='rejected' THEN 1 END) AS "rejectedQuotation"

      FROM stocks s
      LEFT JOIN ledger l ON l.stock_id = s.id
      LEFT JOIN quotations q ON q.branch_id = s.branch_id
      LEFT JOIN clients c ON c.branch_id = s.branch_id

      WHERE s.branch_id = :branchId

      GROUP BY s.item, s.category
      ORDER BY "totalRevenue" DESC
      LIMIT 10
    `, {
      replacements: { branchId },
      type: QueryTypes.SELECT
    });

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    return res.json({
      success: true,

      cards: {
        totalSales: Number(summary[0].totalSales),
        pendingQuotation: Number(pendingQT[0].pending),
        salesThisMonth: Number(summary[0].salesThisMonth),
        totalClients: Number(clientCount[0].total)
      },

      charts: {
        stockTrend: stockChart,
        quotationTrend: quotationChart
      },

      products: products.map(p => ({
        productName: p.productName,
        category: p.category,
        totalSales: Number(p.totalSales),
        totalRevenue: Number(p.totalRevenue),
        clients: Number(p.clients),
        pendingQuotation: Number(p.pendingQuotation),
        rejectedQuotation: Number(p.rejectedQuotation)
      }))
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

exports.getItemDashboard = async (req, res) => {
  try {
    const { itemId } = req.params;

  
    const summary = await sequelize.query(`
      SELECT 
        COALESCE(SUM(l.quantity),0) AS "totalQty",
        COALESCE(SUM(s.value),0) AS "stockValue",

        COALESCE(SUM(
          CASE WHEN l.type='SALE' THEN l.total ELSE 0 END
        ),0) AS "totalRevenue",

        COUNT(l.id) AS "totalInvoices"

      FROM ledger l
      JOIN stocks s ON s.id = l.stock_id

      WHERE l.stock_id = :itemId
    `, {
      replacements: { itemId },
      type: QueryTypes.SELECT
    });


    const stockChart = await sequelize.query(`
      SELECT 
        DATE_TRUNC('week', l."createdAt") AS week,

        SUM(CASE WHEN l.type='SALE' THEN l.quantity ELSE 0 END) AS sales,
        SUM(CASE WHEN l.type='PURCHASE' THEN l.quantity ELSE 0 END) AS purchase

      FROM ledger l
      WHERE l.stock_id = :itemId

      GROUP BY week
      ORDER BY week ASC
    `, {
      replacements: { itemId },
      type: QueryTypes.SELECT
    });

    const revenueChart = await sequelize.query(`
      SELECT 
        DATE_TRUNC('week', l."createdAt") AS week,

        SUM(CASE WHEN l.type='SALE' THEN l.total ELSE 0 END) AS revenue,
        SUM(CASE WHEN l.type='PURCHASE' THEN l.total ELSE 0 END) AS cost

      FROM ledger l
      WHERE l.stock_id = :itemId

      GROUP BY week
      ORDER BY week ASC
    `, {
      replacements: { itemId },
      type: QueryTypes.SELECT
    });

 
    const tableData = await sequelize.query(`
      SELECT 
        l."createdAt" AS date,

        l.reference_no AS "invoiceNumber",

        -- ✅ FIXED CLIENT (NO ERROR)
        'Direct Sale' AS "clientName",

        b.name AS "branch",

        l.quantity AS qty,
        l.rate,
        l.total AS amount,

        s.status,

        -- 🧠 AGING
        CASE 
          WHEN AGE(NOW(), l."createdAt") < INTERVAL '30 days' THEN '1 month'
          WHEN AGE(NOW(), l."createdAt") < INTERVAL '90 days' THEN '3 months'
          WHEN AGE(NOW(), l."createdAt") < INTERVAL '180 days' THEN '6 months'
          WHEN AGE(NOW(), l."createdAt") < INTERVAL '365 days' THEN '1 year'
          WHEN AGE(NOW(), l."createdAt") < INTERVAL '730 days' THEN '2 years'
          ELSE '2+ years'
        END AS "aging"

      FROM ledger l
      JOIN stocks s ON s.id = l.stock_id
      LEFT JOIN branches b ON b.id = l.branch_id

      WHERE l.stock_id = :itemId

      ORDER BY l."createdAt" DESC
      LIMIT 50
    `, {
      replacements: { itemId },
      type: QueryTypes.SELECT
    });

    
    const itemInfo = await sequelize.query(`
      SELECT item, category 
      FROM stocks 
      WHERE id = :itemId 
      LIMIT 1
    `, {
      replacements: { itemId },
      type: QueryTypes.SELECT
    });

   
    return res.json({
      success: true,

      item: itemInfo[0]?.item || "Unknown",
      category: itemInfo[0]?.category || "",

      cards: {
        totalQty: Number(summary[0].totalQty),
        stockValue: Number(summary[0].stockValue),
        totalRevenue: Number(summary[0].totalRevenue),
        totalInvoices: Number(summary[0].totalInvoices)
      },

      charts: {
        stockTrend: stockChart,
        revenueTrend: revenueChart
      },

      table: tableData.map(row => ({
        date: row.date,
        aging: row.aging,

        invoiceNumber: row.invoiceNumber,
        clientName: row.clientName,

        branch: row.branch,

        qty: Number(row.qty),
        rate: Number(row.rate),
        amount: Number(row.amount),

        status: row.status
      }))
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

exports.getInvoicePDF = async (req, res) => {
  try {
    const { invoice_no } = req.params;

    // id ki jagah invoice_no se fetch
    const invoice = await Invoice.findOne({
      where: { invoice_no }
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const items = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id } // id yahan same rahega
    });

    const client = await Client.findByPk(invoice.client_id);
    const branch = await Branch.findByPk(invoice.branch_id);

    const pdf = await generateGSTInvoicePDF({
      branch,
      invoice,
      client,
      items
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=${invoice.invoice_no}.pdf`
    });

    res.send(pdf);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};