const {
  Client,
  ClientLedger,
  Branch,
  Quotation,
  QuotationItem,
  Stock,
  Ledger,
  Invoice,
  StockMovement,
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
const { getOrSetCache } = require("../../../utils/redis/cache");
const Notification = require("../../../model/SQL_Model/notification");
// ✅ Add this
const { createClient } = require("@supabase/supabase-js");
const Role = require("../../../model/SQL_Model/role");
const  InventoryBatch  = require("../../../model/SQL_Model/InventoryBatch");
const BatchTimeline = require("../../../model/SQL_Model/batch_timelines");
const  {generateDCPDF}  = require("../../../utils/deliveryChallan.pdf");
const BranchBankAccount = require("../../../model/SQL_Model/BranchBankAccount");

// ✅ Add this
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);



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

  // =====================================
  // CLIENT NAME
  // =====================================

  const clientName =
    data.company_name ||
    data.name ||
    data.contact_person ||
    "";

  if (!clientName) {
    throw new Error("Client name is required");
  }

  // =====================================
  // BRANCH CLIENT FLOW
  // =====================================

  if (
    data.client_type === "BRANCH" &&
    data.linked_branch_id
  ) {

    let branchClient =
      await Client.findOne({
        where: {

          linked_branch_id:
            data.linked_branch_id,

          client_type:
            "BRANCH",

          branch_id:
            data.branch_id
        },

        transaction: t
      });

    // RETURN EXISTING

    if (branchClient) {
      return branchClient;
    }
  }

  // =====================================
  // NORMAL CLIENT SEARCH
  // =====================================

  let client = null;

  if (data.phone) {

    client = await Client.findOne({
      where: {
        phone: data.phone,
        branch_id: data.branch_id
      },
      transaction: t
    });

    if (client) return client;
  }

  // =====================================
  // CLIENT CODE
  // =====================================

  const last = await Client.findOne({

    where: {
      branch_id: data.branch_id
    },

    order: [
      ["created_at", "DESC"]
    ],

    transaction: t,

    lock: t.LOCK.UPDATE
  });

  let next = 1;

  if (last?.client_code) {

    const parts =
      String(last.client_code)
      .split("-");

    const parsed =
      Number(parts[1]);

    if (!isNaN(parsed)) {
      next = parsed + 1;
    }
  }

  const code =
    `BR${data.branch_id}-${String(next).padStart(4, "0")}`;

  // =====================================
  // CREATE CLIENT
  // =====================================

  client = await Client.create({

    name:
      clientName,

    phone:
      data.phone || null,

    email:
      data.email || null,

    address:
      data.address || null,

    gst_number:
      data.gst_number || null,

    branch_id:
      data.branch_id,

    client_code:
      code,

    // IMPORTANT

    client_type:
      data.client_type || "CUSTOMER",

    linked_branch_id:
      data.linked_branch_id || null

  }, {
    transaction: t
  });

  return client;
};
exports.createClient = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const {
      company_name,
      contact_person,
      phone,
      email,
      address,
        po_number,
      gst_number
    } = req.body;

    const branch_id = req.user.branch_id;

    const lastClient = await Client.findOne({
      where: { branch_id },
      order: [["created_at", "DESC"]],
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    let nextNumber = 1;

    if (lastClient?.client_code) {
      const lastNumber = parseInt(lastClient.client_code.split("-")[1], 10);
      if (!isNaN(lastNumber)) {
        nextNumber = lastNumber + 1;
      }
    }

    const client_code = `BR${branch_id}-${String(nextNumber).padStart(4, "0")}`;

    const client = await Client.create(
      {
        // ✅ sabse important fix
        name: company_name || contact_person || "",

        phone: phone || null,
        email: email || null,
        address: address || null,
        gst_number: gst_number || null,
        po_number: po_number || null,
        branch_id,
        client_code
      },
      { transaction: t }
    );

    await t.commit();

    return res.status(201).json({
      message: "Client created successfully",
      client
    });

  } catch (err) {
    await t.rollback();

    return res.status(500).json({
      error: err.message
    });
  }
};
exports.listClients = async (req, res) => {
  try {
    const { search = "", branch_id } = req.query;

    const user = req.user;

    const roleName = user.role?.name || user.role;

    let where = {};

    if (roleName !== "super_sales_manager") {
      where.branch_id = user.branch_id;
    }

    if (branch_id && roleName === "super_sales_manager") {
      where.branch_id = branch_id;
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } },
        { client_code: { [Op.iLike]: `%${search}%` } },
        { gst_number: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const clients = await Client.findAll({
      where,
      include: [
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name"]
        }
      ],
      order: [["created_at", "DESC"]]
    });

    const formatted = clients.map((c) => ({
      id: c.id,
      client_code: c.client_code,
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      gst_number: c.gst_number,
      credit_limit: c.credit_limit,
      branch_id: c.branch_id,
      branch_name: c.branch?.name || null,
      created_at: c.created_at,
      updated_at: c.updated_at
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

    const {
      client,
      products,
      gst_percent = 0,
      valid_till,
      is_branch_transfer = false,
        to_branch_id,
    } = req.body;

    const branch_id = req.user.branch_id;

    if (!branch_id) {

      await t.rollback();

      return res.status(400).json({
        success: false,
        error: "branch_id missing"
      });
    }

    if (!Array.isArray(products) || products.length === 0) {

      await t.rollback();

      return res.status(400).json({
        success: false,
        error: "Products required"
      });
    }

    // ================= CLIENT =================
    let clientData;

    if (client?.id) {

      clientData = await Client.findByPk(
        client.id,
        {
          transaction: t
        }
      );

      if (!clientData) {

        await t.rollback();

        return res.status(400).json({
          success: false,
          error: "Invalid client id"
        });
      }

    } else {

      clientData = await getOrCreateClient(
        {
          name: client?.name || "Walk-in Customer",
          phone: client?.phone || null,
          email: client?.email || null,
          address: client?.address || null,
          branch_id
        },
        t
      );
    }

    // ================= LOW STOCK CHECK =================
    const lowStockItems = [];

    for (const p of products) {

      const stock = await Stock.findOne({
        where: {
          item: p.product_name,
          branch_id
        },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      // ===== STOCK NOT FOUND =====
      if (!stock) {

        lowStockItems.push({
          product: p.product_name,
          available: 0,
          requested: Number(p.quantity),
          shortage: Number(p.quantity)
        });

        continue;
      }

      const availableQty =
        Number(stock.quantity || 0);

      const requestedQty =
        Number(p.quantity || 0);

      // ===== LOW STOCK =====
      if (availableQty < requestedQty) {

        lowStockItems.push({
          product: p.product_name,
          available: availableQty,
          requested: requestedQty,
          shortage: requestedQty - availableQty
        });
      }
    }

    // ================= LOW STOCK FLAG =================
    let hasLowStock = false;

    if (lowStockItems.length > 0) {

      hasLowStock = true;

      // ===== MESSAGE =====
      const notificationMessage =
        `Low stock detected for quotation request.\n\n` +

        lowStockItems.map(item =>
          `Item: ${item.product}\n` +
          `Available Qty: ${item.available}\n` +
          `Requested Qty: ${item.requested}\n` +
          `Short Qty: ${item.shortage}`
        ).join("\n\n") +

        `\n\nPlease arrange stock immediately.`;

      // ================= GET INVENTORY ROLE =================
      const inventoryRole = await Role.findOne({
        where: {
          name: "inventory_manager"
        }
      });

      let inventoryManagers = [];

      // ================= GET INVENTORY MANAGERS =================
      if (inventoryRole) {

        inventoryManagers = await User.findAll({
          where: {
            branch_id,
            role_id: inventoryRole.id
          }
        });
      }

      console.log(
        "FOUND INVENTORY MANAGERS =>",
        inventoryManagers
      );

      // ================= SEND NOTIFICATION =================
      for (const manager of inventoryManagers) {

        // ===== Notification =====
        await Notification.create({
          user_id: manager.id,
          title: "Low Stock Alert",
          message: notificationMessage,
          type: "LOW_STOCK"
        });

        // ===== Alert =====
        if (
          typeof Alert !== "undefined" &&
          Alert?.create
        ) {

          await Alert.create({
            user_id: manager.id,
            title: "Stock Arrangement Required",
            message: notificationMessage,
            type: "LOW_STOCK_ALERT"
          });
        }
      }
    }

    // ================= QUOTATION NO =================
    const last = await Quotation.findOne({
      where: { branch_id },
      order: [["id", "DESC"]],
      transaction: t
    });

    let next = 1;

    if (last?.quotation_no) {

      const num = parseInt(
        last.quotation_no
          .split("-")
          .pop(),
        10
      );

      if (!isNaN(num)) {
        next = num + 1;
      }
    }

    const quotation_no =
      `QT-${branch_id}-${String(next).padStart(4, "0")}`;

    // ================= TOTAL =================
    let subtotal = 0;

    for (const p of products) {

      subtotal +=
        Number(p.quantity) *
        Number(p.unit_price);
    }

    const gst_amount =
      (subtotal * Number(gst_percent)) / 100;

    const grand_total =
      subtotal + gst_amount;

    // ================= CREATE QUOTATION =================
    const quotation = await Quotation.create(
      {
        quotation_no,

        client_id: clientData.id,

        branch_id,

        total_amount: grand_total,

        gst_amount,

        valid_till: valid_till || null,

        status:
          is_branch_transfer
            ? "approved"
            : "pending",

        is_branch_transfer,

        from_branch_id: branch_id,

        to_branch_id:
          clientData.linked_branch_id || null
      },
      {
        transaction: t
      }
    );

    // ================= STOCK + BATCH + ITEMS =================
    for (const p of products) {

      const stock = await Stock.findOne({
        where: {
          item: p.product_name,
          branch_id
        },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      // ===== ONLY UPDATE IF STOCK EXISTS =====
     // ONLY VALIDATE STOCK
if (!stock) {
  await t.rollback();

  return res.status(400).json({
    success: false,
    error: `Stock not found: ${p.product_name}`
  });
}

      // ===== QUOTATION ITEM =====
      await QuotationItem.create(
        {
          quotation_id:
            quotation.id,

          product_name:
            p.product_name,

          quantity:
            p.quantity,

          unit_price:
            p.unit_price,

          unit:
            p.unit || "",

          hsn:
            p.hsn || "",

          specifications:
            p.specifications || {},

          cgst:
            (
              p.quantity *
              p.unit_price *
              gst_percent
            ) / 200,

          sgst:
            (
              p.quantity *
              p.unit_price *
              gst_percent
            ) / 200,

          subtotal:
            p.quantity *
            p.unit_price,

          amount:
            p.quantity *
            p.unit_price *
            (
              1 +
              gst_percent / 100
            )
        },
        {
          transaction: t
        }
      );
    }

 
// =====================================================
// COMMIT
// =====================================================
await t.commit();

// =====================================================
// BRANCH TRANSFER => DELIVERY CHALLAN PDF
// =====================================================
if (is_branch_transfer === true) {

  // ================= VALIDATE =================
  const finalToBranchId =
    to_branch_id ||
    clientData?.linked_branch_id;

  if (!finalToBranchId) {
    return res.status(400).json({
      success: false,
      error: "to_branch_id is required"
    });
  }

  // ================= FETCH DESTINATION BRANCH =================
  const toBranch = await Branch.findByPk(
    Number(finalToBranchId)
  );

  if (!toBranch) {
    return res.status(404).json({
      success: false,
      error: "Destination branch not found"
    });
  }

  // ================= NUMBERS =================
  const dc_no =
    `DC-${branch_id}-${Date.now()}`;

  const invoice_no =
    `INV-${branch_id}-${Date.now()}`;

  // ================= CREATE INVOICE =================
const invoice = await Invoice.create(
  {
    invoice_no,
    quotation_id: quotation.id,
    quotation_no: quotation.quotation_no,
    client_id: clientData.id,
    branch_id,
    total_amount: grand_total,
    gst_amount,
    type: "BRANCH_TRANSFER",
    status: "final",
    reference_no: dc_no,
  }
);

for (const p of products) {
  await InvoiceItem.create({
    invoice_id: invoice.id,

    product_name: p.product_name,

    quantity: p.quantity,

    unit_price: p.unit_price,

    unit: p.unit || "",

    hsn: p.hsn || "",

    subtotal:
      Number(p.quantity) *
      Number(p.unit_price),

    amount:
      Number(p.quantity) *
      Number(p.unit_price) *
      (1 + Number(gst_percent) / 100),
  });
}

  // ================= CLIENT LEDGER =================
  // await ClientLedger.create({
  //   client_id: clientData.id,
  //   branch_id,
  //   type: "TRANSFER",
  //   amount: grand_total,
  //   invoice_no,
  //   remark: `Branch Transfer against ${dc_no}`
  // });

  // ================= PRODUCT MAP =================
  const mappedProducts = products.map((p) => ({
    product_name: p.item || p.product_name || "",
    hsn: p.hsn || "",
    unit: p.unit || "PCS",
    quantity: p.quantity || 0,
    rate: p.unit_price || p.rate || 0,
    brand: p.brand || "",
    size: p.size || "",
    color: p.color || "",
    gst_percent: p.gst_percent || 18,
  }));

  // ================= GENERATE DC PDF =================
  return generateDCPDF({
    req,
    res,
    quotation,
    clientData,
    toBranchData: toBranch,
    products: mappedProducts,
    branch_id,
    dc_no,
    invoice_no,
    vehicle_no: req.body.vehicle_no || "",
    driver_name: req.body.driver_name || "",
    transport_name: req.body.transport_name || "Vehicle",
    eway_bill_no: req.body.eway_bill_no || "NA",
    dispatch_doc_no: req.body.dispatch_doc_no || "NA",
    destination: req.body.destination || "",
    to_branch_id: finalToBranchId
  });
}
// =====================================================
// NORMAL QUOTATION PDF
// =====================================================

const branch = await Branch.findByPk(
  branch_id
);

const items =
  await QuotationItem.findAll({
    where: {
      quotation_id:
        quotation.id
    },

    order: [["id", "ASC"]]
  });

const doc =
  new PDFDocument({
    margin: 30
  });

// ================= VIEW / DOWNLOAD =================

const type =
  String(
    req.query.type || "download"
  ).toLowerCase();

const disposition =
  type === "view"
    ? "inline"
    : "attachment";

res.setHeader(
  "Content-Type",
  "application/pdf"
);

res.setHeader(
  "Content-Disposition",
  `${disposition}; filename=${quotation_no}.pdf`
);

doc.pipe(res);

// ================= HEADER =================

doc
  .fontSize(16)
  .text(
    branch?.name || "",
    {
      align: "center"
    }
  );

doc
  .fontSize(10)
  .text(
    branch?.address || "",
    {
      align: "center"
    }
  );

doc.text(
  `GST: ${branch?.gst || ""}`,
  {
    align: "center"
  }
);

doc.moveDown();

doc
  .fontSize(14)
  .text(
    "QUOTATION",
    {
      align: "center"
    }
  );

doc.moveDown();

// ================= DETAILS =================

doc.fontSize(10);

doc.text(
  `Quotation No: ${quotation.quotation_no}`
);

doc.text(
  `Date: ${new Date(
    quotation.created_at
  ).toDateString()}`
);

doc.text(
  `Status: ${quotation.status}`
);

if (quotation.valid_till) {

  doc.text(
    `Valid Till: ${new Date(
      quotation.valid_till
    ).toDateString()}`
  );

}

doc.moveDown();

doc.text("Billing To:");

doc.text(
  `${clientData.name || ""}`
);

doc.text(
  `${clientData.address || ""}`
);

if (clientData.phone) {

  doc.text(
    `Phone: ${clientData.phone}`
  );

}

if (clientData.email) {

  doc.text(
    `Email: ${clientData.email}`
  );

}

doc.moveDown();

// ================= TABLE HEADER =================

doc.font("Helvetica-Bold");

let y = doc.y;

doc.text("No", 30, y);

doc.text("Item", 60, y);

doc.text("HSN", 220, y);

doc.text("Qty", 280, y);

doc.text("Unit", 330, y);

doc.text("Rate", 390, y);

doc.text("Total", 470, y);

doc.moveDown();

doc.font("Helvetica");

// ================= ITEMS =================

items.forEach((it, i) => {

  const rowY = doc.y;

  doc.text(
    String(i + 1),
    30,
    rowY
  );

  doc.text(
    String(it.product_name || ""),
    60,
    rowY,
    {
      width: 140
    }
  );

  doc.text(
    String(it.hsn || ""),
    220,
    rowY
  );

  doc.text(
    String(it.quantity || 0),
    280,
    rowY
  );

  doc.text(
    String(it.unit || ""),
    330,
    rowY
  );

  doc.text(
    String(it.unit_price || 0),
    390,
    rowY
  );

  doc.text(
    String(it.amount || 0),
    470,
    rowY
  );

  doc.moveDown();
});

doc.moveDown(2);

// ================= TOTALS =================

doc.font("Helvetica-Bold");

doc.text(
  `Subtotal: ${subtotal}`,
  {
    align: "right"
  }
);

doc.text(
  `GST: ${gst_amount}`,
  {
    align: "right"
  }
);

doc.text(
  `Grand Total: ${grand_total}`,
  {
    align: "right"
  }
);

doc.font("Helvetica");

doc.moveDown(2);

doc.text(
  "Thank you!",
  {
    align: "center"
  }
);

doc.end();
  } catch (err) {

    try {
      await t.rollback();
    } catch {}

    console.log(
      "createQuotation error:",
      err
    );

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
exports.getQuotationProducts = async (req, res) => {
  try {

    const branch_id = req.user?.branch_id;

    let {
      search = "",
      category = "",
      page = 1,
      limit = 50,
    } = req.query;

    if (!branch_id) {
      return res.status(400).json({
        success: false,
        message: "branch_id missing in req.user",
      });
    }

    // =========================
    // PAGINATION
    // =========================

    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 50;

    if (page < 1) page = 1;
    if (limit < 1) limit = 50;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    // =========================
    // FILTERS
    // =========================

    const where = {
      branch_id,

      status: "GOOD",

      // ✅ NOW 0 QTY ITEMS ALSO SHOW
      quantity: {
        [Op.gte]: 0,
      },
    };

    if (search?.trim()) {
      where.item = {
        [Op.iLike]: `%${search.trim()}%`,
      };
    }

    if (category?.trim()) {
      where.category = category.trim();
    }

    // =========================
    // FETCH PRODUCTS
    // =========================

    const { count, rows } = await Stock.findAndCountAll({
      where,

      attributes: [
        "id",
        "item",
        "category",

        "quantity",

        "rate",
        "value",

        "unit",
        "hsn",

        "sku",

        "gst_percent",

        "status",
        "branch_id",

        "specification",
        "item_description",

        // OPTIONAL PRODUCT FIELDS
        "brand",
        "sub_category",
        "type",
        "size",
        "color",
        "model_no",
        "serial_no",
        "item_code",
        "rack_no",
        "location",

        "created_at",
      ],

      order: [["item", "ASC"]],

      limit,
      offset,
    });

    // =========================
    // PAGINATION INFO
    // =========================

    const totalPages = Math.ceil(count / limit);

    // =========================
    // RESPONSE
    // =========================

    return res.status(200).json({
      success: true,

      message:
        "Quotation products fetched successfully",

      pagination: {
        total_items: count,

        current_page: page,

        per_page: limit,

        total_pages: totalPages,

        has_next_page: page < totalPages,

        has_prev_page: page > 1,
      },

      data: rows.map((s) => {

        const rate =
          Number(s.rate || 0);

        const gstPercent =
          Number(s.gst_percent || 0);

        return {

          // =========================
          // BASIC
          // =========================

          stock_id: s.id,

          product_id: s.id,

          product_name:
            s.item || "",

          category:
            s.category || "",

          sub_category:
            s.sub_category || "",

          brand:
            s.brand || "",

          type:
            s.type || "",

          status:
            s.status || "",

          branch_id:
            s.branch_id,

          // =========================
          // STOCK
          // =========================

          available_qty:
            Number(s.quantity || 0),

          unit:
            s.unit || "PCS",

          // =========================
          // PRICE
          // =========================

          unit_price:
            rate,

          total_value:
            Number(s.value || 0),

          // =========================
          // GST
          // =========================

          gst_percent:
            gstPercent,

          cgst_percent:
            gstPercent / 2,

          sgst_percent:
            gstPercent / 2,

          // =========================
          // PRODUCT DETAILS
          // =========================

          hsn:
            s.hsn || "",

          sku:
            s.sku || "",

          item_code:
            s.item_code || "",

          model_no:
            s.model_no || "",

          serial_no:
            s.serial_no || "",

          size:
            s.size || "",

          color:
            s.color || "",

          rack_no:
            s.rack_no || "",

          location:
            s.location || "",

          item_description:
            s.item_description || "",

          specifications:
            s.specification || {},

          // =========================
          // UI HELPERS
          // =========================

          display_name:
            s.item || "",

          created_at:
            s.created_at,
        };
      }),
    });

  } catch (error) {

    console.error(
      "getQuotationProducts error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to fetch quotation products",

      error:
        error.message,
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




async function generateGSTInvoicePDF({
  branch,
  invoice,
  client,
  items,
  bankAccount
}) {
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require("pdfkit");

      const doc = new PDFDocument({
        size: "A4",
        margin: 20
      });

      const buffers = [];

      doc.on("data", buffers.push.bind(buffers));

      doc.on("end", () => {
        resolve(Buffer.concat(buffers));
      });

      // =====================================================
      // CONFIG
      // =====================================================

      const pageWidth = doc.page.width;
      const usableWidth = pageWidth - 40;

      const startX = 20;

      let y = 20;

      // =====================================================
      // HELPERS
      // =====================================================

      const money = (v) =>
        Number(v || 0).toFixed(2);

      const formatDate = (date) => {
        const d = new Date(date);

        return `${String(
          d.getDate()
        ).padStart(2, "0")}-${String(
          d.getMonth() + 1
        ).padStart(2, "0")}-${d.getFullYear()}`;
      };

      const numberToWords = (
        amount
      ) => {
        return `${money(
          amount
        )} Rupees Only`;
      };

      const drawText = ({
        text,
        x,
        y,
        width,
        align = "left",
        size = 8,
        font = "Helvetica",
        color = "black"
      }) => {
        doc
          .font(font)
          .fontSize(size)
          .fillColor(color)
          .text(text || "", x, y, {
            width,
            align
          });
      };

      const drawCell = ({
        x,
        y,
        width,
        height,
        text = "",
        align = "left",
        bold = false,
        bg = null,
        size = 8
      }) => {
        if (bg) {
          doc
            .rect(
              x,
              y,
              width,
              height
            )
            .fillAndStroke(
              bg,
              "black"
            );
        } else {
          doc
            .rect(
              x,
              y,
              width,
              height
            )
            .stroke();
        }

        drawText({
          text,
          x: x + 4,
          y:
            y +
            height / 2 -
            4,
          width: width - 8,
          align,
          size,
          font: bold
            ? "Helvetica-Bold"
            : "Helvetica"
        });
      };

      // =====================================================
      // SAFE DATA FIX
      // =====================================================

      branch = branch || {};
      invoice = invoice || {};
      client = client || {};
      items = Array.isArray(items)
        ? items
        : [];

      const companyName =
        branch.name ||
        branch.branch_name ||
        "COMPANY NAME";

      const companyAddress = [
        branch.address,
        branch.city,
        branch.state,
        branch.pincode
      ]
        .filter(Boolean)
        .join(", ");

      const companyGST =
        branch.gst_number ||
        branch.gst ||
        branch.gst_no ||
        "N/A";

      const buyerName =
        client.name ||
        client.company_name ||
        "Buyer";

      const buyerAddress = [
        client.address,
        client.city,
        client.state
      ]
        .filter(Boolean)
        .join(", ");

      // =====================================================
      // CALCULATIONS
      // =====================================================

      const subtotal =
        items.reduce((sum, item) => {
          return (
            sum +
            Number(
              item.subtotal ||
                item.amount ||
                0
            )
          );
        }, 0);

      const gstAmount = Number(
        invoice.gst_amount || 0
      );

      const cgst = gstAmount / 2;
      const sgst = gstAmount / 2;

      const grandTotal = Number(
        invoice.total_amount ||
          subtotal + gstAmount
      );

      // =====================================================
      // HEADER
      // =====================================================

      drawText({
        text: companyName,
        x: startX,
        y,
        width: usableWidth,
        align: "center",
        size: 26,
        font: "Helvetica-Bold",
        color: "#1D4ED8"
      });

      y += 32;

      drawText({
        text: companyAddress,
        x: startX,
        y,
        width: usableWidth,
        align: "center",
        size: 8
      });

      y += 12;

      drawText({
        text: `GST No : ${companyGST}`,
        x: startX,
        y,
        width: usableWidth,
        align: "center",
        size: 9,
        font: "Helvetica-Bold"
      });

      y += 18;

      drawText({
        text: "TAX INVOICE",
        x: startX,
        y,
        width: usableWidth,
        align: "center",
        size: 13,
        font: "Helvetica-Bold"
      });

      y += 20;

      // =====================================================
      // TOP SECTION
      // =====================================================

      const leftWidth =
        usableWidth / 2;

      const rightWidth =
        usableWidth / 2;

      const topHeight = 120;

      doc
        .rect(
          startX,
          y,
          usableWidth,
          topHeight
        )
        .stroke();

      doc
        .moveTo(
          startX + leftWidth,
          y
        )
        .lineTo(
          startX + leftWidth,
          y + topHeight
        )
        .stroke();

      // =====================================================
      // LEFT SIDE
      // =====================================================

      drawText({
        text: companyName,
        x: startX + 6,
        y: y + 8,
        width: leftWidth - 10,
        size: 10,
        font: "Helvetica-Bold"
      });

      drawText({
        text: `Address : ${companyAddress}`,
        x: startX + 6,
        y: y + 25,
        width: leftWidth - 10
      });

      drawText({
        text: `GSTIN : ${companyGST}`,
        x: startX + 6,
        y: y + 42,
        width: leftWidth - 10
      });

      drawText({
        text: `Email : ${
          branch.email || ""
        }`,
        x: startX + 6,
        y: y + 59,
        width: leftWidth - 10
      });

      doc
        .moveTo(
          startX,
          y + 76
        )
        .lineTo(
          startX + leftWidth,
          y + 76
        )
        .stroke();

      drawText({
        text: "BUYER",
        x: startX + 6,
        y: y + 82,
        width: leftWidth - 10,
        size: 9,
        font: "Helvetica-Bold"
      });

      drawText({
        text: buyerName,
        x: startX + 6,
        y: y + 98,
        width: leftWidth - 10
      });

      drawText({
        text: buyerAddress,
        x: startX + 6,
        y: y + 112,
        width: leftWidth - 10
      });

      // =====================================================
      // RIGHT SIDE
      // =====================================================

      const details = [
        [
          "Invoice No",
          invoice.invoice_no || ""
        ],
        [
          "Invoice Date",
          formatDate(
            invoice.created_at ||
              new Date()
          )
        ],
        ["Payment Mode", "RTGS"],
        [
          "Quotation No",
          invoice.quotation_no ||
            ""
        ],
        [
          "GST No",
          client.gst_number ||
            "N/A"
        ]
      ];

      const rowH = 24;

      const labelWidth = 110;

      let rightY = y;

      details.forEach((row) => {
        drawCell({
          x: startX + leftWidth,
          y: rightY,
          width: labelWidth,
          height: rowH,
          text: row[0],
          bold: true,
          bg: "#F3F4F6"
        });

        drawCell({
          x:
            startX +
            leftWidth +
            labelWidth,
          y: rightY,
          width:
            rightWidth -
            labelWidth,
          height: rowH,
          text: row[1]
        });

        rightY += rowH;
      });

      y += topHeight + 15;

      // =====================================================
      // TABLE
      // =====================================================

      const cols = {
        sl: 40,
        desc: 240,
        hsn: 80,
        qty: 50,
        rate: 80,
        amount: 90
      };

      const widths = [
        cols.sl,
        cols.desc,
        cols.hsn,
        cols.qty,
        cols.rate,
        cols.amount
      ];

      const headers = [
        "SL",
        "Description",
        "HSN/SAC",
        "Qty",
        "Rate",
        "Amount"
      ];

      let currentX = startX;

      headers.forEach(
        (h, index) => {
          drawCell({
            x: currentX,
            y,
            width:
              widths[index],
            height: 24,
            text: h,
            align: "center",
            bold: true,
            bg: "#E5E7EB"
          });

          currentX +=
            widths[index];
        }
      );

      y += 24;

      const minRows = Math.max(
        5,
        items.length
      );

      for (
        let i = 0;
        i < minRows;
        i++
      ) {
        const item = items[i] || {};

        const rowData = [
          i < items.length
            ? String(i + 1)
            : "",
          item.product_name || "",
          item.hsn || "",
          item.quantity || "",
          item.unit_price
            ? `${money(
                item.unit_price
              )}`
            : "",
          item.subtotal ||
          item.amount
            ? `${money(
                item.subtotal ||
                  item.amount
              )}`
            : ""
        ];

        let rowX = startX;

        rowData.forEach(
          (data, index) => {
            drawCell({
              x: rowX,
              y,
              width:
                widths[index],
              height: 22,
              text: String(data),
              align:
                index === 1
                  ? "left"
                  : "center"
            });

            rowX +=
              widths[index];
          }
        );

        y += 22;
      }

      // =====================================================
      // TOTALS
      // =====================================================

      const totalWidth = 260;

      const totalX =
        startX +
        usableWidth -
        totalWidth;

      const totals = [
        [
          "Sub Total",
          `${money(subtotal)}`
        ],
        [
          "CGST",
          `${money(cgst)}`
        ],
        [
          "SGST",
          `${money(sgst)}`
        ],
        [
          "Grand Total",
          `${money(grandTotal)}`
        ]
      ];

      totals.forEach(
        (row, index) => {
          drawCell({
            x: totalX,
            y,
            width: 150,
            height: 24,
            text: row[0],
            bold: true,
            bg:
              index === 3
                ? "#E5E7EB"
                : null
          });

          drawCell({
            x: totalX + 150,
            y,
            width: 110,
            height: 24,
            text: row[1],
            align: "right",
            bold: true,
            bg:
              index === 3
                ? "#E5E7EB"
                : null
          });

          y += 24;
        }
      );

      // =====================================================
      // AMOUNT WORDS
      // =====================================================

      drawCell({
        x: startX,
        y,
        width: usableWidth,
        height: 30,
        text: `Amount In Words : ${numberToWords(
          grandTotal
        )}`
      });

      y += 30;

      // =====================================================
      // BANK DETAILS
      // =====================================================

      const infoHeight = 75;

      doc
        .rect(
          startX,
          y,
          usableWidth,
          infoHeight
        )
        .stroke();

      doc
        .moveTo(
          startX +
            usableWidth / 2,
          y
        )
        .lineTo(
          startX +
            usableWidth / 2,
          y + infoHeight
        )
        .stroke();

      // LEFT

      drawText({
        text: "Bank Details",
        x: startX + 6,
        y: y + 8,
        width:
          usableWidth / 2,
        size: 9,
        font: "Helvetica-Bold"
      });

      drawText({
        text: `Bank : ${
          bankAccount?.bank_name ||
          "N/A"
        }`,
        x: startX + 6,
        y: y + 26,
        width:
          usableWidth / 2
      });

      drawText({
        text: `A/C No : ${
          bankAccount?.account_number ||
          "N/A"
        }`,
        x: startX + 6,
        y: y + 42,
        width:
          usableWidth / 2
      });

      drawText({
        text: `IFSC : ${
          bankAccount?.ifsc_code ||
          "N/A"
        }`,
        x: startX + 6,
        y: y + 58,
        width:
          usableWidth / 2
      });

      // RIGHT

      drawText({
        text: "Tax Summary",
        x:
          startX +
          usableWidth / 2 +
          6,
        y: y + 8,
        width:
          usableWidth / 2,
        size: 9,
        font: "Helvetica-Bold"
      });

      drawText({
        text: `CGST : ${money(
          cgst
        )}`,
        x:
          startX +
          usableWidth / 2 +
          6,
        y: y + 26,
        width:
          usableWidth / 2
      });

      drawText({
        text: `SGST : ${money(
          sgst
        )}`,
        x:
          startX +
          usableWidth / 2 +
          6,
        y: y + 42,
        width:
          usableWidth / 2
      });

      drawText({
        text: `Total GST : ${money(
          gstAmount
        )}`,
        x:
          startX +
          usableWidth / 2 +
          6,
        y: y + 58,
        width:
          usableWidth / 2
      });

      y += infoHeight;

      // =====================================================
      // DECLARATION
      // =====================================================

      const declarationHeight = 70;

      doc
        .rect(
          startX,
          y,
          usableWidth,
          declarationHeight
        )
        .stroke();

      doc
        .moveTo(
          startX +
            usableWidth / 2,
          y
        )
        .lineTo(
          startX +
            usableWidth / 2,
          y +
            declarationHeight
        )
        .stroke();

      drawText({
        text: "Declaration",
        x: startX + 6,
        y: y + 10,
        width:
          usableWidth / 2,
        size: 8,
        font: "Helvetica-Bold"
      });

      drawText({
        text:
          "Certified that the particulars given above are true and correct.",
        x: startX + 6,
        y: y + 28,
        width:
          usableWidth / 2 -
          12,
        size: 7
      });

      drawText({
        text: `FOR ${companyName.toUpperCase()}`,
        x:
          startX +
          usableWidth / 2,
        y: y + 15,
        width:
          usableWidth / 2,
        align: "center",
        size: 10,
        font: "Helvetica-Bold"
      });

      doc
        .moveTo(
          startX +
            usableWidth / 2 +
            60,
          y + 48
        )
        .lineTo(
          startX +
            usableWidth / 2 +
            200,
          y + 48
        )
        .stroke();

      drawText({
        text:
          "Authorised Signatory",
        x:
          startX +
          usableWidth / 2,
        y: y + 52,
        width:
          usableWidth / 2,
        align: "center",
        size: 8
      });

      y +=
        declarationHeight + 10;

      // =====================================================
      // FOOTER
      // =====================================================

      drawText({
        text:
          "This is a Computer Generated Invoice",
        x: startX,
        y,
        width: usableWidth,
        align: "center",
        size: 8,
        color: "#666"
      });

      // =====================================================
      // END
      // =====================================================

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

const generateInvoiceNo = async (quotation_no, branch_id) => {
  const last = await Invoice.findOne({
    where: { branch_id }, // ✅ IMPORTANT FIX
    order: [["id", "DESC"]],
  });

  let next = 1;

  if (last?.invoice_no) {
    const parts = last.invoice_no.split("-");
    const num = Number(parts[parts.length - 1]);

    if (!isNaN(num)) next = num + 1;
  }

  return `INV-${branch_id}-${String(next).padStart(5, "0")}`;
};
exports.safeCreateBranch = async (data, transaction = null) => {
  const safeName = data?.name?.trim();

  if (!safeName) {
    throw new Error("Branch name is required (INVALID DATA)");
  }

  const payload = {
    name: safeName,
    code: data.code || null,
    state: data.state || null,
    type: data.type || "WAREHOUSE",
    status: data.status || "ACTIVE",
    location: data.location || null,
    contact_number: data.contact_number || null,
    email: data.email || null,
  };

  return await Branch.create(payload, transaction ? { transaction } : {});
};

exports.convertQuotationToInvoice = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;

    // =======================
    // 1. FETCH QUOTATION
    // =======================
    const quotation = await Quotation.findByPk(id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!quotation) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        error: "Quotation not found",
      });
    }

    // =======================
    // 2. STATUS CHECK
    // =======================
    if (!["approved", "invoiced"].includes(quotation.status)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: "Quotation not approved",
      });
    }

    // =======================
    // 3. CHECK EXISTING INVOICE
    // =======================
    const existingInvoice = await Invoice.findOne({
      where: { quotation_id: quotation.id },
      transaction: t,
    });

    if (existingInvoice) {
      await t.commit();
      return res.status(200).json({
        success: true,
        message: "Invoice already exists",
        invoice_id: existingInvoice.id,
        invoice_no: existingInvoice.invoice_no,
      });
    }

    // =======================
    // 4. ITEMS FETCH
    // =======================
    const items = await QuotationItem.findAll({
      where: { quotation_id: id },
      transaction: t,
    });

    if (!items.length) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: "No items found",
      });
    }
// =====================================================
// 8. FETCH CLIENT + BRANCH
// =====================================================
const client = await Client.findByPk(
  quotation.client_id,
  {
    transaction: t,
  }
);

if (!client) {
  await t.rollback();

  return res.status(404).json({
    success: false,
    error: "Client not found",
  });
}

// =====================================================
// FIXED BRANCH FETCH
// =====================================================
const branch = await Branch.findOne({
  where: {
    id: quotation.branch_id,
  },

  raw: true, // IMPORTANT FIX

  transaction: t,
});

if (!branch) {
  await t.rollback();

  return res.status(404).json({
    success: false,
    error: "Branch not found",
  });
}

console.log("BRANCH => ", branch);

    // =======================
    // 6. STOCK VALIDATION FIRST (SAFE ORDER FIX)
    // =======================
    for (const it of items) {
      const stock = await Stock.findOne({
        where: {
          item: it.product_name,
          branch_id: quotation.branch_id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!stock) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          error: `Stock missing: ${it.product_name}`,
        });
      }

      if (Number(stock.quantity) < Number(it.quantity)) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          error: `Insufficient stock: ${it.product_name}`,
        });
      }
    }

    // =======================
    // 7. SAFE INVOICE NUMBER (BRANCH SAFE FIX)
    // =======================
    const lastInvoice = await Invoice.findOne({
      where: { branch_id: quotation.branch_id },
      order: [["id", "DESC"]],
      transaction: t,
    });

    let next = 1;

    if (lastInvoice?.invoice_no) {
      const parts = lastInvoice.invoice_no.split("-");
      const num = parseInt(parts[parts.length - 1], 10);

      if (!isNaN(num)) next = num + 1;
    }

    const invoice_no = `INV-${quotation.branch_id}-${String(next).padStart(5, "0")}`;

    // =======================
    // 8. CREATE INVOICE FIRST
    // =======================
    const invoice = await Invoice.create(
      {
        quotation_id: quotation.id,
        quotation_no: quotation.quotation_no,
        client_id: quotation.client_id,
        branch_id: quotation.branch_id,
         bank_account_id: quotation.bank_account_id || req.body.bank_account_id,
        invoice_no,
        total_amount: quotation.total_amount,
        gst_amount: quotation.gst_amount,
        status: "draft",
      },
      { transaction: t }
    );

    // =======================
    // 9. ITEMS + STOCK + LEDGER (SAFE ORDER)
    // =======================
   // =======================
