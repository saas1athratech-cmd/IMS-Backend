const { QueryTypes, Op } = require("sequelize");
const XLSX = require("xlsx");
const sequelize = require("../../../config/sqlcon");
const Stock = require("../../../model/SQL_Model/stock.record")
const StockMovement = require("../../../model/SQL_Model/stockmovement");
const { Branch, Ledger} = require("../../../model/SQL_Model");
const { ClientLedger, Client } = require("../../../model/SQL_Model");
const { InventoryBatch } = require("../../../model/SQL_Model");
const createBatch = require("../../../service.sql/helpers/createBatch");
// const Stock = require("../../../model/SQL_Model/stock.record");
// ============================
// INVENTORY DASHBOARD
// ============================
// exports.getInventoryDashboard = async (req, res) => {
//   try {
//     const user = req.user;

//     const roleName = String(user?.role?.name || user?.role || "")
//       .trim()
//       .toLowerCase();

//     const branchId = Number(user?.branch_id);

//     if (roleName !== "inventory_manager") {
//       return res.status(403).json({
//         success: false,
//         message: "Only inventory_manager allowed"
//       });
//     }

//     if (!branchId) {
//       return res.status(403).json({
//         success: false,
//         message: "No branch assigned to inventory manager"
//       });
//     }

//     const replacements = { branchId };

//     const purchaseRows = await sequelize.query(
//       `
//       SELECT
//         COALESCE(SUM(l.total), 0)::DECIMAL(12,2) AS "purchaseAmount"
//       FROM ledger l
//       WHERE l.branch_id = :branchId
//       AND TRIM(UPPER(l.type)) = 'PURCHASE'
//       `,
//       { replacements, type: QueryTypes.SELECT }
//     );

//     const purchaseAmount = Number(purchaseRows?.[0]?.purchaseAmount || 0);

//     const cardsRows = await sequelize.query(
//       `
//       SELECT
//         COALESCE(COUNT(s.id), 0)::INTEGER AS "totalStockItems",
//         COALESCE(SUM(s.value), 0)::DECIMAL(12,2) AS "totalStockValue",
//         0::INTEGER AS "transitItems"
//       FROM stocks s
//       WHERE s.branch_id = :branchId
//       `,
//       { replacements, type: QueryTypes.SELECT }
//     );

//     const cards = cardsRows[0] || {
//       totalStockItems: 0,
//       totalStockValue: "0.00",
//       transitItems: 0
//     };

//     cards.purchaseAmount = purchaseAmount;

//     const purchaseChart = await sequelize.query(
//       `
//       SELECT
//         TO_CHAR(l.created_at, 'Mon') AS month,
//         DATE_PART('month', l.created_at) AS month_no,
//         COALESCE(SUM(l.total), 0)::DECIMAL(12,2) AS amount
//       FROM ledger l
//       WHERE l.branch_id = :branchId
//       AND TRIM(UPPER(l.type)) = 'PURCHASE'
//       GROUP BY TO_CHAR(l.created_at, 'Mon'), DATE_PART('month', l.created_at)
//       ORDER BY month_no
//       `,
//       { replacements, type: QueryTypes.SELECT }
//     );

//     const agingRows = await sequelize.query(
//       `
//       SELECT
//         COALESCE(SUM(CASE WHEN s.status = 'GOOD' THEN s.quantity ELSE 0 END), 0)::INTEGER AS available,
//         COALESCE(SUM(CASE WHEN s.status = 'DAMAGED' THEN s.quantity ELSE 0 END), 0)::INTEGER AS damaged,
//         COALESCE(SUM(CASE WHEN s.status = 'REPAIRABLE' THEN s.quantity ELSE 0 END), 0)::INTEGER AS repairable
//       FROM stocks s
//       WHERE s.branch_id = :branchId
//       `,
//       { replacements, type: QueryTypes.SELECT }
//     );

//     const agingChart = agingRows[0] || {
//       available: 0,
//       damaged: 0,
//       repairable: 0
//     };

//     const inventoryTable = await sequelize.query(
//       `
//       SELECT
//         s.item AS "itemName",
//         s.category AS "categories",
//         s.hsn AS "hsnCode",
//         s.grn AS "grnNo",
//         COALESCE(s.po_number, 'N/A') AS "poNumber",
//         COALESCE(s.quantity, 0)::INTEGER AS "currentStock",

//         COALESCE((
//           SELECT SUM(l.quantity)
//           FROM ledger l
//           WHERE l.stock_id = s.id
//           AND l.branch_id = :branchId
//           AND TRIM(UPPER(l.type)) = 'PURCHASE'
//         ), 0)::INTEGER AS "stockIn",

//         COALESCE((
//           SELECT SUM(l.quantity)
//           FROM ledger l
//           WHERE l.stock_id = s.id
//           AND l.branch_id = :branchId
//           AND TRIM(UPPER(l.type)) = 'SALE'
//         ), 0)::INTEGER AS "stockOut",

//         COALESCE((
//           SELECT SUM(l.quantity)
//           FROM ledger l
//           WHERE l.stock_id = s.id
//           AND l.branch_id = :branchId
//           AND TRIM(UPPER(l.type)) IN ('DAMAGE', 'DAMAGED', 'SCRAP')
//         ), 0)::INTEGER AS "scrap",

//         s.created_at AS "dispatchDate",
//         s.updated_at AS "deliveryDate",
//         s.status AS "status"

//       FROM stocks s
//       WHERE s.branch_id = :branchId
//       ORDER BY s.created_at DESC
//       LIMIT 100
//       `,
//       { replacements, type: QueryTypes.SELECT }
//     );

//     return res.status(200).json({
//       success: true,
//       role: "BRANCH",
//       dashboard: {
//         cards,
//         purchaseChart,
//         agingChart,
//         inventoryTable
//       }
//     });

