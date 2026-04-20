const { QueryTypes, Op } = require("sequelize");
const sequelize = require("../../../config/sqlcon");
const Stock = require("../../../model/SQL_Model/stock.record")
const { Branch, Ledger} = require("../../../model/SQL_Model");
const { ClientLedger, Client } = require("../../../model/SQL_Model");

// ============================
// INVENTORY DASHBOARD
// ============================
exports.getInventoryDashboard = async (req, res) => {
  try {

    const userBranches = req.user?.branches || [];

    if (!userBranches.length) {
      return res.status(403).json({
        success: false,
        message: "No branch access"
      });
    }

    // 👑 SUPER USER CHECK
    const isSuperUser = userBranches.includes("ALL");

    // =========================
    // WHERE CONDITION
    // =========================
    const whereCondition = isSuperUser
      ? {} // ✅ ALL DATA
      : {
          branch_id: {
            [Op.in]: userBranches
          }
        };

    const data = await Stock.findAll({
      where: whereCondition,

      attributes: [
        "id",
        "item",
        "category",
        "hsn",
        "grn",
        "po_number",
        ["quantity", "current_stock"],
        "status",
        "branch_id",

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

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory data"
    });
  }
};



// ============================
// DASHBOARD CHARTS
// ============================
exports.getInventoryDashboardCharts = async (req, res) => {
  try {

    const userBranches = req.user?.branches || [];

    if (!userBranches.length) {
      return res.status(403).json({
        success: false,
        message: "No branch access"
      });
    }

    // PURCHASE AMOUNT PER MONTH
    const purchaseChart = await sequelize.query(
      `
      SELECT 
        TO_CHAR(l."createdAt",'Mon') AS month,
        DATE_PART('month',l."createdAt") AS month_no,
        COALESCE(SUM(l.total),0) AS "purchaseAmount"

      FROM ledger l
      JOIN stocks s ON s.id = l.stock_id

      WHERE l.type='PURCHASE'
      AND s.branch_id = ANY(:branches)

      GROUP BY month, month_no
      ORDER BY month_no
      `,
      {
        replacements: { branches: userBranches },
        type: QueryTypes.SELECT
      }
    );

    // STOCK STATUS OVERVIEW
    const stockStatus = await Stock.findAll({
      where: {
        branch_id: { [Op.in]: userBranches }
      },
      attributes: [
        "status",
        [sequelize.fn("SUM", sequelize.col("quantity")), "total"]
      ],
      group: ["status"],
      raw: true
    });

    const formattedStatus = {
      available: 0,
      damaged: 0,
      repairable: 0
    };

    stockStatus.forEach(item => {
      if (item.status === "GOOD") formattedStatus.available = Number(item.total);
      if (item.status === "DAMAGED") formattedStatus.damaged = Number(item.total);
      if (item.status === "REPAIRABLE") formattedStatus.repairable = Number(item.total);
    });

    res.json({
      success: true,
      charts: {
        purchaseAmountOverTime: purchaseChart.map(i => ({
          month: i.month,
          purchaseAmount: Number(i.purchaseAmount)
        })),
        stockStatusOverview: formattedStatus
      }
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard charts"
    });

  }
};


exports.addStockItem = async (req, res) => {
  try {
    const {
      item,
      category,
      hsn,
      grn,
      purchaseOrder,
      quantity,
      rate,
    } = req.body;

    const value = quantity * rate;

    const newItem = await Stock.create({
      item,
      category,
      hsn,
      grn,
      purchaseOrder,
      quantity,
      rate,
      value,

      branch_id: req.user.branch_id,
      owner_id: req.user.id, // ✅ FIX HERE
    });

    res.status(201).json({
      success: true,
      data: newItem,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message,
    });
  }
};
// ============================
// BRANCH OVERVIEW
// ============================
exports.getBranchOverview = async (req, res) => {
  try {

    // =========================
    // 🔥 GET USER BRANCHES
    // =========================
    let userBranches = req.user?.branches || [];

    // ✅ fallback (agar login me sirf branch_id ho)
    if (!userBranches.length && req.user?.branch_id) {
      userBranches = [req.user.branch_id];
    }

    // 🚨 FINAL CHECK
    if (!userBranches.length) {
      return res.status(403).json({
        success: false,
        message: "No branch access"
      });
    }

    // =========================
    // 🔥 MAIN QUERY (FIXED)
    // =========================
    const data = await sequelize.query(
      `
      SELECT 
        b.name AS "branchName",
        s.category,
        COALESCE(SUM(s.quantity),0) AS "currentStock",

        COALESCE(SUM(
          CASE 
            WHEN l.type='PURCHASE' THEN l.quantity 
            ELSE 0 
          END
        ),0) AS "stockIn",

        COALESCE(SUM(
          CASE 
            WHEN l.type='SALE' THEN l.quantity 
            ELSE 0 
          END
        ),0) AS "stockOut"

      FROM stocks s

      LEFT JOIN ledger l 
        ON l.stock_id = s.id

      LEFT JOIN branches b 
        ON b.id = s.branch_id

      WHERE s.branch_id IN (:branches)   -- ✅ FIXED (ANY → IN)

      GROUP BY b.name, s.category

      ORDER BY b.name ASC
      `,
      {
        replacements: { branches: userBranches },
        type: QueryTypes.SELECT
      }
    );

    // =========================
    // ✅ RESPONSE
    // =========================
    res.json({
      success: true,
      totalBranches: userBranches.length,
      data
    });

  } catch (error) {

    console.error("Branch Overview Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch branch overview",
      error: error.message   // ✅ debugging helpful
    });
  }
};

