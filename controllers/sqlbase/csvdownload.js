const sequelize = require("../../config/sqlcon");
const ExcelJS = require("exceljs");

const { Op } = require("sequelize");

const Stock = require("../../model/SQL_Model/stock.record");
const Branch = require("../../model/SQL_Model/branch");
const User=require('../../model/SQL_Model/user')

exports.exportStockAgingExcel = async (req, res) => {
  try {

    // ================= USER ROLE =================
    const role = req.user?.role || req.user?.role?.name;

    let isSuper = false;
    let branchIds = [];

    if (
      req.user?.branches?.includes("ALL") ||
      role === "super_admin"
    ) {
      isSuper = true;
    } else {
      if (Array.isArray(req.user?.branches) && req.user.branches.length) {
        branchIds = req.user.branches;
      } else if (req.user?.branch_id) {
        branchIds = [req.user.branch_id];
      }
    }

    if (!Array.isArray(branchIds)) {
      branchIds = [branchIds];
    }

    // ================= QUERY =================
    const [data] = await sequelize.query(`
      SELECT 
      po_number AS "purchaseOrderNo",
      item AS "itemName",
      category AS "categories",
      branch_id AS "branch",
      quantity,
      value,

      CASE
        WHEN NOW() - created_at <= INTERVAL '180 days' THEN 'Fresh'
        WHEN NOW() - created_at <= INTERVAL '365 days' THEN 'Normal'
        WHEN NOW() - created_at <= INTERVAL '730 days' THEN 'Slow'
        ELSE 'Critical'
      END AS status

      FROM stocks
      WHERE (
        :isSuper = true 
        OR branch_id IN (:branchIds)
      )
      ORDER BY created_at DESC
    `, {
      replacements: {
        isSuper,
        branchIds: branchIds.length ? branchIds : [0]
      }
    });

    if (!data.length) {
      return res.status(404).json({
        success: false,
        message: "No data found"
      });
    }

    // ================= EXCEL =================
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Stock Aging");

    // 🔥 HEADER
    worksheet.columns = [
      { header: "PO Number", key: "purchaseOrderNo", width: 25 },
      { header: "Item Name", key: "itemName", width: 20 },
      { header: "Category", key: "categories", width: 20 },
      { header: "Branch", key: "branch", width: 10 },
      { header: "Quantity", key: "quantity", width: 12 },
      { header: "Value", key: "value", width: 15 },
      { header: "Status", key: "status", width: 15 }
    ];

    // 🔥 STYLE HEADER
    worksheet.getRow(1).font = { bold: true };

    // 🔥 DATA
    data.forEach(row => {
      worksheet.addRow({
        purchaseOrderNo: row.purchaseOrderNo,
        itemName: row.itemName,
        categories: row.categories,
        branch: row.branch,
        quantity: row.quantity,
        value: row.value,
        status: row.status
      });
    });

    // 🔥 TOTAL ROW
    const totalValue = data.reduce((sum, row) => sum + (row.value || 0), 0);

    worksheet.addRow({});
    worksheet.addRow({
      itemName: "TOTAL",
      value: totalValue
    });

    // ================= DOWNLOAD =================
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=stock-aging-${Date.now()}.xlsx`
    );

    await workbook.xlsx.write(res);

    res.end();

  } catch (err) {
    console.error("❌ EXCEL EXPORT ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};
exports.exportInventoryExcel = async (req, res) => {
  try {

    const user = req.user;
    const role = user?.role || user?.role?.name;
    const userBranches = user?.branches || [];

    if (!userBranches.length) {
      return res.status(403).json({
        success: false,
        message: "No branch access"
      });
    }

    // 👑 SUPER USER
    const isSuperUser =
      userBranches.includes("ALL") || role === "super_admin";

    const whereCondition = isSuperUser
      ? {}
      : {
          branch_id: {
            [Op.in]: userBranches
          }
        };

    // ================= DATA =================
    const data = await Stock.findAll({
      where: whereCondition,

      include: [
        {
          model: Branch,
          as: "branch",
          attributes: [
            "name",
            "code",
            "state",
            "type",
            "location",
            "contact_number",
            "email"
          ]
        }
      ],

      attributes: [
        "item",
        "category",
        "hsn",
        "grn",
        "po_number",
        ["quantity", "current_stock"],
        "status",

        [
          sequelize.literal(`(
            SELECT COALESCE(SUM(quantity),0)
            FROM ledger
            WHERE ledger.stock_id = "Stock"."id"
            AND ledger.type = 'PURCHASE'
          )`),
          "stock_in"
        ],

        [
          sequelize.literal(`(
            SELECT COALESCE(SUM(quantity),0)
            FROM ledger
            WHERE ledger.stock_id = "Stock"."id"
            AND ledger.type = 'SALE'
          )`),
          "stock_out"
        ],

        [
          sequelize.literal(`(
            SELECT COALESCE(SUM(quantity),0)
            FROM ledger
            WHERE ledger.stock_id = "Stock"."id"
            AND ledger.type = 'DAMAGE'
          )`),
          "scrap"
        ]
      ]
    });

    if (!data.length) {
      return res.status(404).json({
        success: false,
        message: "No inventory data"
      });
    }

    // ================= EXCEL =================
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Inventory Report");

    // 🔥 TOP INFO
    worksheet.addRow(["User Role:", role]);
    worksheet.addRow([
      "Branch Access:",
      isSuperUser ? "ALL BRANCHES" : userBranches.join(", ")
    ]);
    worksheet.addRow(["Generated At:", new Date().toLocaleString()]);
    worksheet.addRow([]);

    // 🔥 HEADER
    worksheet.columns = [
      { header: "Item", key: "item", width: 20 },
      { header: "Category", key: "category", width: 20 },
      { header: "HSN", key: "hsn", width: 15 },
      { header: "GRN", key: "grn", width: 20 },
      { header: "PO Number", key: "po_number", width: 25 },

      { header: "Branch Name", key: "branch_name", width: 25 },
      { header: "Branch Code", key: "branch_code", width: 15 },
      { header: "Branch Type", key: "branch_type", width: 15 },
      { header: "State", key: "state", width: 20 },
      { header: "Location", key: "location", width: 25 },
      { header: "Contact", key: "contact", width: 20 },
      { header: "Email", key: "email", width: 25 },

      { header: "Current Stock", key: "current_stock", width: 15 },
      { header: "Stock In", key: "stock_in", width: 15 },
      { header: "Stock Out", key: "stock_out", width: 15 },
      { header: "Scrap", key: "scrap", width: 15 },

      { header: "Status", key: "status", width: 15 }
    ];

    worksheet.getRow(5).font = { bold: true };

    // 🔥 DATA
    data.forEach(row => {
      worksheet.addRow({
        item: row.item,
        category: row.category,
        hsn: row.hsn,
        grn: row.grn,
        po_number: row.po_number,

        branch_name: row.branch?.name || "",
        branch_code: row.branch?.code || "",
        branch_type: row.branch?.type || "",
        state: row.branch?.state || "",
        location: row.branch?.location || "",
        contact: row.branch?.contact_number || "",
        email: row.branch?.email || "",

        current_stock: row.get("current_stock"),
        stock_in: row.get("stock_in"),
        stock_out: row.get("stock_out"),
        scrap: row.get("scrap"),

        status: row.status
      });
    });

    // 🔥 TOTAL
    const totalStock = data.reduce(
      (sum, r) => sum + (r.get("current_stock") || 0),
      0
    );

    worksheet.addRow([]);
    worksheet.addRow({
      item: "TOTAL",
      current_stock: totalStock
    });

    // ================= DOWNLOAD =================
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=inventory-report-${Date.now()}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error("❌ INVENTORY EXPORT ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Error exporting inventory"
    });
  }
};
exports.getReportsAnalyticsDashboard = async (req, res) => {
 };
 
exports.exportReportsAnalyticsCSV = async (req, res) => {
  try {

    const user = req.user;
    const role = user?.role || user?.role?.name;

    let isSuper = false;
    let branchIds = [];

    if (
      user?.branches?.includes("ALL") ||
      role === "super_admin"
    ) {
      isSuper = true;
    } else {
      if (Array.isArray(user?.branches) && user.branches.length) {
        branchIds = user.branches;
      } else if (user?.branch_id) {
        branchIds = [user.branch_id];
      }
    }

    if (!Array.isArray(branchIds)) branchIds = [branchIds];

    const replacements = {
      isSuper,
      branchIds: branchIds.length ? branchIds : [0]
    };

    // ================= DATA =================
    const [cards] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(value),0)::INTEGER AS "totalSpend",
        COUNT(id)::INTEGER AS "totalPOs",
        COALESCE(SUM(quantity),0)::INTEGER AS "totalStockItems",
        SUM(CASE WHEN quantity < 10 THEN 1 ELSE 0 END)::INTEGER AS "lowStockItems"
      FROM stocks
      WHERE (:isSuper = true OR branch_id IN (:branchIds))
    `, { replacements });

    const [monthlySpend] = await sequelize.query(`
      SELECT 
        TO_CHAR(created_at,'Mon') AS month,
        SUM(value)::INTEGER AS spend
      FROM stocks
      WHERE (:isSuper = true OR branch_id IN (:branchIds))
      GROUP BY month, DATE_PART('month',created_at)
      ORDER BY DATE_PART('month',created_at)
    `, { replacements });

    const [stockMovement] = await sequelize.query(`
      SELECT 
        TO_CHAR(created_at,'Mon') AS month,
        SUM(CASE WHEN type='IN' THEN quantity ELSE 0 END)::INTEGER AS "stockIn",
        SUM(CASE WHEN type='OUT' THEN quantity ELSE 0 END)::INTEGER AS "stockOut"
      FROM stock_movements
      WHERE (:isSuper = true OR branch_id IN (:branchIds))
      GROUP BY month, DATE_PART('month',created_at)
      ORDER BY DATE_PART('month',created_at)
    `, { replacements });

    const [categoryDistribution] = await sequelize.query(`
      SELECT 
        category,
        SUM(quantity)::INTEGER AS total
      FROM stocks
      WHERE (:isSuper = true OR branch_id IN (:branchIds))
      GROUP BY category
    `, { replacements });

    // ================= BUILD CSV MANUALLY =================
    let csv = "";

    // 🔥 USER INFO
    csv += `ROLE,${role}\n`;
    csv += `BRANCH,${isSuper ? "ALL" : branchIds.join(",")}\n\n`;

    // 🔥 CARDS
    csv += "=== SUMMARY ===\n";
    csv += "Total Spend,Total POs,Total Items,Low Stock\n";
    csv += `${cards[0].totalSpend},${cards[0].totalPOs},${cards[0].totalStockItems},${cards[0].lowStockItems}\n\n`;

    // 🔥 MONTHLY SPEND
    csv += "=== MONTHLY SPEND ===\n";
    csv += "Month,Spend\n";
    monthlySpend.forEach(r => {
      csv += `${r.month},${r.spend}\n`;
    });
    csv += "\n";

    // 🔥 STOCK MOVEMENT
    csv += "=== STOCK MOVEMENT ===\n";
    csv += "Month,Stock In,Stock Out\n";
    stockMovement.forEach(r => {
      csv += `${r.month},${r.stockIn},${r.stockOut}\n`;
    });
    csv += "\n";

    // 🔥 CATEGORY
    csv += "=== CATEGORY DISTRIBUTION ===\n";
    csv += "Category,Total\n";
    categoryDistribution.forEach(r => {
      csv += `${r.category},${r.total}\n`;
    });

    // ================= DOWNLOAD =================
    const csvWithBom = "\uFEFF" + csv;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=reports-${Date.now()}.csv`
    );

    return res.send(csvWithBom);

  } catch (err) {
    console.error("❌ CSV EXPORT ERROR:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};


exports.exportClientsExcel = async (req, res) => {
  try {

    const user = req.user;
    const role = user?.role || user?.role?.name;
    const userBranches = user?.branches || [];

    if (!userBranches.length) {
      return res.status(403).json({
        success: false,
        message: "No branch access"
      });
    }

    // 👑 SUPER USER
    const isSuperUser =
      userBranches.includes("ALL") || role === "super_admin";

    let replacements = {};
    let branchFilter = "";

    if (!isSuperUser) {
      replacements.branchId = user.branch_id;
      branchFilter = "WHERE c.branch_id = :branchId";
    }

    // ================= DATA =================
    const [clients] = await sequelize.query(`
      SELECT
      c.name AS "vendorName",
      c.email,
      c.phone,
      c.gst_number AS "gstNumber",

      COALESCE(SUM(CASE WHEN l.type='SALE' THEN l.amount ELSE 0 END),0) AS "totalAmount",

      COALESCE(
        SUM(CASE WHEN l.type='SALE' THEN l.amount ELSE 0 END) -
        SUM(CASE WHEN l.type='PAYMENT' THEN l.amount ELSE 0 END)
      ,0) AS "pendingAmount"

      FROM clients c
      LEFT JOIN client_ledger l
      ON l.client_id = c.id
      ${isSuperUser ? "" : "AND l.branch_id = :branchId"}
      ${branchFilter}

      GROUP BY c.id
      ORDER BY c."createdAt" DESC
    `, { replacements });

    if (!clients.length) {
      return res.status(404).json({
        success: false,
        message: "No client data"
      });
    }

    // ================= EXCEL =================
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Clients Report");

    // 🔥 TOP INFO (same as inventory)
    worksheet.addRow(["User Role:", role]);
    worksheet.addRow([
      "Branch Access:",
      isSuperUser ? "ALL BRANCHES" : userBranches.join(", ")
    ]);
    worksheet.addRow(["Generated At:", new Date().toLocaleString()]);
    worksheet.addRow([]);

    // 🔥 HEADER
    worksheet.columns = [
      { header: "Vendor Name", key: "vendorName", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Phone", key: "phone", width: 20 },
      { header: "Total Amount", key: "totalAmount", width: 20 },
      { header: "Pending Amount", key: "pendingAmount", width: 20 },
      { header: "GST Number", key: "gstNumber", width: 25 }
    ];

    // 🔥 HEADER STYLE
    worksheet.getRow(5).font = { bold: true };

    // 🔥 DATA
    clients.forEach(c => {
      worksheet.addRow({
        vendorName: c.vendorName || "",
        email: c.email || "",
        phone: c.phone || "",
        totalAmount: c.totalAmount || 0,
        pendingAmount: c.pendingAmount || 0,
        gstNumber: c.gstNumber || ""
      });
    });

    // 🔥 TOTAL ROW
    const totalAmountSum = clients.reduce(
      (sum, c) => sum + Number(c.totalAmount || 0),
      0
    );

    const pendingAmountSum = clients.reduce(
      (sum, c) => sum + Number(c.pendingAmount || 0),
      0
    );

    worksheet.addRow([]);
    worksheet.addRow({
      vendorName: "TOTAL",
      totalAmount: totalAmountSum,
      pendingAmount: pendingAmountSum
    });

    // ================= DOWNLOAD =================
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=clients-report-${Date.now()}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("❌ CLIENT EXPORT ERROR:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

exports.exportUsersExcel = async (req, res) => {
  try {
    const user = req.user;

    const role = user?.role || user?.role?.name;
    const userBranches = user?.branches || [];

    if (!userBranches.length) {
      return res.status(403).json({
        success: false,
        message: "No branch access"
      });
    }

    // =========================
    // 👑 SUPER USER CHECK
    // =========================
    const isSuperUser =
      userBranches.includes("ALL") || role === "super_admin";

    let whereCondition = {};

    if (!isSuperUser) {
      if (user.branch_id) {
        whereCondition.branch_id = user.branch_id;
      } else {
        whereCondition.branch_id = {
          [Op.in]: userBranches
        };
      }
    }

    // =========================
    // 📦 FETCH USERS
    // =========================
    const users = await User.findAll({
      where: whereCondition,
      attributes: [
        "id",
        "name",
        "email",
        "secure_password",
        "branch_id",
        "created_at",
        "last_login",
        "is_active"
      ],
      include: [
        {
          association: "role",
          attributes: ["name"]
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["name", "location"]
        }
      ],
      order: [["created_at", "DESC"]]
    });

    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: "No users found"
      });
    }

    // =========================
    // 📊 EXCEL START
    // =========================
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Users Report");

    // 🔥 TOP INFO
    worksheet.addRow(["User Role:", role]);
    worksheet.addRow([
      "Branch Access:",
      isSuperUser ? "ALL BRANCHES" : userBranches.join(", ")
    ]);
    worksheet.addRow(["Generated At:", new Date().toLocaleString()]);
    worksheet.addRow([]);

    // =========================
    // 🔥 HEADER
    // =========================
    worksheet.columns = [
      { header: "Name", key: "name", width: 25 },
      { header: "Email", key: "email", width: 30 },
      { header: "Role", key: "role", width: 20 },
      { header: "Branch", key: "branch", width: 25 },
      { header: "Location", key: "location", width: 25 },
      { header: "Secure Password", key: "secure_password", width: 30 },
      { header: "Status", key: "status", width: 15 },
      { header: "Aging (Days)", key: "aging", width: 15 },
      { header: "Last Login", key: "last_login", width: 25 }
    ];

    // 🔥 HEADER STYLE
    worksheet.getRow(5).font = { bold: true };

    // =========================
    // 📥 DATA
    // =========================
    let activeCount = 0;
    let inactiveCount = 0;

    users.forEach((u) => {
      const aging = Math.floor(
        (Date.now() - new Date(u.created_at)) /
        (1000 * 60 * 60 * 24)
      );

      if (u.is_active) activeCount++;
      else inactiveCount++;

      worksheet.addRow({
        name: u.name || "",
        email: u.email || "",
        role: u.role?.name || "",
        branch: u.branch?.name || "",
        location: u.branch?.location || "",
        secure_password: u.secure_password || "",
        status: u.is_active ? "Active" : "Inactive",
        aging,
        last_login: u.last_login || ""
      });
    });

    // =========================
    // 📊 SUMMARY
    // =========================
    worksheet.addRow([]);
    worksheet.addRow({
      name: "TOTAL USERS",
      email: users.length
    });

    worksheet.addRow({
      name: "ACTIVE USERS",
      email: activeCount
    });

    worksheet.addRow({
      name: "INACTIVE USERS",
      email: inactiveCount
    });

    // =========================
    // 📥 DOWNLOAD
    // =========================
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=users-report-${Date.now()}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("❌ USER EXPORT ERROR:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

const REPORT_MAP = {
  users: exports.exportUsersExcel,
  clients: exports.exportClientsExcel,
  inventory: exports.exportInventoryExcel
};

exports.downloadReport = async (req, res) => {
  try {
    const { type } = req.query;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Report type is required"
      });
    }

    const handler = REPORT_MAP[type];

    if (!handler) {
      return res.status(400).json({
        success: false,
        message: "Invalid report type"
      });
    }

    return handler(req, res);

  } catch (err) {
    console.error("DOWNLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.exportSalesExcel = async (req, res) => {
  try {
    let role = req.user?.role || "";
    if (typeof role === "object") role = role.name;

    const branchId = req.user?.branch_id || null;
    const userBranches = req.user?.branches || [];
    const isSuperSales =
      role === "super_sales_manager" ||
      role === "super_admin" ||
      userBranches.includes("ALL");

    const whereClause = isSuperSales
      ? ""
      : branchId
      ? `WHERE q.branch_id = ${branchId}`
      : "";

    // ===============================
    // 🔹 SALES SUMMARY
    // ===============================
    const [salesSummary] = await sequelize.query(`
      SELECT 
        q.branch_id AS "branchId",
        q.quotation_no AS "quotationNo",
        c.name AS "clientName",
        q.total_amount AS "totalAmount",
        q.status,
        TO_CHAR(q."createdAt",'DD-MM-YYYY HH24:MI') AS "createdAt"
      FROM quotations q
      LEFT JOIN clients c ON c.id = q.client_id
      ${whereClause}
      ORDER BY q."createdAt" DESC
    `);

    // ===============================
    // 🔹 TOP PRODUCTS
    // ===============================
    const [topProducts] = await sequelize.query(`
      SELECT 
        q.branch_id AS "branchId",
        qi.product_name AS "productName",
        SUM(qi.quantity) AS "totalQty",
        SUM(qi.amount) AS "totalRevenue"
      FROM quotation_items qi
      JOIN quotations q ON q.id = qi.quotation_id
      ${isSuperSales ? "" : branchId ? `WHERE q.branch_id = ${branchId}` : ""}
      GROUP BY q.branch_id, qi.product_name
      ORDER BY "totalQty" DESC
    `);

    if (!salesSummary.length) {
      return res.status(404).json({
        success: false,
        message: "No sales data found"
      });
    }

    // ===============================
    // 📘 EXCEL START
    // ===============================
    const workbook = new ExcelJS.Workbook();

    // ===============================
    // 📄 SHEET 1: SALES REPORT
    // ===============================
    const salesSheet = workbook.addWorksheet("Sales Report");

    salesSheet.addRow(["User Role:", role]);
    salesSheet.addRow([
      "Branch Access:",
      isSuperSales ? "ALL BRANCHES" : branchId
    ]);
    salesSheet.addRow(["Generated At:", new Date().toLocaleString()]);
    salesSheet.addRow([]);

    salesSheet.columns = [
      { header: "Branch ID", key: "branchId", width: 15 },
      { header: "Quotation No", key: "quotationNo", width: 20 },
      { header: "Client Name", key: "clientName", width: 25 },
      { header: "Total Amount", key: "totalAmount", width: 18 },
      { header: "Status", key: "status", width: 18 },
      { header: "Created At", key: "createdAt", width: 22 }
    ];

    salesSheet.getRow(5).font = { bold: true };

    salesSummary.forEach((row) => {
      salesSheet.addRow({
        branchId: row.branchId,
        quotationNo: row.quotationNo,
        clientName: row.clientName || "",
        totalAmount: row.totalAmount || 0,
        status: row.status || "",
        createdAt: row.createdAt || ""
      });
    });

    const totalSalesAmount = salesSummary.reduce(
      (sum, row) => sum + Number(row.totalAmount || 0),
      0
    );

    salesSheet.addRow([]);
    salesSheet.addRow({
      quotationNo: "TOTAL SALES",
      totalAmount: totalSalesAmount
    });

    // ===============================
    // 📄 SHEET 2: TOP PRODUCTS
    // ===============================
    const productSheet = workbook.addWorksheet("Top Products");

    productSheet.addRow(["User Role:", role]);
    productSheet.addRow([
      "Branch Access:",
      isSuperSales ? "ALL BRANCHES" : branchId
    ]);
    productSheet.addRow(["Generated At:", new Date().toLocaleString()]);
    productSheet.addRow([]);

    productSheet.columns = [
      { header: "Branch ID", key: "branchId", width: 15 },
      { header: "Product Name", key: "productName", width: 30 },
      { header: "Total Qty Sold", key: "totalQty", width: 18 },
      { header: "Total Revenue", key: "totalRevenue", width: 20 }
    ];

    productSheet.getRow(5).font = { bold: true };

    topProducts.forEach((row) => {
      productSheet.addRow({
        branchId: row.branchId,
        productName: row.productName || "",
        totalQty: row.totalQty || 0,
        totalRevenue: row.totalRevenue || 0
      });
    });

    const totalProductRevenue = topProducts.reduce(
      (sum, row) => sum + Number(row.totalRevenue || 0),
      0
    );

    productSheet.addRow([]);
    productSheet.addRow({
      productName: "TOTAL PRODUCT REVENUE",
      totalRevenue: totalProductRevenue
    });

    // ===============================
    // 📥 DOWNLOAD
    // ===============================
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=sales-report-${Date.now()}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("❌ SALES EXCEL EXPORT ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};



// exports.exportSalesExcel = async (req, res) => {
//   try {
//     let role = req.user?.role || "";
//     if (typeof role === "object") role = role.name;

//     const branchId = req.user?.branch_id || null;
//     const userBranches = req.user?.branches || [];
//     const isSuperSales =
//       role === "super_sales_manager" ||
//       role === "super_admin" ||
//       userBranches.includes("ALL");

//     const whereClause = isSuperSales
//       ? ""
//       : branchId
//       ? `WHERE i.branch_id = ${branchId}`
//       : "";

//     // ===============================
//     // 🔹 SALES SUMMARY (ACTUAL SALES)
//     // ===============================
//     const [salesSummary] = await sequelize.query(`
//       SELECT 
//         i.branch_id AS "branchId",
//         i.invoice_no AS "invoiceNo",
//         c.name AS "clientName",
//         COALESCE(i.total_amount, 0) AS "totalAmount",
//         COALESCE(i.status, 'invoiced') AS "status",
//         TO_CHAR(i."createdAt",'DD-MM-YYYY HH24:MI') AS "createdAt"
//       FROM invoices i
//       LEFT JOIN clients c ON c.id = i.client_id
//       ${whereClause}
//       ORDER BY i."createdAt" DESC
//     `);

//     // ===============================
//     // 🔹 TOP PRODUCTS (ACTUAL SOLD ITEMS)
//     // ===============================
//     const [topProducts] = await sequelize.query(`
//       SELECT 
//         i.branch_id AS "branchId",
//         COALESCE(s.name, s.item_name, s.product_name, CONCAT('Stock #', ii.stock_id)) AS "productName",
//         COALESCE(SUM(ii.quantity), 0) AS "totalQty",
//         COALESCE(SUM(ii.total), 0) AS "totalRevenue"
//       FROM invoice_items ii
//       JOIN invoices i ON i.id = ii.invoice_id
//       LEFT JOIN stocks s ON s.id = ii.stock_id
//       ${isSuperSales ? "" : branchId ? `WHERE i.branch_id = ${branchId}` : ""}
//       GROUP BY i.branch_id, s.name, s.item_name, s.product_name, ii.stock_id
//       ORDER BY "totalQty" DESC
//     `);

//     if (!salesSummary.length) {
//       return res.status(404).json({
//         success: false,
//         message: "No sales data found"
//       });
//     }

//     // ===============================
//     // 📘 EXCEL START
//     // ===============================
//     const workbook = new ExcelJS.Workbook();

//     // ===============================
//     // 📄 SHEET 1: SALES REPORT
//     // ===============================
//     const salesSheet = workbook.addWorksheet("Sales Report");

//     salesSheet.addRow(["User Role:", role]);
//     salesSheet.addRow([
//       "Branch Access:",
//       isSuperSales ? "ALL BRANCHES" : branchId
//     ]);
//     salesSheet.addRow(["Generated At:", new Date().toLocaleString()]);
//     salesSheet.addRow([]);

//     salesSheet.columns = [
//       { header: "Branch ID", key: "branchId", width: 15 },
//       { header: "Invoice No", key: "invoiceNo", width: 20 },
//       { header: "Client Name", key: "clientName", width: 25 },
//       { header: "Total Amount", key: "totalAmount", width: 18 },
//       { header: "Status", key: "status", width: 18 },
//       { header: "Created At", key: "createdAt", width: 22 }
//     ];

//     salesSheet.getRow(5).font = { bold: true };

//     salesSummary.forEach((row) => {
//       salesSheet.addRow({
//         branchId: row.branchId,
//         invoiceNo: row.invoiceNo,
//         clientName: row.clientName || "",
//         totalAmount: Number(row.totalAmount || 0),
//         status: row.status || "",
//         createdAt: row.createdAt || ""
//       });
//     });

//     const totalSalesAmount = salesSummary.reduce(
//       (sum, row) => sum + Number(row.totalAmount || 0),
//       0
//     );

//     salesSheet.addRow([]);
//     salesSheet.addRow({
//       invoiceNo: "TOTAL SALES",
//       totalAmount: totalSalesAmount
//     });

//     // ===============================
//     // 📄 SHEET 2: TOP PRODUCTS
//     // ===============================
//     const productSheet = workbook.addWorksheet("Top Products");

//     productSheet.addRow(["User Role:", role]);
//     productSheet.addRow([
//       "Branch Access:",
//       isSuperSales ? "ALL BRANCHES" : branchId
//     ]);
//     productSheet.addRow(["Generated At:", new Date().toLocaleString()]);
//     productSheet.addRow([]);

//     productSheet.columns = [
//       { header: "Branch ID", key: "branchId", width: 15 },
//       { header: "Product Name", key: "productName", width: 30 },
//       { header: "Total Qty Sold", key: "totalQty", width: 18 },
//       { header: "Total Revenue", key: "totalRevenue", width: 20 }
//     ];

//     productSheet.getRow(5).font = { bold: true };

//     topProducts.forEach((row) => {
//       productSheet.addRow({
//         branchId: row.branchId,
//         productName: row.productName || "",
//         totalQty: Number(row.totalQty || 0),
//         totalRevenue: Number(row.totalRevenue || 0)
//       });
//     });

//     const totalProductRevenue = topProducts.reduce(
//       (sum, row) => sum + Number(row.totalRevenue || 0),
//       0
//     );

//     productSheet.addRow([]);
//     productSheet.addRow({
//       productName: "TOTAL PRODUCT REVENUE",
//       totalRevenue: totalProductRevenue
//     });

//     // ===============================
//     // 📥 DOWNLOAD
//     // ===============================
//     res.setHeader(
//       "Content-Type",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//     );

//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename=sales-report-${Date.now()}.xlsx`
//     );

//     await workbook.xlsx.write(res);
//     res.end();

//   } catch (err) {
//     console.error("❌ SALES EXCEL EXPORT ERROR:", err);
//     res.status(500).json({
//       success: false,
//       message: err.message
//     });
//   }
// };