//   } catch (error) {
//     console.error("getInventoryDashboard error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Error fetching inventory data",
//       error: error.message
//     });
//   }
// };
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

    // =====================================
    // PURCHASE AMOUNT OVER TIME
    // USING STOCK MOVEMENTS (IN)
    // =====================================
    const purchaseChart = await sequelize.query(
      `
      SELECT 

        TO_CHAR(
          sm.created_at,
          'Mon'
        ) AS month,

        DATE_PART(
          'month',
          sm.created_at
        ) AS month_no,

        COALESCE(
          SUM(
            sm.quantity * COALESCE(s.rate, 0)
          ),
          0
        ) AS "purchaseAmount"

      FROM stock_movements sm

      JOIN stocks s
      ON s.id = sm.stock_id

      WHERE sm.type = 'IN'

      AND s.branch_id = ANY(:branches)

      GROUP BY month, month_no

      ORDER BY month_no
      `,
      {
        replacements: {
          branches: userBranches
        },

        type: QueryTypes.SELECT
      }
    );

    // =====================================
    // STOCK STATUS OVERVIEW
    // =====================================
    const stockStatus = await Stock.findAll({

      where: {
        branch_id: {
          [Op.in]: userBranches
        }
      },

      attributes: [

        "status",

        [
          sequelize.fn(
            "SUM",
            sequelize.col("quantity")
          ),
          "total"
        ]

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

      if (item.status === "GOOD") {
        formattedStatus.available =
          Number(item.total);
      }

      if (item.status === "DAMAGED") {
        formattedStatus.damaged =
          Number(item.total);
      }

      if (item.status === "REPAIRABLE") {
        formattedStatus.repairable =
          Number(item.total);
      }

    });

    // =====================================
    // INVENTORY ITEMS
    // =====================================
    const inventoryItems = await Stock.findAll({

      where: {
        branch_id: {
          [Op.in]: userBranches
        }
      },

      order: [
        ["created_at", "DESC"]
      ],

      raw: true

    });

    // =====================================
    // FORMATTED ITEMS
    // =====================================
    const formattedItems = inventoryItems.map(item => ({

      id: item.id,

      name: item.item,

      itemDescription:
        item.item_description || null,

      itemCode:
        item.item_code || null,

      sku:
        item.sku || null,

      category:
        item.category || null,

      subCategory:
        item.sub_category || null,

      brand:
        item.brand || null,

      type:
        item.type || null,

      size:
        item.size || null,

      color:
        item.color || null,

      bundleSize:
        item.bundle_size || null,

      specification:
        item.specification || {},

      unit:
        item.unit || null,

      quantity:
        Number(item.quantity || 0),

      rate:
        Number(item.rate || 0),

      value:
        Number(item.value || 0),

      gstPercent:
        Number(item.gst_percent || 0),

      hsn:
        item.hsn || null,

      grn:
        item.grn || null,

      batchNo:
        item.batch_no || null,

      poNumber:
        item.po_number || null,

      rackNo:
        item.rack_no || null,

      location:
        item.location || null,

      aging:
        Number(item.aging || 0),

      status:
        item.status || null,

      minStockLevel:
        Number(item.min_stock_level || 0),

      ownerId:
        item.owner_id || null,

      branchId:
        item.branch_id || null,

      createdAt:
        item.created_at || null,

      updatedAt:
        item.updated_at || null

    }));

    // =====================================
    // RESPONSE
    // =====================================
    res.json({

      success: true,

      charts: {

        purchaseAmountOverTime:
          purchaseChart.map(i => ({

            month: i.month,

            purchaseAmount:
              Number(i.purchaseAmount)

          })),

        stockStatusOverview:
          formattedStatus

      },

      inventoryItems:
        formattedItems

    });

  } catch (error) {

    console.error(error);

    res.status(500).json({

      success: false,

      message:
        "Failed to fetch dashboard charts"

    });

  }
};


exports.addStockItem = async (req, res) => {

  const transaction =
    await sequelize.transaction();

  try {

    const {
      item,
      category,
      quantity,
      rate,

      hsn,
      grn,
      batch_no,
      aging,
      status,
      po_number,

      sku,
      sub_category,
      brand,
      type,
      size,
      color,
      bundle_size,
      unit,

      model_no,
      serial_no,

      item_description,
      item_code,

      specification,

      gst_percent,

      rack_no,
      location,

      min_stock_level,

      expiry_date,
      warranty_months,
    } = req.body;

    // ===============================
    // VALIDATION
    // ===============================

    if (!item) {

      await transaction.rollback();

      return res.status(400).json({
        success: false,
        message: "Item is required",
      });

    }

    // ===============================
    // CALCULATIONS
    // ===============================

    const finalQuantity =
      Number(quantity || 0);

    const finalRate =
      Number(rate || 0);

    const finalValue =
      finalQuantity * finalRate;

    const finalBundleSize =
      bundle_size || 1;

    // ===============================
    // AUTO ITEM DESCRIPTION
    // ===============================

    const autoItemDescription =
      `${brand || ""} ${type || ""} ${item || ""} ${size || ""} ${bundle_size ? `(${bundle_size})` : ""} ${color || ""}`
        .replace(/\s+/g, " ")
        .trim();

    // ===============================
    // FIND EXISTING STOCK
    // ===============================

    const existingStock =
      await Stock.findOne({
        where: {
          item,
          branch_id:
            req.user.branch_id,

          size: size || null,

          type: type || null,
        },

        transaction,
      });

    // =====================================================
    // EXISTING STOCK FLOW
    // =====================================================

    if (existingStock) {

      // ==========================================
      // UPDATE STOCK QTY
      // ==========================================

      existingStock.quantity =
        Number(existingStock.quantity) +
        finalQuantity;

      existingStock.rate =
        finalRate ||
        existingStock.rate;

      existingStock.value =
        Number(existingStock.quantity) *
        Number(existingStock.rate);

      // ==========================================
      // AUTO DESCRIPTION UPDATE
      // ==========================================

      existingStock.item_description =
        existingStock.item_description ||
        autoItemDescription;

      await existingStock.save({
        transaction,
      });

      // ==========================================
      // STOCK MOVEMENT
      // ==========================================

      await StockMovement.create(
        {
          stock_id:
            existingStock.id,

          branch_id:
            req.user.branch_id,

          type: "IN",

          quantity:
            finalQuantity,
        },
        { transaction }
      );

      // ==========================================
      // CHECK BATCH EXISTS
      // ==========================================

      const existingBatch =
        await InventoryBatch.findOne({
          where: {
            batch_no,
            stock_id:
              existingStock.id,
          },

          transaction,
        });

      // ==========================================
      // SAME BATCH → UPDATE BATCH QTY
      // ==========================================

      if (existingBatch) {

        existingBatch.total_bundle =
          Number(existingBatch.total_bundle) +
          finalQuantity;

        existingBatch.available_bundle =
          Number(existingBatch.available_bundle) +
          finalQuantity;

        await existingBatch.save({
          transaction,
        });

      }

      // ==========================================
      // NEW BATCH → CREATE NEW BATCH
      // ==========================================

      else {

        const year =
          new Date().getFullYear();

        const lastBatch =
          await InventoryBatch.findOne({
            order: [["id", "DESC"]],
            transaction,
          });

        const nextId =
          lastBatch
            ? lastBatch.id + 1
            : 1;

        const autoBatchNo =
          `BAT-${year}-${String(nextId).padStart(
            5,
            "0"
          )}`;

        await createBatch({

          batch_no:
            batch_no || autoBatchNo,

          stock_id:
            existingStock.id,

          parent_batch_id:
            null,

          branch_id:
            req.user.branch_id,

          total_bundle:
            finalQuantity,

          available_bundle:
            finalQuantity,

          bundle_size:
            finalBundleSize,

          item_name:
            item,

          status:
            "ACTIVE",

          transaction,
        });

      }

      await transaction.commit();

      return res.status(200).json({
        success: true,

        message:
          existingBatch
            ? "Existing stock and batch updated successfully"
            : "Existing stock updated and new batch created successfully",

        data: existingStock,
      });

    }

    // =====================================================
    // NEW STOCK FLOW
    // =====================================================

    const newItem =
      await Stock.create(
        {
          item,

          category:
            category || null,

          quantity:
            finalQuantity,

          rate:
            finalRate,

          value:
            finalValue,

          hsn:
            hsn || null,

          grn:
            grn || null,

          batch_no:
            batch_no || null,

          aging:
            aging ?? 0,

          status:
            status || "GOOD",

          po_number:
            po_number || "N/A",

          owner_id:
            req.user.id,

          branch_id:
            req.user.branch_id,

          sku:
            sku || null,

          sub_category:
            sub_category || null,

          brand:
            brand || null,

          type:
            type || null,

          size:
            size || null,

          color:
            color || null,

          bundle_size:
            finalBundleSize,

          unit:
            unit || "PCS",

          model_no:
            model_no || null,

          serial_no:
            serial_no || null,

          // ==========================================
          // AUTO ITEM DESCRIPTION
          // ==========================================

          item_description:
            item_description ||
            autoItemDescription,

          item_code:
            item_code || null,

          specification:
            specification ?? null,

          gst_percent:
            gst_percent ?? null,

          rack_no:
            rack_no || null,

          location:
            location || null,

          min_stock_level:
            min_stock_level ?? 0,

          expiry_date:
            expiry_date || null,

          warranty_months:
            warranty_months ?? 0,
        },

        { transaction }
      );

    // ==========================================
    // STOCK MOVEMENT
    // ==========================================

    await StockMovement.create(
      {
        stock_id:
          newItem.id,

        branch_id:
          req.user.branch_id,

        type:
          "IN",

        quantity:
          finalQuantity,
      },
      { transaction }
    );

    // ==========================================
    // AUTO BATCH NO
    // ==========================================

    const year =
      new Date().getFullYear();

    const lastBatch =
      await InventoryBatch.findOne({
        order: [["id", "DESC"]],
        transaction,
      });

    const nextId =
      lastBatch
        ? lastBatch.id + 1
        : 1;

    const autoBatchNo =
      `BAT-${year}-${String(nextId).padStart(
        5,
        "0"
      )}`;

    // ==========================================
    // CREATE BATCH
    // ==========================================

    await createBatch({

      batch_no:
        batch_no || autoBatchNo,

      stock_id:
        newItem.id,

      parent_batch_id:
        null,

      branch_id:
        req.user.branch_id,

      total_bundle:
        finalQuantity,

      available_bundle:
        finalQuantity,

      bundle_size:
        finalBundleSize,

      item_name:
        item,

      status:
        "ACTIVE",

      transaction,
    });

    // ==========================================
    // COMMIT
    // ==========================================

    await transaction.commit();

    return res.status(201).json({
      success: true,

      message:
        "Stock item added successfully",

      data:
        newItem,
    });

  } catch (err) {

    if (
      transaction &&
      !transaction.finished
    ) {

      await transaction.rollback();

    }

    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });

  }
};