// ============================
// SINGLE BRANCH DASHBOARD
// ============================
exports.getBranchDashboard = async (req, res) => {
  try {
    const branch = Number(req.params.branch);
    const userBranches = req.user?.branches || [];

    if (!userBranches.includes(branch)) {
      return res.status(403).json({
        success: false,
        message: "Access denied for this branch"
      });
    }

    // =======================
    // CARDS
    // =======================
    const cards = await sequelize.query(
      `
      SELECT 
        COUNT(id) AS "totalStockItems",
        COALESCE(SUM(quantity),0) AS "totalStock",
        COALESCE(SUM(rate * quantity),0) AS "totalStockValue"
      FROM stocks
      WHERE branch_id = :branch
      `,
      {
        replacements: { branch },
        type: QueryTypes.SELECT
      }
    );

    // =======================
    // PURCHASE AMOUNT
    // =======================
    const purchaseAmount = await sequelize.query(
      `
      SELECT COALESCE(SUM(l.total),0) AS "purchaseAmount"
      FROM ledger l
      JOIN stocks s ON s.id = l.stock_id
      WHERE l.type='PURCHASE' AND s.branch_id = :branch
      `,
      {
        replacements: { branch },
        type: QueryTypes.SELECT
      }
    );

    // =======================
    // TRANSIT ITEMS (SAFE)
    // =======================
    const transitItems = await sequelize.query(
      `
      SELECT COALESCE(SUM(
        CASE 
          WHEN l.type='PURCHASE' THEN l.quantity
          WHEN l.type='SALE' THEN -l.quantity
          ELSE 0
        END
      ),0) AS "transitItems"
      FROM ledger l
      JOIN stocks s ON s.id = l.stock_id
      WHERE s.branch_id = :branch
      `,
      {
        replacements: { branch },
        type: QueryTypes.SELECT
      }
    );

    // =======================
    // LINE CHART
    // =======================
    const purchaseChart = await sequelize.query(
      `
      SELECT 
        TO_CHAR(l."createdAt",'Mon') AS month,
        COALESCE(SUM(l.total),0) AS "purchaseAmount"
      FROM ledger l
      JOIN stocks s ON s.id = l.stock_id
      WHERE l.type='PURCHASE'
      AND s.branch_id = :branch
      GROUP BY TO_CHAR(l."createdAt",'Mon'), DATE_PART('month',l."createdAt")
      ORDER BY DATE_PART('month',l."createdAt")
      `,
      {
        replacements: { branch },
        type: QueryTypes.SELECT
      }
    );

    // =======================
    // STATUS PIE
    // =======================
    const status = await sequelize.query(
      `
      SELECT status, COUNT(*) AS total
      FROM stocks
      WHERE branch_id = :branch
      GROUP BY status
      `,
      {
        replacements: { branch },
        type: QueryTypes.SELECT
      }
    );

    const formattedStatus = {
      available: 0,
      damaged: 0,
      repairable: 0
    };

    status.forEach(row => {
      if (row.status === "GOOD") formattedStatus.available = Number(row.total);
      if (row.status === "DAMAGED") formattedStatus.damaged = Number(row.total);
      if (row.status === "REPAIRABLE") formattedStatus.repairable = Number(row.total);
    });

    // =======================
    // TABLE DATA (FIXED)
    // =======================
    const table = await sequelize.query(
      `
      SELECT 
        s.item AS "itemName",
        s.category,

        s.hsn AS "hsnCode",        -- ✅ correct column
        s.grn AS "grnNo",          -- ✅ correct column

        s.po_number AS "purchaseOrderNo",
        s.quantity AS "currentStock",

        COALESCE(SUM(CASE WHEN l.type='PURCHASE' THEN l.quantity ELSE 0 END),0) AS "stockIn",
        COALESCE(SUM(CASE WHEN l.type='SALE' THEN l.quantity ELSE 0 END),0) AS "stockOut",

        0 AS "scrap",              -- ✅ temp (column nahi hai)
        NULL AS "dispatchDate",    -- ✅ temp
        NULL AS "deliveryDate",    -- ✅ temp

        s.status

      FROM stocks s
      LEFT JOIN ledger l ON l.stock_id = s.id

      WHERE s.branch_id = :branch

      GROUP BY s.id

      ORDER BY s.created_at DESC

      LIMIT 50
      `,
      {
        replacements: { branch },
        type: QueryTypes.SELECT
      }
    );

    // =======================
    // FINAL RESPONSE
    // =======================
    res.json({
      success: true,
      cards: {
        ...cards[0],
        purchaseAmount: purchaseAmount[0].purchaseAmount,
        transitItems: transitItems[0].transitItems
      },
      charts: {
        purchaseAmount: purchaseChart,
        agingDistribution: formattedStatus
      },
      table
    });

  } catch (error) {
    console.error("Dashboard Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch branch dashboard",
      error: error.message
    });
  }
};
// controllers/inventoryController.js

exports.getFullInventoryDashboard = async (req, res) => {
  try {

    const userBranches = req.user?.branches || [];

    if (!Array.isArray(userBranches) || userBranches.length === 0) {
      return res.status(403).json({
        success: false,
        message: "No branch access"
      });
    }

    // ==========================
    // 1️⃣ TOP CARDS
    // ==========================
    const cards = await sequelize.query(
      `
      SELECT
        COUNT(id) AS "totalStockItems",
        COALESCE(SUM(quantity),0) AS "totalStock",
        COALESCE(SUM(quantity * rate),0) AS "totalStockValue"
      FROM stocks
      WHERE branch_id = ANY(:branches)
      `,
      {
        replacements: { branches: userBranches },
        type: QueryTypes.SELECT
      }
    );

    const purchaseAmount = await sequelize.query(
      `
      SELECT
        COALESCE(SUM(total),0) AS "purchaseAmount"
      FROM ledger
      WHERE type='PURCHASE'
      AND branch_id = ANY(:branches)
      `,
      {
        replacements: { branches: userBranches },
        type: QueryTypes.SELECT
      }
    );

    // ==========================
    // 2️⃣ PURCHASE CHART
    // ==========================
    const purchaseChart = await sequelize.query(
      `
      SELECT
        TO_CHAR("createdAt",'Mon') AS month,
        COALESCE(SUM(total),0) AS "purchaseAmount"
      FROM ledger
      WHERE type='PURCHASE'
      AND branch_id = ANY(:branches)
      GROUP BY
        TO_CHAR("createdAt",'Mon'),
        DATE_PART('month',"createdAt")
      ORDER BY DATE_PART('month',"createdAt")
      `,
      {
        replacements: { branches: userBranches },
        type: QueryTypes.SELECT
      }
    );

    // ==========================
    // 3️⃣ AGING DISTRIBUTION
    // ==========================
    const status = await sequelize.query(
      `
      SELECT status, COUNT(*) AS total
      FROM stocks
      WHERE branch_id = ANY(:branches)
      GROUP BY status
      `,
      {
        replacements: { branches: userBranches },
        type: QueryTypes.SELECT
      }
    );

    const agingDistribution = {
      available: 0,
      damaged: 0,
      repairable: 0
    };

    status.forEach(row => {
      if (row.status === "GOOD") agingDistribution.available = Number(row.total);
      if (row.status === "DAMAGED") agingDistribution.damaged = Number(row.total);
      if (row.status === "REPAIRABLE") agingDistribution.repairable = Number(row.total);
    });

    // ==========================
    // 4️⃣ INVENTORY TABLE
    // ==========================
    const tableData = await sequelize.query(
      `
      SELECT
        s.id,
        s.item,
        s.category,
        s.hsn,
        s.grn,
        s.po_number,
        s.quantity AS "currentStock",

        COALESCE(SUM(CASE WHEN l.type='PURCHASE' THEN l.quantity ELSE 0 END),0) AS "stockIn",
        COALESCE(SUM(CASE WHEN l.type='SALE' THEN l.quantity ELSE 0 END),0) AS "stockOut",
        COALESCE(SUM(CASE WHEN l.type='DAMAGE' THEN l.quantity ELSE 0 END),0) AS "scrap",

        s.status

      FROM stocks s
      LEFT JOIN ledger l ON l.stock_id = s.id

      WHERE s.branch_id = ANY(:branches)

      GROUP BY
        s.id, s.item, s.category, s.hsn, s.grn, s.po_number, s.quantity, s.status

      ORDER BY s.id DESC
      `,
      {
        replacements: { branches: userBranches },
        type: QueryTypes.SELECT
      }
    );

    // ==========================
    // FINAL RESPONSE
    // ==========================
    return res.json({
      success: true,

      cards: {
        totalStockItems: Number(cards[0].totalStockItems),
        totalStock: Number(cards[0].totalStock),
        totalStockValue: Number(cards[0].totalStockValue),
        purchaseAmount: Number(purchaseAmount[0].purchaseAmount)
      },

      charts: {
        purchaseAmountOverTime: purchaseChart,
        agingDistribution
      },

      table: tableData
    });

  } catch (error) {

    console.error("Inventory Dashboard Error:", error);

    return res.status(500).json({
      success: false,
      message: "Dashboard loading failed"
    });

  }
};