// 9. ITEMS + STOCK + LEDGER (SAFE ORDER)
// =======================
// =======================
// 9. ITEMS + STOCK + LEDGER (SAFE ORDER)
// =======================
for (const it of items) {
  await InvoiceItem.create(
    {
      invoice_id: invoice.id,
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      unit: it.unit || "",
      hsn: it.hsn || "",
      subtotal: it.subtotal || 0,
      amount: it.amount || 0,
    },
    { transaction: t }
  );

  const stock = await Stock.findOne({
    where: {
      item: it.product_name,
      branch_id: quotation.branch_id,
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });

  // ==========================
  // FIND AVAILABLE BATCHES (FIFO LOGIC KEPT AS-IS)
  // ==========================
  let remainingQty = Number(it.quantity);

  const batches = await InventoryBatch.findAll({
    where: {
      stock_id: stock.id,
      branch_id: quotation.branch_id,
    },
    order: [["id", "ASC"]],
    transaction: t,
    lock: t.LOCK.UPDATE,
  });

  for (const batch of batches) {
    if (remainingQty <= 0) break;

    if (batch.available_bundle <= 0) continue;

    const deductQty = Math.min(batch.available_bundle, remainingQty);

    // update batch
    batch.available_bundle =
      Number(batch.available_bundle) - deductQty;

    await batch.save({ transaction: t });

    // ==========================
    // ADD BATCH TIMELINE (UNCHANGED)
    // ==========================
    await BatchTimeline.create(
      {
        stock_id: stock.id,
        batch_id: batch.id,

        event_type: "SALE",

        title: `Invoice ${invoice.invoice_no}`,

        description: JSON.stringify({
          action: "SALE",
          invoice_id: invoice.id,
          invoice_no: invoice.invoice_no,

          item_name: it.product_name,
          batch_no: batch.batch_no,
          qty: deductQty,

          branch_id: quotation.branch_id,
          branch_name: branch.name,

          client_id: client.id,
          client_name: client.name,
        }),

        from_branch_id: quotation.branch_id,
        to_branch_id: null,

        quantity: deductQty,
        bundle_quantity: deductQty,

        created_by: req.user?.id || null,
      },
      { transaction: t }
    );

    remainingQty -= deductQty;
  }

  // ❌ REMOVED:
  // stock.quantity deduction (DO NOT USE)

  await Ledger.create(
    {
      branch_id: quotation.branch_id,
      stock_id: stock.id,
      type: "SALE",
      quantity: it.quantity,
      rate: it.unit_price,
      total: it.subtotal || 0,
      reference_no: invoice.invoice_no,
    },
    { transaction: t }
  );
}

    // =======================
    // 10. FINAL UPDATE
    // =======================
    invoice.status = "final";
    await invoice.save({ transaction: t });

    quotation.status = "invoiced";
    await quotation.save({ transaction: t });

    await t.commit();

    // =======================
    // RESPONSE
    // =======================
    return res.status(200).json({
      success: true,
      message: "Invoice generated successfully",
      invoice_id: invoice.id,
      invoice_no: invoice.invoice_no,
    });

  } catch (err) {
    if (t && !t.finished) await t.rollback();

    console.error("convertQuotationToInvoice error:", err);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

exports.approveQuotation = async (req, res) => {
  let t;

  try {
    const { id } = req.params;
    const { bank_account_id } = req.body;

    const role =
      req.user?.role?.name ||
      req.user?.role ||
      "";

    const userBranches =
      Array.isArray(req.user?.branches) && req.user.branches.length
        ? req.user.branches.map(Number).filter((b) => !isNaN(b))
        : req.user?.branch_id
        ? [Number(req.user.branch_id)].filter((b) => !isNaN(b))
        : [];

    t = await sequelize.transaction();

    // =========================
    // 1. FETCH QUOTATION
    // =========================
    const quotation = await Quotation.findByPk(id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!quotation) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        error: "Quotation not found",
      });
    }

    // =========================
    // 2. ROLE CHECK
    // =========================
    const allowedRoles = [
      "super_admin",
      "super_sales_manager",
      "super_sales_admin",
      "sales_manager",
    ];

    if (!allowedRoles.includes(role)) {
      await t.rollback();
      return res.status(403).json({
        success: false,
        message: "Access denied: Insufficient role",
      });
    }

    // =========================
    // 3. BRANCH CHECK
    // =========================
    if (role === "sales_manager") {
      if (!userBranches.length) {
        await t.rollback();
        return res.status(403).json({
          success: false,
          message: "No branch access",
        });
      }

      if (!userBranches.includes(Number(quotation.branch_id))) {
        await t.rollback();
        return res.status(403).json({
          success: false,
          message: "Access denied: Branch restriction",
        });
      }
    }

    // =========================
    // 4. BANK VALIDATION
    // =========================
    if (!bank_account_id) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: "bank_account_id is required",
      });
    }

    const bankAccount = await BranchBankAccount.findOne({
      where: {
        id: bank_account_id,
        branch_id: quotation.branch_id,
      },
      transaction: t,
    });

    if (!bankAccount) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: "Invalid bank account for this branch",
      });
    }

    // =========================
    // 5. ITEMS
    // =========================
    const items = await QuotationItem.findAll({
      where: { quotation_id: id },
      transaction: t,
    });

    if (!items.length) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: "No quotation items found",
      });
    }

    // =========================
    // 6. CLIENT + BRANCH
    // =========================
    const client = await Client.findByPk(quotation.client_id, { transaction: t });
    const branch = await Branch.findByPk(quotation.branch_id, { transaction: t });

    if (!client || !branch) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        error: "Client or Branch not found",
      });
    }

    // =========================
    // 7. FIND OR CREATE INVOICE
    // =========================
    let invoice = await Invoice.findOne({
      where: { quotation_id: quotation.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!invoice) {
      invoice = await Invoice.create(
        {
          quotation_id: quotation.id,
          quotation_no: quotation.quotation_no,
          client_id: quotation.client_id,
          branch_id: quotation.branch_id,
          bank_account_id: bank_account_id, // ✅ FIXED HERE
          invoice_no: `INV-${quotation.quotation_no}`,
          total_amount: quotation.total_amount,
          gst_amount: quotation.gst_amount,
          status: "draft",
        },
        { transaction: t }
      );
    } else {
      // ✅ IMPORTANT FIX: update bank even if invoice exists
      invoice.bank_account_id = bank_account_id;
      await invoice.save({ transaction: t });
    }

    // =========================
    // 8. COPY ITEMS (ONLY ONCE)
    // =========================
    const existingCount = await InvoiceItem.count({
      where: { invoice_id: invoice.id },
      transaction: t,
    });

    if (existingCount === 0) {
      for (const item of items) {
        await InvoiceItem.create(
          {
            invoice_id: invoice.id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            unit: item.unit || "",
            hsn: item.hsn || "",
            subtotal: item.subtotal || 0,
            amount: item.amount || 0,
          },
          { transaction: t }
        );
      }
    }

    // =========================
    // 9. STOCK DEDUCTION (ONLY ONCE)
    // =========================
  //   if (invoice.status !== "final") {
  //     for (const it of items) {
  //       const stock = await Stock.findOne({
  //         where: {
  //           item: it.product_name,
  //           branch_id: quotation.branch_id,
  //         },
  //         transaction: t,
  //         lock: t.LOCK.UPDATE,
  //       });

  //       if (!stock) {
  //         await t.rollback();
  //         return res.status(400).json({
  //           success: false,
  //           error: `Stock not found: ${it.product_name}`,
  //         });
  //       }

  //       if (Number(stock.quantity) < Number(it.quantity)) {
  //         await t.rollback();
  //         return res.status(400).json({
  //           success: false,
  //           error: `Insufficient stock: ${it.product_name}`,
  //         });
  //       }

  //       stock.quantity -= Number(it.quantity);
  //       await stock.save({ transaction: t });
  //     }

  //     // =========================
  //     // CLIENT LEDGER
  //     // =========================
  //    const isBranchTransfer =
  // quotation.is_branch_transfer == true ||
  // quotation.is_branch_transfer == 1 ||
  // quotation.is_branch_transfer == "1" ||
  // quotation.is_branch_transfer === "true";
  //     // await ClientLedger.create(
  //     //   {
  //     //     client_id: quotation.client_id,
  //     //     branch_id: quotation.branch_id,
  //     //     type: isBranchTransfer ? "TRANSFER" : "SALE",
  //     //     amount: quotation.total_amount,
  //     //     invoice_no: `INV-${quotation.quotation_no}`,
  //     //     remark: "Invoice",
  //     //   },
  //     //   { transaction: t }
  //     // );

  //     invoice.status = "final";
  //     await invoice.save({ transaction: t });

  //     quotation.status = "invoiced";
  //     quotation.approved_by = req.user.id;
  //     quotation.approved_at = new Date();

  //     await quotation.save({ transaction: t });
  //   }

    // =========================
    // COMMIT
    // =========================
    await t.commit();

    // =========================
    // PDF GENERATION
    // =========================
    const invoiceItems = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id },
    });

    const invoiceBankAccount = await BranchBankAccount.findByPk(
      invoice.bank_account_id
    );

    const pdf = await generateGSTInvoicePDF({
      branch,
      invoice,
      client,
      items: invoiceItems,
      bankAccount: invoiceBankAccount,
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=${invoice.invoice_no}.pdf`,
    });

    return res.send(pdf);

  } catch (err) {
    if (t && !t.finished) await t.rollback();

    console.error("APPROVE QUOTATION ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
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
    doc.text(`Date: ${new Date(quotation.created_at).toDateString()}`);
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
        "created_at"
      ],
      include: [
        {
          model: Client,
          as: "client",
          attributes: ["id", "name"]
        }
      ],
      order: [["created_at", "DESC"]]
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
        "created_at"
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
      order: [["created_at", "DESC"]]
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
exports.getQuotationPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const type = String(req.query.type || "view").toLowerCase();

    const quotation = await Quotation.findByPk(id, {
      include: [
        { model: Client, as: "client" },
        { model: Branch, as: "branch" },
        { model: QuotationItem, as: "items" }
      ]
    });

    if (!quotation) {
      return res.status(404).json({
        success: false,
        error: "Quotation not found"
      });
    }

    const doc = new PDFDocument({ margin: 30 });

    const disposition =
      type === "download" ? "attachment" : "inline";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename=${quotation.quotation_no}.pdf`
    );

    doc.pipe(res);

    // =========================
    // HEADER
    // =========================
    doc.fontSize(16).text(quotation.branch?.name || "", {
      align: "center"
    });

    doc.moveDown();

    // =========================
    // QUOTATION DETAILS
    // =========================
    doc.fontSize(10);
    doc.text(`Quotation No: ${quotation.quotation_no}`);
    doc.text(`Client: ${quotation.client?.name || ""}`);

    doc.moveDown();

    // =========================
    // ITEMS
    // =========================
    (quotation.items || []).forEach((it, i) => {
      doc.text(
        `${i + 1}. ${it.product_name} - ${it.quantity} x ${it.unit_price}`
      );
    });

    doc.moveDown();

    // =========================
    // TOTAL
    // =========================
    doc.text(`Total: ${quotation.total_amount}`);

    doc.end();
  } catch (err) {
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
        TO_CHAR("created_at",'Mon') AS month,
        SUM(total_amount) AS revenue,
        COUNT(*) AS orders
      FROM quotations
      ${whereClause}
      GROUP BY branch_id, month, DATE_TRUNC('month',"created_at")
      ORDER BY branch_id, DATE_TRUNC('month',"created_at")
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
        TO_CHAR("created_at",'Dy') AS day,
        COUNT(*) FILTER (WHERE status='pending') AS quotations,
        COUNT(*) FILTER (WHERE status='approved') AS approved,
        COUNT(*) FILTER (WHERE status='invoiced') AS invoices
      FROM quotations
      WHERE "created_at" >= NOW() - INTERVAL '7 days'
      ${branchCondition}
      GROUP BY branch_id, day
      ORDER BY branch_id, MIN("created_at")
    `);

    // ===============================
    // 5. PROFIT ANALYSIS
    // ===============================
    const profitAnalysis = await sequelize.query(`
      SELECT 
        branch_id AS "branchId",
        TO_CHAR("created_at",'Mon') AS month,
        SUM(total_amount * 0.2) AS profit
      FROM quotations
      ${whereClause}
      GROUP BY branch_id, month, DATE_TRUNC('month',"created_at")
      ORDER BY branch_id, DATE_TRUNC('month',"created_at")
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
      ORDER BY q.branch_id, q."created_at" DESC
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
        COUNT(*) FILTER (WHERE "created_at" >= NOW() - INTERVAL '30 days') AS "newClients",
        COUNT(*) FILTER (WHERE "created_at" < NOW() - INTERVAL '30 days') AS "returningClients"
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
        WHEN DATE("created_at") = CURRENT_DATE THEN total_amount
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
        TO_CHAR("created_at",'Mon') AS month,

        SUM(CASE WHEN reference_no IS NOT NULL THEN total_amount ELSE 0 END) AS "onlineSales",
        SUM(CASE WHEN reference_no IS NULL THEN total_amount ELSE 0 END) AS "offlineSales"

      FROM quotations
      ${whereClause}
      GROUP BY branch_id, month, DATE_TRUNC('month',"created_at")
      ORDER BY branch_id, DATE_TRUNC('month',"created_at")
    `);

    // ===============================
    // 2B. GLOBAL SALES ANALYTICS
    // only for super users
    // ===============================
    let globalSalesAnalytics = [];

    if (isSuperView) {
      const globalAnalytics = await sequelize.query(`
        SELECT
          TO_CHAR("created_at",'Mon') AS month,
          DATE_TRUNC('month',"created_at") AS "monthDate",

          SUM(CASE WHEN reference_no IS NOT NULL THEN total_amount ELSE 0 END) AS "onlineSales",
          SUM(CASE WHEN reference_no IS NULL THEN total_amount ELSE 0 END) AS "offlineSales"

        FROM quotations
        GROUP BY month, DATE_TRUNC('month',"created_at")
        ORDER BY DATE_TRUNC('month',"created_at")
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
        q."created_at"

      FROM quotations q
      LEFT JOIN clients c ON c.id = q.client_id

      ${isSuperView ? "" : branchId ? `WHERE q.branch_id = ${branchId}` : ""}

      ORDER BY q."created_at" DESC
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
      q."created_at"

    FROM quotations q
    LEFT JOIN clients c ON c.id = q.client_id

    ORDER BY q."created_at" DESC
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
        TO_CHAR(cl."created_at", 'DD/MM/YYYY, HH24:MI:SS') AS "dateTime",
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

      ORDER BY cl."created_at" DESC
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
        "created_at"
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
        DATE_TRUNC('week', "created_at") AS week,

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
        DATE_TRUNC('week', "created_at") AS week,

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
            AND DATE_TRUNC('month', l."created_at") = DATE_TRUNC('month', CURRENT_DATE)
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
        DATE_TRUNC('week', l."created_at") AS week,

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
        DATE_TRUNC('week', q."created_at") AS week,

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

    const ALLOWED_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager",
      "sales_manager"
    ];

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "❌ Access Denied"
      });
    }

    const GLOBAL_ROLES = [
      "super_admin",
      "super_sales_manager",
      "super_stock_manager",
      "super_inventory_manager"
    ];

    const isGlobalUser =
      GLOBAL_ROLES.includes(role) ||
      req.user?.branches?.includes("ALL");

    const requestedBranchId = req.params?.branchId
      ? Number(req.params.branchId)
      : null;

    const userBranches = Array.isArray(req.user?.branches)
      ? req.user.branches
          .filter((b) => b !== "ALL" && b !== null && b !== undefined)
          .map((b) => Number(b))
          .filter((b) => !Number.isNaN(b))
      : [];

    const replacements = {};

    let ledgerWhere = "";
    let quotationWhere = "";
    let clientWhere = "";
    let stockWhere = "";

    // ==================================
    // 🌍 SUPER SALES MANAGER => ALL IMS
    // ==================================
    if (isGlobalUser) {
      // agar super user branchId de bhi de to bhi poori IMS ka data dikhana hai
      ledgerWhere = "";
      quotationWhere = "";
      clientWhere = "";
      stockWhere = "";
    } else {
      // ==================================
      // 🏢 SALES MANAGER => ONLY OWN BRANCH/BRANCHES
      // ==================================
      if (!userBranches.length) {
        return res.status(403).json({
          success: false,
          message: "No branch assigned to this user"
        });
      }

      // agar specific branchId pass hui hai to validate karo
      if (requestedBranchId) {
        if (!userBranches.includes(requestedBranchId)) {
          return res.status(403).json({
            success: false,
            message: "❌ You are not allowed to access this branch data"
          });
        }

        replacements.branchId = requestedBranchId;

        ledgerWhere = `WHERE branch_id = :branchId`;
        quotationWhere = `WHERE branch_id = :branchId`;
        clientWhere = `WHERE branch_id = :branchId`;
        stockWhere = `WHERE s.branch_id = :branchId`;
      } else {
        replacements.branches = userBranches;

        ledgerWhere = `WHERE branch_id IN (:branches)`;
        quotationWhere = `WHERE branch_id IN (:branches)`;
        clientWhere = `WHERE branch_id IN (:branches)`;
        stockWhere = `WHERE s.branch_id IN (:branches)`;
      }
    }

    // =========================
    // 🟦 CARDS
    // =========================
    const summary = await sequelize.query(
      `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'SALE' THEN quantity ELSE 0 END), 0) AS "totalSales",

        COALESCE(
          SUM(
            CASE
              WHEN type = 'SALE'
               AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
              THEN quantity
              ELSE 0
            END
          ),
          0
        ) AS "salesThisMonth",

        COALESCE(SUM(CASE WHEN type = 'SALE' THEN total ELSE 0 END), 0) AS "totalRevenue"

      FROM ledger
      ${ledgerWhere}
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    const pendingQT = await sequelize.query(
      `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM quotations
      ${quotationWhere}
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    const clientCount = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM clients
      ${clientWhere}
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    // =========================
    // 📊 STOCK IN / OUT CHART
    // =========================
    const stockChart = await sequelize.query(
      `
      SELECT 
        DATE_TRUNC('week', created_at) AS week,
        COALESCE(SUM(CASE WHEN type = 'PURCHASE' THEN quantity ELSE 0 END), 0) AS "stockIn",
        COALESCE(SUM(CASE WHEN type = 'SALE' THEN quantity ELSE 0 END), 0) AS "stockOut"
      FROM ledger
      ${ledgerWhere}
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week ASC
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    // =========================
    // 📉 QUOTATION CHART
    // =========================
    const quotationChart = await sequelize.query(
      `
      SELECT 
        DATE_TRUNC('week', created_at) AS week,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM quotations
      ${quotationWhere}
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week ASC
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    // =========================
    // 📋 PRODUCT TABLE (TOP ITEMS)
    // =========================
    const products = await sequelize.query(
      `
      SELECT
        s.item AS "productName",
        s.category AS "category",

        COALESCE(ls."totalSales", 0) AS "totalSales",
        COALESCE(ls."totalRevenue", 0) AS "totalRevenue",

        COALESCE(cl."clients", 0) AS "clients",
        COALESCE(qt."pendingQuotation", 0) AS "pendingQuotation",
        COALESCE(qt."rejectedQuotation", 0) AS "rejectedQuotation"

      FROM stocks s

      LEFT JOIN (
        SELECT
          stock_id,
          branch_id,
          SUM(CASE WHEN type = 'SALE' THEN quantity ELSE 0 END) AS "totalSales",
          SUM(CASE WHEN type = 'SALE' THEN total ELSE 0 END) AS "totalRevenue"
        FROM ledger
        ${ledgerWhere}
        GROUP BY stock_id, branch_id
      ) ls
        ON ls.stock_id = s.id
       AND ls.branch_id = s.branch_id

      LEFT JOIN (
        SELECT
          branch_id,
          COUNT(DISTINCT id) AS "clients"
        FROM clients
        ${clientWhere}
        GROUP BY branch_id
      ) cl
        ON cl.branch_id = s.branch_id

      LEFT JOIN (
        SELECT
          branch_id,
          COUNT(*) FILTER (WHERE status = 'pending') AS "pendingQuotation",
          COUNT(*) FILTER (WHERE status = 'rejected') AS "rejectedQuotation"
        FROM quotations
        ${quotationWhere}
        GROUP BY branch_id
      ) qt
        ON qt.branch_id = s.branch_id

      ${stockWhere}

      ORDER BY "totalRevenue" DESC, "totalSales" DESC
      LIMIT 10
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    return res.json({
      success: true,

      cards: {
        totalSales: Number(summary?.[0]?.totalSales || 0),
        pendingQuotation: Number(pendingQT?.[0]?.pending || 0),
        salesThisMonth: Number(summary?.[0]?.salesThisMonth || 0),
        totalClients: Number(clientCount?.[0]?.total || 0)
      },

      charts: {
        stockTrend: stockChart.map((row) => ({
          week: row.week,
          stockIn: Number(row.stockIn || 0),
          stockOut: Number(row.stockOut || 0)
        })),
        quotationTrend: quotationChart.map((row) => ({
          week: row.week,
          pending: Number(row.pending || 0),
          rejected: Number(row.rejected || 0)
        }))
      },

      products: products.map((p) => ({
        productName: p.productName,
        category: p.category,
        totalSales: Number(p.totalSales || 0),
        totalRevenue: Number(p.totalRevenue || 0),
        clients: Number(p.clients || 0),
        pendingQuotation: Number(p.pendingQuotation || 0),
        rejectedQuotation: Number(p.rejectedQuotation || 0)
      }))
    });
  } catch (err) {
    console.error("❌ ERROR in getBranchDashboard:", err);
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
        DATE_TRUNC('week', l."created_at") AS week,

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
        DATE_TRUNC('week', l."created_at") AS week,

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
        l."created_at" AS date,

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
          WHEN AGE(NOW(), l."created_at") < INTERVAL '30 days' THEN '1 month'
          WHEN AGE(NOW(), l."created_at") < INTERVAL '90 days' THEN '3 months'
          WHEN AGE(NOW(), l."created_at") < INTERVAL '180 days' THEN '6 months'
          WHEN AGE(NOW(), l."created_at") < INTERVAL '365 days' THEN '1 year'
          WHEN AGE(NOW(), l."created_at") < INTERVAL '730 days' THEN '2 years'
          ELSE '2+ years'
        END AS "aging"

      FROM ledger l
      JOIN stocks s ON s.id = l.stock_id
      LEFT JOIN branches b ON b.id = l.branch_id

      WHERE l.stock_id = :itemId

      ORDER BY l."created_at" DESC
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

    if (!invoice_no) {
      return res.status(400).json({
        success: false,
        error: "invoice_no is required in params"
      });
    }

    const invoice = await Invoice.findOne({
      where: { invoice_no }
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: "Invoice not found"
      });
    }

    const bucketName = "invoice-pdfs";
    const safeInvoiceNo = String(invoice.invoice_no).replace(/[^a-zA-Z0-9-_]/g, "_");
    const fileName = `invoices/${safeInvoiceNo}.pdf`;

    console.log("bucketName =", bucketName);
    console.log("invoice.invoice_no =", invoice.invoice_no);
    console.log("safeInvoiceNo =", safeInvoiceNo);
    console.log("fileName =", fileName);
console.log("SUPABASE_URL =", process.env.SUPABASE_URL);
    const items = await InvoiceItem.findAll({
      where: { invoice_id: invoice.id }
    });

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No invoice items found"
      });
    }

    const client = await Client.findByPk(invoice.client_id);
    const branch = await Branch.findByPk(invoice.branch_id);

    if (!branch) {
      return res.status(404).json({
        success: false,
        error: "Branch not found"
      });
    }

    // pehle signed URL try karo
    const { data: signedTry, error: signedTryError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(fileName, 60 * 10);

    if (!signedTryError && signedTry?.signedUrl) {
      return res.status(200).json({
        success: true,
        message: "PDF fetched from storage",
        invoice_no: invoice.invoice_no,
        download_url: signedTry.signedUrl
      });
    }

    console.log("signedTryError =", signedTryError?.message || null);

    const pdfBuffer = await generateGSTInvoicePDF({
      branch,
      invoice,
      client,
      items
    });

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true
      });

    console.log("uploadData =", uploadData);
    console.log("uploadError =", uploadError);

    if (uploadError) {
      throw uploadError;
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(fileName, 60 * 10);

    if (signedError) {
      throw signedError;
    }

    return res.status(200).json({
      success: true,
      message: "PDF generated and stored successfully",
      invoice_no: invoice.invoice_no,
      download_url: signedData.signedUrl
    });

  } catch (err) {
    console.error("getInvoicePDF error:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

exports.searchBranches = async (req, res) => {
  try {
    const { q } = req.query;

    let whereCondition = {};

    if (q && q.trim() !== "") {
      whereCondition.name = {
        [Op.iLike]: `%${q}%`
      };
    }

    const branches = await Branch.findAll({
      where: whereCondition,
      order: [["name", "ASC"]]
    });

    return res.json({
      success: true,
      total: branches.length,
      branches
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};






// ===============================
// BRANCH TO BRANCH TRANSFER API
// ===============================

exports.createBranchTransfer = async (req, res) => {

  try {

    const {
      to_branch_id,
      remark
    } = req.body;

    const from_branch_id =
      req.user.branch_id;

    // VALIDATION

    if (!to_branch_id) {
      return res.status(400).json({
        success: false,
        error: "to_branch_id required"
      });
    }

    if (
      Number(from_branch_id) ===
      Number(to_branch_id)
    ) {
      return res.status(400).json({
        success: false,
        error: "Cannot transfer to same branch"
      });
    }

    // DESTINATION BRANCH

    const destinationBranch =
      await Branch.findByPk(
        to_branch_id
      );

    if (!destinationBranch) {
      return res.status(404).json({
        success: false,
        error: "Destination branch not found"
      });
    }

    // FIND / CREATE CLIENT

    let branchClient =
      await Client.findOne({
        where: {
          linked_branch_id:
            to_branch_id,

          client_type:
            "BRANCH"
        }
      });

    if (!branchClient) {

      branchClient =
        await Client.create({

          name:
            `Branch - ${destinationBranch.name}`,

          client_type:
            "BRANCH",

          linked_branch_id:
            to_branch_id,

          branch_id:
            from_branch_id,

          address:
            destinationBranch.address || "",

          phone: "",
          email: ""
        });
    }

    return res.status(200).json({

      success: true,

      message:
        "Branch selected successfully",

      branch_client:
        branchClient,

      destination_branch:
        destinationBranch,

      next_step:
        "Use createQuotation API with is_branch_transfer=true"
    });

  } catch (err) {

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