exports.bulkUploadStock = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    let data = [];

    // ✅ Excel / CSV Upload
    if (req.file) {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      data = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    }

    // ✅ JSON Upload
    if (req.body.data) {
      data = typeof req.body.data === "string"
        ? JSON.parse(req.body.data)
        : req.body.data;
    }

    if (!data || data.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No data found in file"
      });
    }

    const formattedData = data
      .map((row) => {
        const item =
          row.item ||
          row.Item ||
          row["Item Name"] ||
          row["item name"];

        const category =
          row.category ||
          row.Category ||
          row.Categories ||
          row["Categories"] ||
          null;

        const hsn =
          row.hsn ||
          row.HSN ||
          row["HSN Code"] ||
          row["hsn code"] ||
          null;

        const grn =
          row.grn ||
          row.GRN ||
          row["GRN No."] ||
          row["GRN No"] ||
          null;

        const po_number =
          row.po_number ||
          row.purchaseOrder ||
          row["Purchase Order No."] ||
          row["Purchase Order No"] ||
          "N/A";

        const quantity = Number(
          row.quantity ||
          row.Quantity ||
          row["Current Stock"] ||
          row["Stock IN"] ||
          0
        );

        const rate = Number(
          row.rate ||
          row.Rate ||
          row["Purchase Rate"] ||
          0
        );

        if (!item || isNaN(quantity) || quantity <= 0 || isNaN(rate)) {
          return null;
        }

        return {
          item: String(item).trim(),
          category,
          hsn,
          grn,
          po_number,
          quantity,
          rate,
          value: quantity * rate,

          // ✅ DB default GOOD bhi chalega, but safe rakha hai
          status: "GOOD",

          branch_id: req.user.branch_id,
          owner_id: req.user.id
        };
      })
      .filter(Boolean);

    if (formattedData.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "All rows are invalid. Check your Excel/CSV format."
      });
    }

    // ✅ Stock Insert
    const insertedStocks = await Stock.bulkCreate(formattedData, {
      transaction,
      returning: true
    });

    // ✅ StockMovement Insert
    const stockMovements = insertedStocks.map((stock) => ({
      stock_id: stock.id,
      branch_id: stock.branch_id,
      type: "IN",
      quantity: stock.quantity,
      note: "Bulk stock upload"
    }));

    await StockMovement.bulkCreate(stockMovements, {
      transaction
    });

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Stock uploaded successfully",
      count: insertedStocks.length,
      data: insertedStocks
    });

  } catch (err) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    console.error("Bulk Upload Error:", err);

    return res.status(500).json({
      success: false,
      message: "Bulk upload failed",
      error: err.message
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

    const role =
      user?.role?.name || user?.role;

    const branches =
      user?.branches || [];

    const branchId =
      user?.branch_id;

    const isSuperUser =
      role === "super_admin" ||
      role === "super_inventory_manager" ||
      branches.includes("ALL");

    const branchIds = branches
      .filter((b) => b !== "ALL")
      .map(Number)
      .filter(Boolean);

    const replacements = {};

    let stockWhere = "";

    if (!isSuperUser) {

      if (branchId) {

        replacements.branchId =
          Number(branchId);

        stockWhere =
          "WHERE s.branch_id = :branchId";

      } else if (branchIds.length) {

        replacements.branchIds =
          branchIds;

        stockWhere =
          "WHERE s.branch_id = ANY(:branchIds)";

      } else {

        return res.status(403).json({
          success: false,
          message: "No branch access"
        });

      }

    }

    // =====================================
    // PURCHASE AMOUNT
    // =====================================
    const purchaseRows =
      await sequelize.query(
        `
        SELECT

          COALESCE(
            SUM(
              sm.quantity * COALESCE(s.rate,0)
            ),
            0
          )::DECIMAL(12,2) AS "purchaseAmount"

        FROM stock_movements sm

        JOIN stocks s
        ON s.id = sm.stock_id

        ${stockWhere}

        ${stockWhere ? "AND" : "WHERE"}

        sm.type = 'IN'
        `,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

    const purchaseAmount =
      Number(
        purchaseRows?.[0]?.purchaseAmount || 0
      );

    // =====================================
    // CARDS
    // =====================================
    const cardsRows =
      await sequelize.query(
        `
        SELECT

          COALESCE(
            COUNT(s.id),
            0
          )::INTEGER AS "totalStockItems",

          COALESCE(
            SUM(s.value),
            0
          )::DECIMAL(12,2) AS "totalStockValue",

          COALESCE(
            SUM(
              CASE
                WHEN s.status::text = 'TRANSIT'
                THEN s.quantity
                ELSE 0
              END
            ),
            0
          )::INTEGER AS "transitItems"

        FROM stocks s

        ${stockWhere}
        `,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

    const cards =
      cardsRows[0] || {

        totalStockItems: 0,

        totalStockValue: "0.00",

        transitItems: 0

      };

    cards.purchaseAmount =
      purchaseAmount;

    // =====================================
    // PURCHASE CHART
    // =====================================
    const purchaseChart =
      await sequelize.query(
        `
        SELECT

          TO_CHAR(
            sm.created_at,
            'Mon'
          ) AS month,

          DATE_PART(
            'month',
            sm.created_at
          ) AS month_no,

          COALESCE(
            SUM(
              sm.quantity * COALESCE(s.rate,0)
            ),
            0
          )::DECIMAL(12,2) AS amount

        FROM stock_movements sm

        JOIN stocks s
        ON s.id = sm.stock_id

        ${stockWhere}

        ${stockWhere ? "AND" : "WHERE"}

        sm.type = 'IN'

        GROUP BY
          TO_CHAR(sm.created_at, 'Mon'),
          DATE_PART('month', sm.created_at)

        ORDER BY month_no
        `,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

    // =====================================
    // AGING / STATUS CHART
    // =====================================
    const agingRows =
      await sequelize.query(
        `
        SELECT

          COALESCE(
            SUM(
              CASE
                WHEN s.status::text = 'GOOD'
                THEN s.quantity
                ELSE 0
              END
            ),
            0
          )::INTEGER AS available,

          COALESCE(
            SUM(
              CASE
                WHEN s.status::text = 'DAMAGED'
                THEN s.quantity
                ELSE 0
              END
            ),
            0
          )::INTEGER AS damaged,

          COALESCE(
            SUM(
              CASE
                WHEN s.status::text = 'REPAIRABLE'
                THEN s.quantity
                ELSE 0
              END
            ),
            0
          )::INTEGER AS repairable

        FROM stocks s

        ${stockWhere}
        `,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

    const agingChart =
      agingRows[0] || {

        available: 0,

        damaged: 0,

        repairable: 0

      };

    // =====================================
    // INVENTORY TABLE
    // =====================================
    const inventoryTable =
      await sequelize.query(
        `
        SELECT

          s.id AS "stockId",

          s.item AS "itemName",

          s.type AS "stockType",

          s.category AS "categories",

          s.sub_category AS "subCategory",

          s.brand AS "brand",

          s.unit AS "unit",

          s.size AS "size",

          s.color AS "color",

          s.model_no AS "modelNo",

          s.serial_no AS "serialNo",

          s.item_code AS "itemCode",

          s.sku AS "sku",

          s.hsn AS "hsnCode",

          s.grn AS "grnNo",

          COALESCE(
            s.po_number,
            'N/A'
          ) AS "poNumber",

          COALESCE(
            s.quantity,
            0
          )::INTEGER AS "currentStock",

          COALESCE(
            s.rate,
            0
          )::DECIMAL(12,2) AS "rate",

          COALESCE(
            s.value,
            0
          )::DECIMAL(12,2) AS "value",

          COALESCE(
            s.batch_no,
            'N/A'
          ) AS "batchNo",

          COALESCE(
            s.aging,
            0
          ) AS "aging",

          COALESCE(
            s.location,
            'N/A'
          ) AS "location",

          COALESCE(
            s.rack_no,
            'N/A'
          ) AS "rackNo",

          COALESCE(
            s.min_stock_level,
            0
          ) AS "minStockLevel",

          COALESCE(
            s.gst_percent,
            0
          ) AS "gstPercent",

          COALESCE(
            s.warranty_months,
            0
          ) AS "warrantyMonths",

          s.expiry_date AS "expiryDate",

          s.item_description AS "description",

          s.specification AS "specification",

          COALESCE((

            SELECT
              SUM(sm.quantity)

            FROM stock_movements sm

            WHERE sm.stock_id = s.id

            AND sm.branch_id = s.branch_id

            AND sm.type = 'IN'

          ), 0)::INTEGER AS "stockIn",

          COALESCE((

            SELECT
              SUM(sm.quantity)

            FROM stock_movements sm

            WHERE sm.stock_id = s.id

            AND sm.branch_id = s.branch_id

            AND sm.type = 'OUT'

          ), 0)::INTEGER AS "stockOut",

          s.status AS "status",

          s.created_at AS "createdAt",

          s.updated_at AS "updatedAt"

        FROM stocks s

        ${stockWhere}

        ORDER BY s.created_at DESC

        LIMIT 100
        `,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

    // =====================================
    // SUPER USER BRANCH OVERVIEW
    // =====================================
    let branchOverview = [];

    if (isSuperUser) {

      branchOverview =
        await sequelize.query(
          `
          SELECT

            b.name AS "branch",

            COALESCE(
              MAX(s.grn),
              'N/A'
            ) AS "grnNo",

            COALESCE(
              MAX(s.po_number),
              'N/A'
            ) AS "orderNumber",

            COALESCE(
              SUM(
                CASE
                  WHEN sm.type = 'IN'
                  THEN sm.quantity
                  ELSE 0
                END
              ),
              0
            )::INTEGER AS "stockIn",

            MAX(
              s.updated_at
            ) AS "lastUpdated"

          FROM branches b

          LEFT JOIN stocks s
          ON s.branch_id = b.id

          LEFT JOIN stock_movements sm
          ON sm.stock_id = s.id

          AND sm.branch_id = b.id

          WHERE b.status = 'ACTIVE'

          GROUP BY
            b.id,
            b.name

          ORDER BY b.id ASC
          `,
          {
            type: QueryTypes.SELECT
          }
        );

    }

    // =====================================
    // FINAL DASHBOARD
    // =====================================
    const dashboard = {

      cards,

      purchaseChart,

      agingChart,

      inventoryTable

    };

    if (isSuperUser) {

      dashboard.branchOverview =
        branchOverview;

    }

    return res.json({

      success: true,

      role:
        isSuperUser
          ? "SUPER"
          : "BRANCH",

      dashboard

    });

  } catch (error) {

    console.error(
      "getInventoryDashboard error:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Error fetching inventory data",

      error:
        error.message

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

    if (!isSuper && !branchId) {
      return res.status(400).json({
        success: false,
        message: "branch_id missing in user"
      });
    }

    // ======================
    // DYNAMIC FILTERS
    // ======================
    const replacements = {};

    const stockBranchWhere = isSuper ? "" : "WHERE s.branch_id = :branchId";
    const ledgerBranchWhere = isSuper ? "" : "WHERE l.branch_id = :branchId";
    const clientBranchWhere = isSuper ? "" : "WHERE c.branch_id = :branchId";

    const stockWhereOnly = isSuper ? "" : "WHERE branch_id = :branchId";

    if (!isSuper) {
      replacements.branchId = branchId;
    }

    // ======================
    // CARDS - UI FORMAT
    // ======================
    const cardsRows = await sequelize.query(
      `
      SELECT
        COALESCE((
          SELECT SUM(s.value)
          FROM stocks s
          ${stockBranchWhere}
        ), 0)::DECIMAL(12,2) AS "totalStockValue",

        COALESCE((
          SELECT SUM(l.amount)
          FROM client_ledger l
          ${ledgerBranchWhere}
          ${isSuper ? "WHERE" : "AND"} l.type = 'SALE'
        ), 0)::DECIMAL(12,2) AS "totalSales",

        COALESCE((
          SELECT SUM(s.value)
          FROM stocks s
          ${stockBranchWhere}
        ), 0)::DECIMAL(12,2) AS "totalPurchases",

        COALESCE((
          SELECT
            SUM(CASE WHEN l.type = 'SALE' THEN l.amount ELSE 0 END) -
            SUM(CASE WHEN l.type = 'PAYMENT' THEN l.amount ELSE 0 END)
          FROM client_ledger l
          ${ledgerBranchWhere}
        ), 0)::DECIMAL(12,2) AS "pendingAmount"
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    const cards = cardsRows[0] || {
      totalStockValue: "0.00",
      totalSales: "0.00",
      totalPurchases: "0.00",
      pendingAmount: "0.00"
    };

    // ======================
    // MONTHLY CASHFLOW
    // ======================
    const monthlyCashflow = await sequelize.query(
      `
      SELECT 
        TO_CHAR(l.created_at, 'Mon') AS month,
        DATE_PART('month', l.created_at) AS month_no,

        COALESCE(SUM(CASE WHEN l.type = 'SALE' THEN l.amount ELSE 0 END), 0)::DECIMAL(12,2) AS inflow,
        COALESCE(SUM(CASE WHEN l.type = 'PAYMENT' THEN l.amount ELSE 0 END), 0)::DECIMAL(12,2) AS outflow,

        COALESCE(SUM(CASE WHEN l.type = 'SALE' THEN l.amount ELSE 0 END), 0)::DECIMAL(12,2) AS amount

      FROM client_ledger l
      ${ledgerBranchWhere}
      GROUP BY TO_CHAR(l.created_at, 'Mon'), DATE_PART('month', l.created_at)
      ORDER BY month_no
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    // ======================
    // BRANCH SHARE / CATEGORY DISTRIBUTION
    // ======================
  // ======================
// CATEGORY WISE SALES
// response key same: categoryDistribution
// ======================
// ======================
// CATEGORY WISE SALES / CONTRIBUTION
// response key same: categoryDistribution
// ======================
const categorywiseShare = await sequelize.query(
  `
  SELECT 
    COALESCE(s.category, 'Unknown') AS category,
    COALESCE(SUM(s.value), 0)::DECIMAL(12,2) AS total
  FROM stocks s
  ${stockBranchWhere}
  GROUP BY s.category
  ORDER BY total DESC
  `,
  {
    replacements,
    type: QueryTypes.SELECT
  }
);

    // ======================
    // CLIENT TABLE
    // ======================
    const clients = await sequelize.query(
      `
      SELECT
        c.id,
        c.client_code AS "clientCode",
        c.name AS "vendorName",
        c.email,
        c.phone,
        c.gst_number AS "gstNumber",

        COALESCE(SUM(CASE WHEN l.type = 'SALE' THEN l.amount ELSE 0 END),0)::DECIMAL(12,2) AS "totalAmount",

        COALESCE(
          SUM(CASE WHEN l.type = 'SALE' THEN l.amount ELSE 0 END) -
          SUM(CASE WHEN l.type = 'PAYMENT' THEN l.amount ELSE 0 END)
        ,0)::DECIMAL(12,2) AS "pendingAmount"

      FROM clients c
      LEFT JOIN client_ledger l
        ON l.client_id = c.id
        ${isSuper ? "" : "AND l.branch_id = :branchId"}

      ${clientBranchWhere}

      GROUP BY c.id, c.client_code, c.name, c.email, c.phone, c.gst_number, c.created_at
      ORDER BY c.created_at DESC
      LIMIT 50
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    // ======================
    // STOCK TABLE
    // ======================
    const table = await sequelize.query(
      `
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
      ${stockWhereOnly}
      ORDER BY created_at DESC
      LIMIT 50
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    return res.json({
      success: true,
      dashboard: {
        cards,
        monthlyCashflow,
        categorywiseShare,
        clients,
        table
      }
    });

  } catch (error) {
    console.error("getCompleteDashboard error:", error);
    return res.status(500).json({
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
// ==========================================
// UPDATED: getStateDetailsDashboard
// ONLY INTERNAL PURCHASE/SALES LOGIC UPDATED
// RESPONSE STRUCTURE SAME
// ==========================================
exports.getStateDetailsDashboard = async (req, res) => {
  try {

    const role = req.user?.role;

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

    const { stateName } = req.params;

    const branches = await sequelize.query(
      `
      SELECT 

        b.id AS "branchId",

        b.name AS "branchName",

        1 AS "totalBranches",

        COALESCE(
          st."totalStock",
          0
        ) AS "totalStock",

        COALESCE(
          st."totalValue",
          0
        ) AS "totalValue",

        COALESCE(
          st."currentStock",
          0
        ) AS "currentStock",

     
        COALESCE(
          mv."stockIn",
          0
        ) AS "stockIn",

        COALESCE(
          mv."stockOut",
          0
        ) AS "stockOut",

        COALESCE(
          mv."purchaseCount",
          0
        ) AS "purchaseCount",

        COALESCE(
          mv."salesCount",
          0
        ) AS "salesCount"

      FROM branches b

      LEFT JOIN (

        SELECT 

          branch_id,

          COALESCE(
            SUM(quantity),
            0
          ) AS "totalStock",

          COALESCE(
            SUM(value),
            0
          ) AS "totalValue",

          COALESCE(
            SUM(quantity),
            0
          ) AS "currentStock",

          COUNT(id) AS "totalItems"

        FROM stocks

        GROUP BY branch_id

      ) st ON st.branch_id = b.id

    
      LEFT JOIN (

        SELECT 

          branch_id,

          COALESCE(
            SUM(
              CASE
                WHEN type = 'IN'
                THEN quantity
                ELSE 0
              END
            ),
            0
          ) AS "stockIn",

          COALESCE(
            SUM(
              CASE
                WHEN type = 'OUT'
                THEN quantity
                ELSE 0
              END
            ),
            0
          ) AS "stockOut",

          COALESCE(
            SUM(
              CASE
                WHEN type = 'IN'
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS "purchaseCount",

          COALESCE(
            SUM(
              CASE
                WHEN type = 'OUT'
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS "salesCount"

        FROM stock_movements

        GROUP BY branch_id

      ) mv ON mv.branch_id = b.id

      WHERE b.state = :stateName

      ORDER BY "totalValue" DESC
      `,
      {
        replacements: {
          stateName
        },

        type: QueryTypes.SELECT
      }
    );

    const chartData = branches.map((b) => ({
      label: b.branchName,
      value: Number(b.totalValue || 0)
    }));

    const topBranches = [...branches]
      .sort(
        (a, b) =>
          Number(b.totalValue || 0) -
          Number(a.totalValue || 0)
      )
      .slice(0, 5);

    const summary = await sequelize.query(
      `
      SELECT 

        COALESCE(
          SUM(x."totalValue"),
          0
        ) AS "totalStockValue",

        COALESCE(
          SUM(x."currentStock"),
          0
        ) AS "currentStock",

        COALESCE(
          SUM(x."totalItems"),
          0
        ) AS "totalItems",

        COALESCE(
          SUM(x."stockIn"),
          0
        ) AS "stockIn",

        COALESCE(
          SUM(x."stockOut"),
          0
        ) AS "stockOut"

      FROM (

        SELECT 

          b.id,

          COALESCE(
            st."totalValue",
            0
          ) AS "totalValue",

          COALESCE(
            st."currentStock",
            0
          ) AS "currentStock",

          COALESCE(
            st."totalItems",
            0
          ) AS "totalItems",

          COALESCE(
            mv."stockIn",
            0
          ) AS "stockIn",

          COALESCE(
            mv."stockOut",
            0
          ) AS "stockOut"

        FROM branches b

        LEFT JOIN (

          SELECT 

            branch_id,

            COALESCE(
              SUM(value),
              0
            ) AS "totalValue",

            COALESCE(
              SUM(quantity),
              0
            ) AS "currentStock",

            COUNT(id) AS "totalItems"

          FROM stocks

          GROUP BY branch_id

        ) st ON st.branch_id = b.id

        LEFT JOIN (

          SELECT 

            branch_id,

            COALESCE(
              SUM(
                CASE
                  WHEN type = 'IN'
                  THEN quantity
                  ELSE 0
                END
              ),
              0
            ) AS "stockIn",

            COALESCE(
              SUM(
                CASE
                  WHEN type = 'OUT'
                  THEN quantity
                  ELSE 0
                END
              ),
              0
            ) AS "stockOut"

          FROM stock_movements

          GROUP BY branch_id

        ) mv ON mv.branch_id = b.id

        WHERE b.state = :stateName

      ) x
      `,
      {
        replacements: {
          stateName
        },

        type: QueryTypes.SELECT
      }
    );

    return res.json({

      success: true,

      state: stateName,

      summary: summary[0],

      branches,

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
      "super_inventory_manager"
    ];

    const role =
      user?.role?.toLowerCase().trim();

    const isSuper =
      SUPER_ROLES.includes(role);

    const requestedBranchId =
      parseInt(req.params.branchId, 10);

    if (Number.isNaN(requestedBranchId)) {

      return res.status(400).json({
        success: false,
        message: "Invalid branchId"
      });

    }

    let finalBranchId;

    if (isSuper) {

      finalBranchId =
        requestedBranchId;

    } else {

      finalBranchId =
        user.branch_id;

      if (
        requestedBranchId !==
        user.branch_id
      ) {

        return res.status(403).json({
          success: false,
          message:
            "Access Denied - You can only view your branch"
        });

      }

    }

    // =====================================
    // BRANCH INFO
    // =====================================
    const branchInfo =
      await Branch.findByPk(
        finalBranchId,
        {
          attributes: [
            "id",
            "name",
            "state"
          ]
        }
      );

    if (!branchInfo) {

      return res.status(404).json({
        success: false,
        message: "Branch not found"
      });

    }

    // =====================================
    // PARALLEL QUERIES
    // =====================================
    const [
      summary,
      stockMovement,
      categoryDistribution,
      monthlyData,
      clients,
      allItems
    ] = await Promise.all([

      // =====================================
      // STOCK SUMMARY
      // =====================================
      sequelize.query(
        `
        SELECT 

          COALESCE(
            SUM(s.value),
            0
          ) AS "totalStockValue",

          COALESCE(
            SUM(s.quantity),
            0
          ) AS "currentStock",

          COUNT(s.id) AS "totalItems"

        FROM stocks s

        WHERE s.branch_id = :branchId
        `,
        {
          replacements: {
            branchId: finalBranchId
          },
          type: sequelize.QueryTypes.SELECT
        }
      ),

      // =====================================
      // STOCK MOVEMENT
      // =====================================
      sequelize.query(
        `
        SELECT

          COALESCE(
            SUM(
              CASE
                WHEN sm.type = 'IN'
                THEN sm.quantity
                ELSE 0
              END
            ),
            0
          ) AS "stockIn",

          COALESCE(
            SUM(
              CASE
                WHEN sm.type = 'OUT'
                THEN sm.quantity
                ELSE 0
              END
            ),
            0
          ) AS "stockOut",

          COALESCE(
            SUM(
              CASE
                WHEN sm.type = 'IN'
                THEN sm.quantity
                ELSE 0
              END
            ),
            0
          ) AS "purchaseStockQty",

          COALESCE(
            SUM(
              CASE
                WHEN sm.type = 'IN'
                THEN (
                  sm.quantity *
                  COALESCE(s.rate,0)
                )
                ELSE 0
              END
            ),
            0
          ) AS "purchaseStockValue",

          COALESCE(
            SUM(
              CASE
                WHEN sm.type = 'OUT'
                THEN sm.quantity
                ELSE 0
              END
            ),
            0
          ) AS "salesStockQty",

          COALESCE(
            SUM(
              CASE
                WHEN sm.type = 'OUT'
                THEN (
                  sm.quantity *
                  COALESCE(s.rate,0)
                )
                ELSE 0
              END
            ),
            0
          ) AS "salesStockValue"

        FROM stock_movements sm

        LEFT JOIN stocks s
        ON s.id = sm.stock_id

        WHERE sm.branch_id = :branchId
        `,
        {
          replacements: {
            branchId: finalBranchId
          },
          type: sequelize.QueryTypes.SELECT
        }
      ),

      // =====================================
      // CATEGORY DISTRIBUTION
      // =====================================
      sequelize.query(
        `
        SELECT 

          COALESCE(
            s.category,
            'UNCATEGORIZED'
          ) AS category,

          COALESCE(
            SUM(s.quantity),
            0
          ) AS total

        FROM stocks s

        WHERE s.branch_id = :branchId

        GROUP BY s.category

        ORDER BY total DESC
        `,
        {
          replacements: {
            branchId: finalBranchId
          },
          type: sequelize.QueryTypes.SELECT
        }
      ),

      // =====================================
      // MONTHLY TREND
      // =====================================
      sequelize.query(
        `
        SELECT 

          TO_CHAR(
            s.created_at,
            'Mon'
          ) AS month,

          DATE_PART(
            'month',
            s.created_at
          ) AS month_no,

          COALESCE(
            SUM(s.value),
            0
          ) AS amount

        FROM stocks s

        WHERE s.branch_id = :branchId

        GROUP BY
          TO_CHAR(s.created_at,'Mon'),
          DATE_PART('month',s.created_at)

        ORDER BY month_no
        `,
        {
          replacements: {
            branchId: finalBranchId
          },
          type: sequelize.QueryTypes.SELECT
        }
      ),

      // =====================================
      // CLIENT DATA
      // =====================================
      sequelize.query(
        `
        SELECT

          c.id AS "clientId",

          c.name AS "clientName",

          c.phone AS "phone",

          COALESCE(
            SUM(
              CASE
                WHEN cl.type = 'SALE'
                THEN cl.amount
                ELSE 0
              END
            ),
            0
          ) AS "totalSales",

          COALESCE(
            SUM(
              CASE
                WHEN cl.type = 'PAYMENT'
                THEN cl.amount
                ELSE 0
              END
            ),
            0
          ) AS "totalPayment",

          COALESCE(
            SUM(
              CASE
                WHEN cl.type = 'SALE'
                THEN cl.amount
                ELSE 0
              END
            ) -
            SUM(
              CASE
                WHEN cl.type = 'PAYMENT'
                THEN cl.amount
                ELSE 0
              END
            ),
            0
          ) AS "pendingAmount"

        FROM clients c

        LEFT JOIN client_ledger cl
        ON cl.client_id = c.id

        WHERE c.branch_id = :branchId

        GROUP BY
          c.id,
          c.name,
          c.phone

        ORDER BY "totalSales" DESC

        LIMIT 10
        `,
        {
          replacements: {
            branchId: finalBranchId
          },
          type: sequelize.QueryTypes.SELECT
        }
      ),

      // =====================================
      // ALL ITEMS FULL DETAILS
      // =====================================
      sequelize.query(
        `
        SELECT 

          s.id AS "stockId",

          s.item AS "itemName",

          COALESCE(
            s.type,
            'GENERAL'
          ) AS "stockType",

          COALESCE(
            s.category,
            ''
          ) AS "category",

          COALESCE(
            s.sub_category,
            ''
          ) AS "subCategory",

          COALESCE(
            s.brand,
            ''
          ) AS "brand",

          COALESCE(
            s.unit,
            'PCS'
          ) AS "unit",

          COALESCE(
            s.size,
            ''
          ) AS "size",

          COALESCE(
            s.color,
            ''
          ) AS "color",

          COALESCE(
            s.model_no,
            ''
          ) AS "modelNo",

          COALESCE(
            s.serial_no,
            ''
          ) AS "serialNo",

          COALESCE(
            s.item_code,
            ''
          ) AS "itemCode",

          COALESCE(
            s.sku,
            ''
          ) AS "sku",

          COALESCE(
            s.hsn,
            ''
          ) AS "hsnCode",

          COALESCE(
            s.grn,
            ''
          ) AS "grnNo",

          COALESCE(
            s.po_number,
            'N/A'
          ) AS "poNumber",

          COALESCE(
            s.quantity,
            0
          ) AS "currentStock",

          COALESCE(
            s.rate,
            0
          ) AS "rate",

          COALESCE(
            s.value,
            0
          ) AS "value",

          COALESCE(
            s.batch_no,
            'N/A'
          ) AS "batchNo",

          COALESCE(
            s.aging,
            0
          ) AS "aging",

          COALESCE(
            s.location,
            'N/A'
          ) AS "location",

          COALESCE(
            s.rack_no,
            'N/A'
          ) AS "rackNo",

          COALESCE(
            s.min_stock_level,
            0
          ) AS "minStockLevel",

          COALESCE(
            s.gst_percent,
            0
          ) AS "gstPercent",

          COALESCE(
            s.warranty_months,
            0
          ) AS "warrantyMonths",

          s.expiry_date AS "expiryDate",

          s.item_description AS "description",

          s.specification AS "specification",

          COALESCE((
            SELECT
              SUM(sm.quantity)

            FROM stock_movements sm

            WHERE sm.stock_id = s.id

            AND sm.type = 'IN'
          ),0) AS "stockIn",

          COALESCE((
            SELECT
              SUM(sm.quantity)

            FROM stock_movements sm

            WHERE sm.stock_id = s.id

            AND sm.type = 'OUT'
          ),0) AS "stockOut",

          s.status AS "status",

          s.created_at AS "createdAt",

          s.updated_at AS "updatedAt"

        FROM stocks s

        WHERE s.branch_id = :branchId

        ORDER BY s.value DESC
        `,
        {
          replacements: {
            branchId: finalBranchId
          },
          type: sequelize.QueryTypes.SELECT
        }
      )

    ]);

    return res.json({

      success: true,

      branchId: finalBranchId,

      branch_id: finalBranchId,

      branch: {

        id: branchInfo.id,

        name: branchInfo.name,

        state: branchInfo.state

      },

      summary: {

        ...summary[0],

        stockIn:
          stockMovement[0]?.stockIn || 0,

        stockOut:
          stockMovement[0]?.stockOut || 0,

        purchaseStockQty:
          stockMovement[0]?.purchaseStockQty || 0,

        purchaseStockValue:
          stockMovement[0]?.purchaseStockValue || 0,

        salesStockQty:
          stockMovement[0]?.salesStockQty || 0,

        salesStockValue:
          stockMovement[0]?.salesStockValue || 0

      },

      charts: {

        categoryDistribution,

        monthlyTrend: monthlyData

      },

      clients,

      allItems

    });

  } catch (err) {

    console.error(
      "ERROR:",
      err
    );

    return res.status(500).json({

      success: false,

      message: err.message

    });

  }
};


// ==========================================
// UPDATED: getItemFullDetails
// RESPONSE STRUCTURE SAME
// INTERNAL LOGIC UPDATED
// ==========================================
exports.getItemFullDetails = async (req, res) => {
  try {

    // =====================================================
    // USER + ROLE VALIDATION
    // =====================================================

    const user = req.user;

    const SUPER_ROLES = [
      "super_admin",
      "admin",
      "super_inventory_manager",
      "super_stock_manager",
      "super_sales_manager"
    ];

    const role =
      user?.role?.toLowerCase()?.trim();

    if (!role) {
      return res.status(403).json({
        success: false,
        message: "Invalid user role"
      });
    }

    const isSuperUser =
      SUPER_ROLES.includes(role);

    // =====================================================
    // PARAMS
    // =====================================================

    const { branchId, itemName } =
      req.params;

    const requestedBranchId =
      Number(branchId);

    const itemKey =
      String(itemName || "").trim();

    if (
      !requestedBranchId ||
      isNaN(requestedBranchId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid branchId is required"
      });
    }

    if (!itemKey) {
      return res.status(400).json({
        success: false,
        message: "itemName is required"
      });
    }

    // =====================================================
    // BRANCH ACCESS CHECK
    // =====================================================

    const userBranches =
      (user?.branches || [])
      .map(Number);

    if (
      !isSuperUser &&
      !userBranches.includes(
        requestedBranchId
      )
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied for this branch"
      });
    }

    // =====================================================
    // FIND STOCK ITEM
    // =====================================================

    const stockResult =
      await sequelize.query(
        `
        SELECT 
          s.*
        FROM stocks s
        WHERE s.branch_id = :branchId
        AND (
          CAST(s.id AS TEXT) = :itemKey
          OR LOWER(TRIM(s.item)) = LOWER(TRIM(:itemKey))
          OR LOWER(TRIM(s.sku)) = LOWER(TRIM(:itemKey))
        )
        LIMIT 1
        `,
        {
          replacements: {
            branchId: requestedBranchId,
            itemKey
          },
          type: QueryTypes.SELECT
        }
      );

    if (!stockResult.length) {
      return res.status(404).json({
        success: false,
        message: "Stock item not found"
      });
    }

    const stock =
      stockResult[0];

    const stockId =
      Number(stock.id);

    // =====================================================
    // MAIN STATS
    // =====================================================

    const statsResult =
      await sequelize.query(
        `
        SELECT 

          COALESCE(s.quantity, 0)
          AS "totalStock",

          COALESCE(s.rate, 0)
          AS "rate",

          COALESCE(s.value, 0)
          AS "totalValue",

          COALESCE(s.bundle_size, '0')
          AS "bundleSize",

          COALESCE(s.min_stock_level, 0)
          AS "minStockLevel",

          COALESCE(
            (
              SELECT SUM(sm.quantity)
              FROM stock_movements sm
              WHERE sm.stock_id = s.id
              AND sm.type = 'IN'
            ),
            0
          ) AS "stockIn",

          COALESCE(
            (
              SELECT SUM(sm.quantity)
              FROM stock_movements sm
              WHERE sm.stock_id = s.id
              AND sm.type = 'OUT'
            ),
            0
          ) AS "stockOut",

          COALESCE(
            (
              SELECT COUNT(sm.id)
              FROM stock_movements sm
              WHERE sm.stock_id = s.id
            ),
            0
          ) AS "totalMovements"

        FROM stocks s

        WHERE s.id = :stockId
        LIMIT 1
        `,
        {
          replacements: {
            stockId
          },
          type: QueryTypes.SELECT
        }
      );

    const stats =
      statsResult[0];

    // =====================================================
    // AGING ANALYTICS
    // =====================================================

    const agingChart =
      await sequelize.query(
        `
        SELECT 
          COALESCE(aging,0) AS aging,
          COALESCE(quantity,0) AS qty
        FROM stocks
        WHERE id = :stockId
        `,
        {
          replacements: {
            stockId
          },
          type: QueryTypes.SELECT
        }
      );

    // =====================================================
    // STATUS ANALYTICS
    // =====================================================

    const statusChart =
      await sequelize.query(
        `
        SELECT 
          COALESCE(status::text,'GOOD')
          AS status,

          COALESCE(quantity,0)
          AS qty

        FROM stocks

        WHERE id = :stockId
        `,
        {
          replacements: {
            stockId
          },
          type: QueryTypes.SELECT
        }
      );

    // =====================================================
    // MONTHLY TREND
    // =====================================================

    const monthlyTrend =
      await sequelize.query(
        `
        SELECT 

          TO_CHAR(
            created_at,
            'YYYY-MM'
          ) AS month,

          COALESCE(quantity,0)
          AS qty,

          COALESCE(value,0)
          AS value

        FROM stocks

        WHERE id = :stockId

        ORDER BY created_at ASC
        `,
        {
          replacements: {
            stockId
          },
          type: QueryTypes.SELECT
        }
      );

    // =====================================================
    // MOVEMENT HISTORY
    // =====================================================

    const movementHistory =
      await sequelize.query(
        `
        SELECT 

          sm.id,

          sm.type,

          sm.quantity,

          COALESCE(
            sm.bundle_quantity,
            0
          ) AS bundle_quantity,

          sm.created_at

        FROM stock_movements sm

        WHERE sm.stock_id = :stockId

        ORDER BY sm.created_at DESC

        LIMIT 20
        `,
        {
          replacements: {
            stockId
          },
          type: QueryTypes.SELECT
        }
      );

    // =====================================================
    // BATCH DATA
    // =====================================================

    const batchData =
      await sequelize.query(
        `
        SELECT 

          COALESCE(batch_no,'N/A')
          AS batch_no,

          COALESCE(grn,'N/A')
          AS grn,

          COALESCE(po_number,'N/A')
          AS po_number,

          COALESCE(quantity,0)
          AS qty,

          COALESCE(value,0)
          AS value

        FROM stocks

        WHERE id = :stockId
        `,
        {
          replacements: {
            stockId
          },
          type: QueryTypes.SELECT
        }
      );

    // =====================================================
    // LOW STOCK CHECK
    // =====================================================

    const lowStock =
      Number(stats.totalStock) <=
      Number(stats.minStockLevel);

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.status(200).json({

      success: true,

      message:
        "Item full details fetched successfully",

      data: {

        stock: {

          id: stock.id,

          item: stock.item,

          sku: stock.sku,

          category: stock.category,

          sub_category:
            stock.sub_category,

          brand: stock.brand,

          model_no:
            stock.model_no,

          serial_no:
            stock.serial_no,

          unit: stock.unit,

          hsn: stock.hsn,

          gst_percent:
            stock.gst_percent,

          batch_no:
            stock.batch_no,

          grn: stock.grn,

          po_number:
            stock.po_number,

          rack_no:
            stock.rack_no,

          location:
            stock.location,

          specification:
            stock.specification,

          item_description:
            stock.item_description,

          status:
            stock.status,

          aging:
            stock.aging,

          created_at:
            stock.created_at
        },

        analytics: {

          totalStock:
            Number(stats.totalStock),

          totalValue:
            Number(stats.totalValue),

          stockRate:
            Number(stats.rate),

          stockIn:
            Number(stats.stockIn),

          stockOut:
            Number(stats.stockOut),

          currentBalance:
            Number(stats.stockIn) -
            Number(stats.stockOut),

          totalMovements:
            Number(stats.totalMovements),

          bundleSize:
            stats.bundleSize,

          lowStock,

          minStockLevel:
            Number(
              stats.minStockLevel
            )

        },

        charts: {

          agingChart,

          statusChart,

          monthlyTrend

        },

        movementHistory,

        batches: batchData

      }

    });

  } catch (err) {

    console.error(
      "GET ITEM FULL DETAILS ERROR:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        err.message ||
        "Internal server error"
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




exports.exportInventoryCSV = async (req, res) => {
  try {
    const user = req.user;

    const role = user?.role || user?.role?.name;
    const branches = user?.branches || [];
    const branchId = user?.branch_id;

    const isSuper =
      role === "super_admin" ||
      role === "super_inventory_manager" ||
      branches.includes("ALL");

    const branchIds = branches
      .filter((b) => b !== "ALL")
      .map(Number)
      .filter(Boolean);

    const replacements = {};
    let branchWhere = "";

    if (!isSuper) {
      if (branchId) {
        branchWhere = "WHERE s.branch_id = :branchId";
        replacements.branchId = branchId;
      } else if (branchIds.length) {
        branchWhere = "WHERE s.branch_id = ANY(:branchIds)";
        replacements.branchIds = branchIds;
      } else {
        return res.status(403).json({
          success: false,
          message: "No branch access"
        });
      }
    }

    const rows = await sequelize.query(
      `
      SELECT
        COALESCE(s.item, '') AS "Item Name",
        COALESCE(s.category, '') AS "Categories",
        COALESCE(s.hsn, '') AS "HSN Code",
        COALESCE(s.grn, '') AS "GRN No.",
        COALESCE(s.po_number, 'N/A') AS "Purchase Order No.",
        COALESCE(s.quantity, 0) AS "Current Stock",

        COALESCE((
          SELECT SUM(l.quantity)
          FROM ledger l
          WHERE l.stock_id = s.id
          AND l.type = 'PURCHASE'
        ), 0) AS "Stock IN",

        COALESCE((
          SELECT SUM(l.quantity)
          FROM ledger l
          WHERE l.stock_id = s.id
          AND l.type = 'SALE'
        ), 0) AS "Stock OUT",

        COALESCE((
          SELECT SUM(l.quantity)
          FROM ledger l
          WHERE l.stock_id = s.id
          AND l.type = 'DAMAGE'
        ), 0) AS "Scrap",

        '' AS "Dispatch Date",
        '' AS "Delivery Date",
        COALESCE(s.status::TEXT, 'N/A') AS "Status"

      FROM stocks s
      ${branchWhere}
      ORDER BY s.created_at DESC
      `,
      {
        replacements,
        type: QueryTypes.SELECT
      }
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "No inventory data found"
      });
    }

    const headers = Object.keys(rows[0]);

    const escapeCSV = (value) => {
      if (value === null || value === undefined) return "";
      return `"${String(value).replace(/"/g, '""')}"`;
    };

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        headers.map((header) => escapeCSV(row[header])).join(",")
      )
    ].join("\n");

    const fileName = `inventory-report-${Date.now()}.csv`;

    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    res.setHeader("Cache-Control", "no-store");

    return res.end(csvContent, "utf8");
  } catch (error) {
    console.error("exportInventoryCSV error:", error);

    return res.status(500).json({
      success: false,
      message: "Error exporting inventory CSV",
      error: error.message
    });
  }
};