exports.getInventoryTable = async (req, res) => {
  try {

    const data = await sequelize.query(

`SELECT 
s.item AS "itemName",
s.category AS "categories",
s.hsn AS "hsnCode",
s.grn AS "grnNo",
s.po_number AS "poNumber",

s.quantity AS "currentStock",

COALESCE(SUM(CASE WHEN sm.type='IN' THEN sm.quantity ELSE 0 END),0) AS "stockIn",

COALESCE(SUM(CASE WHEN sm.type='OUT' THEN sm.quantity ELSE 0 END),0) AS "stockOut",

COALESCE(SUM(CASE WHEN s.status='DAMAGED' THEN sm.quantity ELSE 0 END),0) AS "scrap",

s.created_at AS "dispatchDate",
s.updated_at AS "deliveryDate",

s.status AS "status"

FROM stocks s

LEFT JOIN stock_movements sm
ON s.id = sm.stock_id

GROUP BY s.id

ORDER BY s.id DESC

`
);

    res.json({
      success: true,
      total: data[0].length,
      data: data[0]
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }
};

exports.getPurchaseSalesSummary = async (req, res) => {
  try {

    const data = await sequelize.query(`
      SELECT 
      COALESCE(SUM(CASE WHEN type='IN' THEN quantity ELSE 0 END),0) AS "totalPurchase",
      COALESCE(SUM(CASE WHEN type='OUT' THEN quantity ELSE 0 END),0) AS "totalSales"
      FROM stock_movements
    `);

    res.json({
      success: true,
      data: data[0][0]
    });

  } catch (err) {

    res.status(500).json({
      success:false,
      message:err.message
    });

  }
};

exports.getPurchaseItems = async (req, res) => {
  try {

    const data = await sequelize.query(`

      SELECT 
      s.item,
      s.category,
      s.hsn,
      s.grn,
      s.po_number,
      sm.quantity AS "purchaseQuantity",
      s.branch_id,
      sm.created_at AS "purchaseDate"

      FROM stock_movements sm

      JOIN stocks s
      ON sm.stock_id = s.id

      WHERE sm.type = 'IN'

      ORDER BY sm.created_at DESC

    `);

    res.json({
      success: true,
      total: data[0].length,
      data: data[0]
    });

  } catch (err) {

    res.status(500).json({
      success:false,
      message:err.message
    });

  }
};

exports.getDamageStock = async (req, res) => {
  try {

    const data = await sequelize.query(`

      SELECT 
      item,
      category,
      hsn,
      grn,
      po_number,
      quantity,
      aging,
      branch_id,
      status,
      created_at

      FROM stocks

      WHERE status = 'DAMAGED'

      ORDER BY created_at DESC

    `);

    res.json({
      success: true,
      total: data[0].length,
      data: data[0]
    });

  } catch (err) {

    res.status(500).json({
      success:false,
      message:err.message
    });

  }
};

exports.getAgingStock = async (req, res) => {
  try {

    const data = await sequelize.query(`

      SELECT 
      item,
      category,
      quantity,
      aging,
      branch_id,
      status

      FROM stocks

      WHERE aging > 90

      ORDER BY aging DESC

    `);

    res.json({
      success: true,
      total: data[0].length,
      data: data[0]
    });

  } catch (err) {

    res.status(500).json({
      success:false,
      message:err.message
    });

  }
};



exports.getStockMovements = async (req, res) => {
  try {

    const data = await sequelize.query(`

SELECT 

s.item,
s.category,
s.hsn,
s.grn,
s.po_number,

sm.type AS "movementType",
sm.quantity,

s.branch_id,

sm.created_at AS "movementDate"

FROM stock_movements sm

JOIN stocks s
ON sm.stock_id = s.id

ORDER BY sm.created_at DESC

`);

    res.json({
      success: true,
      total: data[0].length,
      data: data[0]
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }
};

exports.getInventoryDashboard = async (req, res) => {
  try {

    const user = req.user;

    const SUPER_ROLES = [
      "super_admin",
      "super_inventory_manager",
      "super_stock_manager"
    ];

    const role = user?.role?.toLowerCase().trim();
    const isSuper = SUPER_ROLES.includes(role);

    // =========================
    // 🔥 DYNAMIC FILTER
    // =========================
    const branchCondition = isSuper
      ? "" // 👉 ALL DATA
      : "AND branch_id = :branchId";

    const replacements = isSuper
      ? {}
      : { branchId: user.branch_id };

    // =========================
    // CARDS DATA
    // =========================
    const cards = await sequelize.query(`

      SELECT 
      COUNT(id)::INTEGER AS "totalStockItems",
      COALESCE(SUM(value),0)::INTEGER AS "totalStockValue",

      COALESCE((
        SELECT SUM(quantity)
        FROM stock_movements
        WHERE type='IN'
        ${branchCondition}
      ),0)::INTEGER AS "purchaseAmount",

      COALESCE((
        SELECT COUNT(id)
        FROM stock_movements
        WHERE type='OUT'
        ${branchCondition}
      ),0)::INTEGER AS "transitItems"

      FROM stocks
      ${isSuper ? "" : "WHERE branch_id = :branchId"}

    `,{ replacements });


    // =========================
    // PURCHASE CHART
    // =========================
    const purchaseChart = await sequelize.query(`

      SELECT 
      TO_CHAR(created_at,'Mon') AS month,
      SUM(quantity)::INTEGER AS amount

      FROM stock_movements
      WHERE type='IN'
      ${branchCondition}

      GROUP BY month, DATE_PART('month',created_at)
      ORDER BY DATE_PART('month',created_at)

    `,{ replacements });


    // =========================
    // AGING CHART
    // =========================
    const agingChart = await sequelize.query(`

      SELECT 
      SUM(CASE WHEN status='GOOD' THEN quantity ELSE 0 END)::INTEGER AS available,
      SUM(CASE WHEN status='DAMAGED' THEN quantity ELSE 0 END)::INTEGER AS damaged,
      SUM(CASE WHEN status='REPAIRABLE' THEN quantity ELSE 0 END)::INTEGER AS repairable

      FROM stocks
      ${isSuper ? "" : "WHERE branch_id = :branchId"}

    `,{ replacements });


    // =========================
    // INVENTORY TABLE
    // =========================
    const table = await sequelize.query(`

      SELECT 
      s.item AS "itemName",
      s.category AS "categories",
      s.hsn AS "hsnCode",
      s.grn AS "grnNo",
      s.po_number AS "poNumber",
      s.quantity AS "currentStock",

      COALESCE(SUM(CASE WHEN sm.type='IN' THEN sm.quantity ELSE 0 END),0)::INTEGER AS "stockIn",

      COALESCE(SUM(CASE WHEN sm.type='OUT' THEN sm.quantity ELSE 0 END),0)::INTEGER AS "stockOut",

      COALESCE(SUM(CASE WHEN s.status='DAMAGED' THEN sm.quantity ELSE 0 END),0)::INTEGER AS "scrap",

      s.created_at AS "dispatchDate",
      s.updated_at AS "deliveryDate",
      s.status

      FROM stocks s
      LEFT JOIN stock_movements sm ON s.id = sm.stock_id

      ${isSuper ? "" : "WHERE s.branch_id = :branchId"}

      GROUP BY s.id
      ORDER BY s.id DESC
      LIMIT 50

    `,{ replacements });


    res.json({
      success: true,
      role: isSuper ? "SUPER" : "BRANCH",
      dashboard: {
        cards: cards[0][0],
        purchaseChart: purchaseChart[0],
        agingChart: agingChart[0][0],
        inventoryTable: table[0]
      }
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }
};

exports.getStockAgingDashboard = async (req, res) => {
  try {

    const isSuperUser = req.user?.branches?.includes("ALL");
    const branchId = req.user?.branch_id || null;

    // =========================
    // CARDS
    // =========================
    const cards = await sequelize.query(`
      SELECT 
      SUM(quantity)::INTEGER AS "totalItems",

      SUM(CASE 
        WHEN NOW() - created_at <= INTERVAL '180 days'
        THEN quantity ELSE 0 END)::INTEGER AS "freshStocks",

      SUM(CASE 
        WHEN NOW() - created_at > INTERVAL '730 days'
        THEN quantity ELSE 0 END)::INTEGER AS "critical",

      ROUND(
        AVG(DATE_PART('day', NOW() - created_at))
      )::INTEGER AS "averageAging"

      FROM stocks
      WHERE (:isSuper = true OR branch_id = :branchId)
    `,{
      replacements:{ isSuper: isSuperUser, branchId }
    });


    // =========================
    // AGING DISTRIBUTION
    // =========================
    const agingDistribution = await sequelize.query(`
      SELECT 

      SUM(CASE 
        WHEN NOW() - created_at <= INTERVAL '180 days'
        THEN quantity ELSE 0 END)::INTEGER AS "0-180",

      SUM(CASE 
        WHEN NOW() - created_at > INTERVAL '180 days'
        AND NOW() - created_at <= INTERVAL '365 days'
        THEN quantity ELSE 0 END)::INTEGER AS "181-365",

      SUM(CASE 
        WHEN NOW() - created_at > INTERVAL '365 days'
        AND NOW() - created_at <= INTERVAL '730 days'
        THEN quantity ELSE 0 END)::INTEGER AS "366-730",

      SUM(CASE 
        WHEN NOW() - created_at > INTERVAL '730 days'
        THEN quantity ELSE 0 END)::INTEGER AS "730+"

      FROM stocks
      WHERE (:isSuper = true OR branch_id = :branchId)
    `,{
      replacements:{ isSuper: isSuperUser, branchId }
    });


    // =========================
    // AGING BY CATEGORY
    // =========================
    const agingByCategory = await sequelize.query(`
      SELECT 
      category,

      SUM(quantity)::INTEGER AS "average",

      SUM(CASE 
        WHEN status = 'GOOD'
        THEN quantity ELSE 0 END)::INTEGER AS "good",

      SUM(CASE 
        WHEN status = 'REPAIRABLE'
        THEN quantity ELSE 0 END)::INTEGER AS "repairable",

      SUM(CASE 
        WHEN status = 'DAMAGED'
        THEN quantity ELSE 0 END)::INTEGER AS "damaged"

      FROM stocks
      WHERE (:isSuper = true OR branch_id = :branchId)

      GROUP BY category
      ORDER BY category
    `,{
      replacements:{ isSuper: isSuperUser, branchId }
    });


    // =========================
    // TABLE DATA
    // =========================
    const table = await sequelize.query(`
      SELECT 
      po_number AS "purchaseOrderNo",
      item AS "itemName",
      category AS "categories",
      branch_id AS "branch",
      quantity,
      value,

      CASE
        WHEN NOW() - created_at <= INTERVAL '180 days'
        THEN 'Fresh'
        WHEN NOW() - created_at <= INTERVAL '365 days'
        THEN 'Normal'
        WHEN NOW() - created_at <= INTERVAL '730 days'
        THEN 'Slow'
        ELSE 'Critical'
      END AS status

      FROM stocks
      WHERE (:isSuper = true OR branch_id = :branchId)

      ORDER BY created_at DESC
      LIMIT 50
    `,{
      replacements:{ isSuper: isSuperUser, branchId }
    });


    res.json({
      success:true,
      dashboard:{
        cards: cards[0][0],
        agingDistribution: agingDistribution[0][0],
        agingByCategory: agingByCategory[0],
        table: table[0]
      }
    });

  } catch (err) {

    res.status(500).json({
      success:false,
      message: err.message
    });

  }
};

exports.getReportsAnalyticsDashboard = async (req, res) => {
  try {

    const isSuperUser = req.user?.branches?.includes("ALL");
    const branchId = req.user?.branch_id || null;

    // =========================
    // CARDS
    // =========================
    const cards = await sequelize.query(`
      SELECT 
        COALESCE(SUM(value),0)::INTEGER AS "totalSpend",
        COUNT(id)::INTEGER AS "totalPOs",
        COALESCE(SUM(quantity),0)::INTEGER AS "totalStockItems",
        SUM(CASE WHEN quantity < 10 THEN 1 ELSE 0 END)::INTEGER AS "lowStockItems"
      FROM stocks
      WHERE (:isSuper = true OR branch_id = :branchId)
    `, {
      replacements: { isSuper: isSuperUser, branchId }
    });

    // =========================
    // MONTHLY SPEND
    // =========================
    const monthlySpend = await sequelize.query(`
      SELECT 
        TO_CHAR(created_at,'Mon') AS month,
        SUM(value)::INTEGER AS spend
      FROM stocks
      WHERE (:isSuper = true OR branch_id = :branchId)
      GROUP BY month, DATE_PART('month',created_at)
      ORDER BY DATE_PART('month',created_at)
    `, {
      replacements: { isSuper: isSuperUser, branchId }
    });

    // =========================
    // STOCK MOVEMENT
    // =========================
    const stockMovement = await sequelize.query(`
      SELECT 
        TO_CHAR(created_at,'Mon') AS month,
        SUM(CASE WHEN type='IN' THEN quantity ELSE 0 END)::INTEGER AS "stockIn",
        SUM(CASE WHEN type='OUT' THEN quantity ELSE 0 END)::INTEGER AS "stockOut"
      FROM stock_movements
      WHERE (:isSuper = true OR branch_id = :branchId)
      GROUP BY month, DATE_PART('month',created_at)
      ORDER BY DATE_PART('month',created_at)
    `, {
      replacements: { isSuper: isSuperUser, branchId }
    });

    // =========================
    // PURCHASE ORDER TRENDS
    // =========================
    const purchaseOrderTrends = await sequelize.query(`
      SELECT 
        category,
        SUM(CASE WHEN status='GOOD' THEN quantity ELSE 0 END)::INTEGER AS approved,
        SUM(CASE WHEN status='REPAIRABLE' THEN quantity ELSE 0 END)::INTEGER AS pending,
        SUM(CASE WHEN status='DAMAGED' THEN quantity ELSE 0 END)::INTEGER AS rejected
      FROM stocks
      WHERE (:isSuper = true OR branch_id = :branchId)
      GROUP BY category
    `, {
      replacements: { isSuper: isSuperUser, branchId }
    });

    // =========================
    // CATEGORY DISTRIBUTION
    // =========================
    const categoryDistribution = await sequelize.query(`
      SELECT 
        category,
        SUM(quantity)::INTEGER AS total
      FROM stocks
      WHERE (:isSuper = true OR branch_id = :branchId)
      GROUP BY category
      ORDER BY total DESC
    `, {
      replacements: { isSuper: isSuperUser, branchId }
    });

    res.json({
      success: true,
      dashboard: {
        cards: cards[0][0],
        monthlySpend: monthlySpend[0],
        stockMovement: stockMovement[0],
        purchaseOrderTrends: purchaseOrderTrends[0],
        categoryDistribution: categoryDistribution[0]
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};
exports.getBranchLedger = async (req, res) => {
  try {

    const branchId = req.user.branch_id;

    const data = await Ledger.findAll({
      where: { branch_id: branchId },
      order: [["createdAt", "DESC"]]
    });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


exports.getCompleteDashboard = async (req, res) => {
  try {
    const role = req.user?.role;
    const branchId = req.user?.branch_id;

    const isSuper = role === "super_inventory_manager";

    // ======================
    // DYNAMIC FILTER
    // ======================
    let branchFilter = "";
    let replacements = {};

    if (!isSuper) {
      branchFilter = "WHERE branch_id = :branchId";
      replacements.branchId = branchId;
    }

    // ======================
    // CARDS (STOCK SUMMARY)
    // ======================
    const cards = await sequelize.query(`
      SELECT 
      COALESCE(SUM(value),0)::DECIMAL(12,2) AS "totalStockValue",

      COALESCE(SUM(CASE WHEN status='GOOD' THEN value ELSE 0 END),0)::DECIMAL(12,2) AS "totalGoodStock",

      COALESCE(SUM(CASE WHEN status='REPAIRABLE' THEN value ELSE 0 END),0)::DECIMAL(12,2) AS "repairableStock",

      COALESCE(SUM(CASE WHEN status='DAMAGED' THEN value ELSE 0 END),0)::DECIMAL(12,2) AS "damagedStock"

      FROM stocks
      ${branchFilter}
    `, { replacements });

    // ======================
    // MONTHLY CASHFLOW
    // ======================
    const monthlyCashflow = await sequelize.query(`
      SELECT 
      TO_CHAR(created_at,'Mon') AS month,
      COALESCE(SUM(value),0)::DECIMAL(12,2) AS amount

      FROM stocks
      ${branchFilter}

      GROUP BY month, DATE_PART('month',created_at)
      ORDER BY DATE_PART('month',created_at)
    `, { replacements });

    // ======================
    // CATEGORY DISTRIBUTION
    // ======================
    const categoryDistribution = await sequelize.query(`
      SELECT 
      category,
      SUM(quantity)::INTEGER AS total

      FROM stocks
      ${branchFilter}

      GROUP BY category
      ORDER BY total DESC
    `, { replacements });

    // ======================
    // CLIENT TABLE
    // ======================
    const clients = await sequelize.query(`
      SELECT
      c.id,
      c.client_code AS "clientCode",
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
      ${isSuper ? "" : "AND l.branch_id = :branchId"}

      ${isSuper ? "" : "WHERE c.branch_id = :branchId"}

      GROUP BY c.id
      ORDER BY c."createdAt" DESC
      LIMIT 50
    `, { replacements });

    // ======================
    // STOCK TABLE (OPTIONAL)
    // ======================
    const table = await sequelize.query(`
      SELECT 
      po_number AS "purchaseOrderNo",
      item AS "itemName",
      category AS "categories",
      branch_id AS "branch",
      quantity,
      value,

      CASE
        WHEN aging <= 180 THEN 'Fresh'
        WHEN aging <= 365 THEN 'Normal'
        WHEN aging <= 730 THEN 'Slow'
        ELSE 'Critical'
      END AS status

      FROM stocks
      ${branchFilter}

      ORDER BY created_at DESC
      LIMIT 50
    `, { replacements });

    // ======================
    // FINAL RESPONSE
    // ======================
    res.json({
      success: true,
      dashboard: {
        cards: cards[0][0],
        monthlyCashflow: monthlyCashflow[0],
        categoryDistribution: categoryDistribution[0],
        clients: clients[0],
        table: table[0] // enable if needed
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

//client k hisab s ladger
exports.getClientLedgerByBranch = async (req, res) => {
  try {
    const branchId = req.user.branch_id;
    const clientId = req.params.clientId;

    if (!clientId) {
      return res.status(400).json({ success: false, message: "Client ID is required" });
    }

    const ledgerData = await ClientLedger.findAll({
      where: {
        branch_id: branchId,
        client_id: clientId
      },
      order: [["createdAt", "DESC"]],
      attributes: ["id","invoice_no","type","amount","remark","createdAt"],
      include: [{ model: Client, as: "client", attributes: ["id","name"] }]
    });

    if (ledgerData.length === 0) {
      return res.status(404).json({ success: false, message: "No ledger entries found for this client in your branch" });
    }

    res.json({ success: true, totalEntries: ledgerData.length, data: ledgerData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllStatesDashboard = async (req, res) => {
  try {
    const role = req.user?.role;

    const SUPER_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager",
      "super_sales_manager"
    ];

    const isSuper = SUPER_ROLES.includes(role);

    if (!isSuper) {
      return res.status(403).json({
        success: false,
        message: "❌ Access Denied"
      });
    }

    // =========================
    // STATE SUMMARY (FIXED)
    // =========================
    const statesData = await sequelize.query(`
      SELECT 
        b.state,

        COUNT(DISTINCT b.id) AS "totalBranches",

        COALESCE(SUM(s.quantity),0) AS "totalStock",
        COALESCE(SUM(s.value),0) AS "totalValue",

        -- ✅ FIX: NO type column
        COALESCE(SUM(s.quantity),0) AS "currentStock",

        -- PURCHASE COUNT
        COALESCE(SUM(
          CASE WHEN l.type = 'PURCHASE' THEN 1 ELSE 0 END
        ),0) AS "purchaseCount",

        -- SALES COUNT
        COALESCE(SUM(
          CASE WHEN l.type = 'SALE' THEN 1 ELSE 0 END
        ),0) AS "salesCount"

      FROM branches b
      LEFT JOIN stocks s ON s.branch_id = b.id
      LEFT JOIN ledger l ON l.branch_id = b.id

      GROUP BY b.state
      ORDER BY "totalValue" DESC
    `);

    // =========================
    // 📊 CHART DATA
    // =========================
    const chartData = statesData[0].map((s) => ({
      label: s.state,
      value: Number(s.totalValue)
    }));

    // =========================
    // 🔝 TOP STATES
    // =========================
    const topStates = [...statesData[0]]
      .sort((a, b) => Number(b.totalValue) - Number(a.totalValue))
      .slice(0, 5);

    // =========================
    // 📈 SUMMARY (FIXED)
    // =========================
    const summary = await sequelize.query(`
      SELECT 

      COALESCE(SUM(value),0) AS "totalStockValue",

      -- ✅ FIX
      COALESCE(SUM(quantity),0) AS "currentStock",

      COUNT(*) AS "totalItems"

      FROM stocks
    `);

    return res.json({
      success: true,
      summary: summary[0][0],
      states: statesData[0],
      charts: {
        stateValueChart: chartData
      },
      topStates
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};
exports.getStateDetailsDashboard = async (req, res) => {
  try {
    const role = req.user?.role;

    const SUPER_ROLES = [
    "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager",
      
"super_sales_manager"
    ];

    if (!SUPER_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "❌ Access Denied"
      });
    }

    const { stateName } = req.params;

    // =========================
    // BRANCH SUMMARY (STATE FILTER)
    // =========================
    const branchData = await sequelize.query(`
      SELECT 
        b.id AS "branchId",
        b.name AS "branchName",

        COUNT(DISTINCT b.id) AS "totalBranches",

        -- STOCK TABLE
        COALESCE(SUM(s.quantity),0) AS "totalStock",
        COALESCE(SUM(s.value),0) AS "totalValue",

        -- CURRENT STOCK (simple)
        COALESCE(SUM(s.quantity),0) AS "currentStock",

        -- =========================
        -- ✅ STOCK IN (PURCHASE)
        -- =========================
        COALESCE(SUM(
          CASE 
            WHEN l.type = 'PURCHASE' THEN l.quantity
            ELSE 0
          END
        ),0) AS "stockIn",

        -- =========================
        -- ❌ STOCK OUT (SALE)
        -- =========================
        COALESCE(SUM(
          CASE 
            WHEN l.type = 'SALE' THEN l.quantity
            ELSE 0
          END
        ),0) AS "stockOut",

        -- COUNTS
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

      GROUP BY b.id
      ORDER BY "totalValue" DESC
    `, {
      replacements: { stateName }
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
    // 📈 SUMMARY (STATE LEVEL)
    // =========================
    const summary = await sequelize.query(`
      SELECT 
        COALESCE(SUM(s.value),0) AS "totalStockValue",
        COALESCE(SUM(s.quantity),0) AS "currentStock",
        COUNT(s.id) AS "totalItems",

        -- STATE LEVEL IN
        COALESCE(SUM(
          CASE WHEN l.type = 'PURCHASE' THEN l.quantity ELSE 0 END
        ),0) AS "stockIn",

        -- STATE LEVEL OUT
        COALESCE(SUM(
          CASE WHEN l.type = 'SALE' THEN l.quantity ELSE 0 END
        ),0) AS "stockOut"

      FROM branches b
      LEFT JOIN stocks s ON s.branch_id = b.id
      LEFT JOIN ledger l ON l.branch_id = b.id

      WHERE b.state = :stateName
    `, {
      replacements: { stateName }
    });

    // =========================
    // FINAL RESPONSE
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
exports.getBranchDetailsDashboard = async (req, res) => {
  try {
    const user = req.user;

    const SUPER_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager",
      "super_sales_manager"
    ];

    const role = user?.role?.toLowerCase().trim();
    const isSuper = SUPER_ROLES.includes(role);

    const requestedBranchId = parseInt(req.params.branchId, 10);

    if (Number.isNaN(requestedBranchId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid branchId"
      });
    }

 
    let finalBranchId;

    if (isSuper) {
      finalBranchId = requestedBranchId;
    } else {
      finalBranchId = user.branch_id;

      if (requestedBranchId !== user.branch_id) {
        return res.status(403).json({
          success: false,
          message: "Access Denied - You can only view your branch"
        });
      }
    }


    const branchInfo = await Branch.findByPk(finalBranchId, {
      attributes: ["id", "name", "state"]
    });

    if (!branchInfo) {
      return res.status(404).json({
        success: false,
        message: "Branch not found"
      });
    }

    // =========================
    // PARALLEL QUERIES
    // =========================
    const [
      summary,
      stockMovement,
      categoryDistribution,
      monthlyData,
      clients,
      allItems
    ] = await Promise.all([

      // STOCK SUMMARY
      sequelize.query(`
        SELECT 
          COALESCE(SUM(value),0) AS "totalStockValue",
          COALESCE(SUM(quantity),0) AS "currentStock",
          COUNT(id) AS "totalItems"
        FROM stocks
        WHERE branch_id = :branchId
      `, {
        replacements: { branchId: finalBranchId },
        type: sequelize.QueryTypes.SELECT
      }),

      // STOCK MOVEMENT
      sequelize.query(`
        SELECT
          COALESCE(SUM(
            CASE WHEN type IN ('PURCHASE','TRANSFER_IN') THEN quantity ELSE 0 END
          ),0) AS "stockIn",

          COALESCE(SUM(
            CASE WHEN type IN ('SALE','TRANSFER_OUT','DAMAGE') THEN quantity ELSE 0 END
          ),0) AS "stockOut",

          COALESCE(SUM(
            CASE WHEN type = 'PURCHASE' THEN quantity ELSE 0 END
          ),0) AS "purchaseStockQty",

          COALESCE(SUM(
            CASE WHEN type = 'PURCHASE' THEN total ELSE 0 END
          ),0) AS "purchaseStockValue",

          COALESCE(SUM(
            CASE WHEN type = 'SALE' THEN quantity ELSE 0 END
          ),0) AS "salesStockQty",

          COALESCE(SUM(
            CASE WHEN type = 'SALE' THEN total ELSE 0 END
          ),0) AS "salesStockValue"
        FROM ledger
        WHERE branch_id = :branchId
      `, {
        replacements: { branchId: finalBranchId },
        type: sequelize.QueryTypes.SELECT
      }),

      // CATEGORY DISTRIBUTION
      sequelize.query(`
        SELECT 
          category,
          SUM(quantity) AS total
        FROM stocks
        WHERE branch_id = :branchId
        GROUP BY category
        ORDER BY total DESC
      `, {
        replacements: { branchId: finalBranchId },
        type: sequelize.QueryTypes.SELECT
      }),

      // MONTHLY TREND
      sequelize.query(`
        SELECT 
          TO_CHAR(created_at,'Mon') AS month,
          COALESCE(SUM(value),0) AS amount
        FROM stocks
        WHERE branch_id = :branchId
        GROUP BY month, DATE_PART('month',created_at)
        ORDER BY DATE_PART('month',created_at)
      `, {
        replacements: { branchId: finalBranchId },
        type: sequelize.QueryTypes.SELECT
      }),

      // CLIENT DATA
      sequelize.query(`
        SELECT
          c.id AS "clientId",
          c.name AS "clientName",
          c.phone,

          COALESCE(SUM(
            CASE WHEN l.type='SALE' THEN l.total ELSE 0 END
          ),0) AS "totalSales",

          COALESCE(SUM(
            CASE WHEN cl.type='PAYMENT' THEN cl.amount ELSE 0 END
          ),0) AS "totalPayment",

          COALESCE(
            SUM(CASE WHEN l.type='SALE' THEN l.total ELSE 0 END) -
            SUM(CASE WHEN cl.type='PAYMENT' THEN cl.amount ELSE 0 END)
          ,0) AS "pendingAmount"

        FROM clients c
        LEFT JOIN ledger l
          ON l.branch_id = c.branch_id
        LEFT JOIN client_ledger cl
          ON cl.client_id = c.id
        WHERE c.branch_id = :branchId
        GROUP BY c.id
        ORDER BY "totalSales" DESC
        LIMIT 10
      `, {
        replacements: { branchId: finalBranchId },
        type: sequelize.QueryTypes.SELECT
      }),

      // ALL ITEMS
      sequelize.query(`
        SELECT 
          item,
          SUM(quantity) AS "totalQty",
          SUM(value) AS "totalValue"
        FROM stocks
        WHERE branch_id = :branchId
        GROUP BY item
        ORDER BY "totalValue" DESC
      `, {
        replacements: { branchId: finalBranchId },
        type: sequelize.QueryTypes.SELECT
      })
    ]);

    return res.json({
      success: true,

      // ✅ branch id alag se bhi bhej diya
      branchId: finalBranchId,
      branch_id: finalBranchId,

      // ✅ full branch object
      branch: {
        id: branchInfo.id,
        name: branchInfo.name,
        state: branchInfo.state
      },

      summary: {
        ...summary[0],
        stockIn: stockMovement[0]?.stockIn || 0,
        stockOut: stockMovement[0]?.stockOut || 0,
        purchaseStockQty: stockMovement[0]?.purchaseStockQty || 0,
        purchaseStockValue: stockMovement[0]?.purchaseStockValue || 0,
        salesStockQty: stockMovement[0]?.salesStockQty || 0,
        salesStockValue: stockMovement[0]?.salesStockValue || 0
      },

      charts: {
        categoryDistribution,
        monthlyTrend: monthlyData
      },

      clients,
      allItems
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};



exports.getItemFullDetails = async (req, res) => {
  try {
    const user = req.user;

    const SUPER_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager",
      "admin","super_sales_manager"
    ];

    const role = user?.role?.toLowerCase().trim();
    const isSuperUser = SUPER_ROLES.includes(role);

    if (!role) {
      return res.status(403).json({
        success: false,
        message: "Invalid Role"
      });
    }

    let { branchId, itemName } = req.params;

    // 🔥 normalize branch IDs
    const userBranches = (user.branches || []).map(b => Number(b));
    const requestedBranchId = Number(branchId);

    // 🔐 branch access control
    if (!isSuperUser) {
      if (!userBranches.includes(requestedBranchId)) {
        return res.status(403).json({
          success: false,
          message: "You can only access your own branch data"
        });
      }
    }

    // =========================
    // BASIC STATS
    // =========================
    const [stats] = await Promise.all([
      sequelize.query(`
        SELECT 
          COALESCE(SUM(quantity),0) AS "totalStock",
          COALESCE(SUM(value),0) AS "totalValue",
          COUNT(id) AS "entries"
        FROM stocks
        WHERE branch_id = :branchId
        AND item = :itemName
      `, { replacements: { branchId: requestedBranchId, itemName } })
    ]);

    // =========================
    // STOCK MOVEMENT
    // =========================
    const [movement] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(
          CASE WHEN type IN ('PURCHASE','TRANSFER_IN') THEN quantity ELSE 0 END
        ),0) AS "stockIn",

        COALESCE(SUM(
          CASE WHEN type IN ('SALE','TRANSFER_OUT','DAMAGE') THEN quantity ELSE 0 END
        ),0) AS "stockOut",

        COALESCE(SUM(
          CASE WHEN type='PURCHASE' THEN quantity ELSE 0 END
        ),0) AS "purchaseQty",

        COALESCE(SUM(
          CASE WHEN type='PURCHASE' THEN total ELSE 0 END
        ),0) AS "purchaseValue",

        COALESCE(SUM(
          CASE WHEN type='SALE' THEN quantity ELSE 0 END
        ),0) AS "salesQty",

        COALESCE(SUM(
          CASE WHEN type='SALE' THEN total ELSE 0 END
        ),0) AS "salesValue"

      FROM ledger
      WHERE branch_id = :branchId
    `, { replacements: { branchId: requestedBranchId } });

    // =========================
    // AGING CHART
    // =========================
    const agingChart = await sequelize.query(`
      SELECT 
        aging,
        SUM(quantity) AS qty
      FROM stocks
      WHERE branch_id = :branchId
      AND item = :itemName
      GROUP BY aging
      ORDER BY aging ASC
    `, { replacements: { branchId: requestedBranchId, itemName } });

    // =========================
    // STATUS CHART
    // =========================
    const statusChart = await sequelize.query(`
      SELECT 
        status,
        SUM(quantity) AS qty
      FROM stocks
      WHERE branch_id = :branchId
      AND item = :itemName
      GROUP BY status
    `, { replacements: { branchId: requestedBranchId, itemName } });

    // =========================
    // MONTHLY TREND
    // =========================
    const monthlyTrend = await sequelize.query(`
      SELECT 
        TO_CHAR(created_at,'YYYY-MM') AS month,
        SUM(quantity) AS qty,
        SUM(value) AS value
      FROM stocks
      WHERE branch_id = :branchId
      AND item = :itemName
      GROUP BY month
      ORDER BY month ASC
    `, { replacements: { branchId: requestedBranchId, itemName } });

    // =========================
    // TOP BATCH / GRN
    // =========================
    const batchData = await sequelize.query(`
      SELECT 
        batch_no,
        SUM(quantity) AS qty,
        SUM(value) AS value
      FROM stocks
      WHERE branch_id = :branchId
      AND item = :itemName
      GROUP BY batch_no
      ORDER BY value DESC
      LIMIT 5
    `, { replacements: { branchId: requestedBranchId, itemName } });

    // =========================
    // FINAL RESPONSE
    // =========================
    return res.json({
      success: true,
      item: itemName,
      branchId: requestedBranchId,

      stats: {
        ...stats[0][0],
        stockIn: movement[0].stockIn,
        stockOut: movement[0].stockOut,
        purchaseQty: movement[0].purchaseQty,
        purchaseValue: movement[0].purchaseValue,
        salesQty: movement[0].salesQty,
        salesValue: movement[0].salesValue
      },

      charts: {
        agingChart: agingChart[0],
        statusChart: statusChart[0],
        monthlyTrend: monthlyTrend[0]
      },

      batches: batchData[0]
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};
exports.getCityBranchDashboard = async (req, res) => {
  try {
    const user = req.user;

    const SUPER_ROLES = [
      "super_stock_manager",
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager",
      "admin","super_sales_manager"
    ];

    const role = user?.role?.toLowerCase().trim();

    if (!SUPER_ROLES.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "Access Denied"
      });
    }

    const { stateName, cityName } = req.params;

    // =========================
    // BRANCH DATA (CITY FILTER)
    // =========================
    const branchData = await sequelize.query(`
      SELECT 
        b.id AS "branchId",
        b.name AS "branchName",

        COALESCE(SUM(s.quantity),0) AS "totalStock",
        COALESCE(SUM(s.value),0) AS "totalValue",

        COALESCE(SUM(s.quantity),0) AS "currentStock",

        -- STOCK IN
        COALESCE(SUM(
          CASE WHEN l.type IN ('PURCHASE','TRANSFER_IN') THEN l.quantity ELSE 0 END
        ),0) AS "stockIn",

        -- STOCK OUT
        COALESCE(SUM(
          CASE WHEN l.type IN ('SALE','TRANSFER_OUT','DAMAGE') THEN l.quantity ELSE 0 END
        ),0) AS "stockOut",

        -- PURCHASE
        COALESCE(SUM(
          CASE WHEN l.type = 'PURCHASE' THEN l.quantity ELSE 0 END
        ),0) AS "purchaseQty",

        COALESCE(SUM(
          CASE WHEN l.type = 'PURCHASE' THEN l.total ELSE 0 END
        ),0) AS "purchaseValue",

        -- SALES
        COALESCE(SUM(
          CASE WHEN l.type = 'SALE' THEN l.quantity ELSE 0 END
        ),0) AS "salesQty",

        COALESCE(SUM(
          CASE WHEN l.type = 'SALE' THEN l.total ELSE 0 END
        ),0) AS "salesValue"

      FROM branches b
      LEFT JOIN stocks s ON s.branch_id = b.id
      LEFT JOIN ledger l ON l.branch_id = b.id

      WHERE b.state = :stateName
      AND b.city = :cityName

      GROUP BY b.id
      ORDER BY "totalValue" DESC
    `, {
      replacements: { stateName, cityName }
    });

    // =========================
    // SUMMARY (CITY LEVEL)
    // =========================
    const summary = await sequelize.query(`
      SELECT 
        COALESCE(SUM(s.value),0) AS "totalStockValue",
        COALESCE(SUM(s.quantity),0) AS "currentStock",
        COUNT(s.id) AS "totalItems",

        COALESCE(SUM(
          CASE WHEN l.type IN ('PURCHASE','TRANSFER_IN') THEN l.quantity ELSE 0 END
        ),0) AS "stockIn",

        COALESCE(SUM(
          CASE WHEN l.type IN ('SALE','TRANSFER_OUT','DAMAGE') THEN l.quantity ELSE 0 END
        ),0) AS "stockOut"

      FROM branches b
      LEFT JOIN stocks s ON s.branch_id = b.id
      LEFT JOIN ledger l ON l.branch_id = b.id

      WHERE b.state = :stateName
      AND b.city = :cityName
    `, {
      replacements: { stateName, cityName }
    });

    // =========================
    // CHART DATA
    // =========================
    const chartData = branchData[0].map(b => ({
      label: b.branchName,
      value: Number(b.totalValue)
    }));

    // =========================
    // FINAL RESPONSE
    // =========================
    return res.json({
      success: true,
      state: stateName,
      city: cityName,

      summary: summary[0][0],

      branches: branchData[0],

      charts: {
        branchValueChart: chartData
      }
    });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};