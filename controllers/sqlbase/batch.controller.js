const sequelize =
  require("../../config/sqlcon");

const {
  QueryTypes,
} = require("sequelize");

const InventoryBatch=require('../../model/SQL_Model/InventoryBatch')
const BatchTimeline=require('../../model/SQL_Model/batch_timelines')

exports.getBatchTree =
  async (req, res) => {

    try {

      const { id } = req.params;

      const [tree] =
        await sequelize.query(
          `
          WITH RECURSIVE batch_tree AS (

            SELECT
              id,
              batch_no,
              parent_batch_id,
              branch_id,
              total_bundle,
              available_bundle,
              bundle_size,
              status,
              created_at

            FROM inventory_batches

            WHERE id = :batch_id

            UNION ALL

            SELECT
              child.id,
              child.batch_no,
              child.parent_batch_id,
              child.branch_id,
              child.total_bundle,
              child.available_bundle,
              child.bundle_size,
              child.status,
              child.created_at

            FROM inventory_batches child

            INNER JOIN batch_tree bt
              ON child.parent_batch_id = bt.id
          )

          SELECT *
          FROM batch_tree

          ORDER BY created_at ASC
          `,
          {
            replacements: {
              batch_id: id,
            },
          }
        );

      return res.json({
        success: true,
        data: tree,
      });

    } catch (error) {

      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  };


  exports.getBatchHistory =
  async (req, res) => {

    try {

      const { id } = req.params;

      const [history] =
        await sequelize.query(
          `
          SELECT
            sm.id,
            sm.type,
            sm.quantity,
            sm.bundle_quantity,
            sm.from_branch_id,
            sm.to_branch_id,
            sm.remarks,
            sm.created_at,

            s.item

          FROM stock_movements sm

          LEFT JOIN stocks s
            ON s.id = sm.stock_id

          WHERE sm.batch_id = :batch_id

          ORDER BY sm.created_at ASC
          `,
          {
            replacements: {
              batch_id: id,
            },
          }
        );

      return res.json({
        success: true,
        data: history,
      });

    } catch (error) {

      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  };

  exports.getBatchLocation =
  async (req, res) => {

    try {

      const { id } = req.params;

      const [batch] =
        await sequelize.query(
          `
          SELECT
            ib.id,
            ib.batch_no,
            ib.available_bundle,
            ib.bundle_size,
            ib.status,

            b.id as branch_id,
            b.name as branch_name

          FROM inventory_batches ib

          LEFT JOIN branches b
            ON b.id = ib.branch_id

          WHERE ib.id = :batch_id

          LIMIT 1
          `,
          {
            replacements: {
              batch_id: id,
            },
          }
        );

      return res.json({
        success: true,
        data: batch[0] || null,
      });

    } catch (error) {

      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  };

exports.getItemTracker = async (req, res) => {
  try {
    const { stockId } = req.params;

    if (!stockId) {
      return res.status(400).json({
        success: false,
        message: "stockId is required",
      });
    }

    const isSuperUser = [
      "super_admin",
      "super_inventory_manager",
    ].includes(req.user.role);

    const batchBranchFilter = isSuperUser
      ? ""
      : `AND ib.branch_id = :branchId`;

    const movementBranchFilter = isSuperUser
      ? ""
      : `AND (
          sm.from_branch_id = :branchId
          OR sm.to_branch_id = :branchId
        )`;

    const timelineBranchFilter = isSuperUser
      ? ""
      : `AND (
          bt.from_branch_id = :branchId
          OR bt.to_branch_id = :branchId
        )`;

    const replacements = isSuperUser
      ? { stockId }
      : { stockId, branchId: req.user.branch_id };

    // =====================================================
    // SAFE QTY CALC (IMPORTANT FIX)
    // Extract number from "10 PCS", "5 BOX", etc.
    // =====================================================

    const safeQty = `
      CASE
        WHEN ib.bundle_size ~ '[0-9]+' 
        THEN ib.available_bundle * NULLIF(regexp_replace(ib.bundle_size, '[^0-9]', '', 'g'), '')::INTEGER
        ELSE 0
      END
    `;

    const safeQtyTotal = `
      CASE
        WHEN ib.bundle_size ~ '[0-9]+'
        THEN ib.total_bundle * NULLIF(regexp_replace(ib.bundle_size, '[^0-9]', '', 'g'), '')::INTEGER
        ELSE 0
      END
    `;

    // =====================================================
    // STOCK DETAILS
    // =====================================================
    const stockResult = await sequelize.query(
      `
      SELECT s.*, b.name AS branch_name, b.location AS branch_location
      FROM stocks s
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE s.id = :stockId
      LIMIT 1
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    if (!stockResult.length) {
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    const stock = stockResult[0];

    // =====================================================
    // CURRENT LOCATION
    // =====================================================
    const currentLocation = await sequelize.query(
      `
      SELECT
        ib.id,
        ib.batch_no,
        ib.parent_batch_id,
        ib.branch_id,
        b.name AS branch_name,
        b.location AS branch_location,
        ib.available_bundle,
        ib.bundle_size,
        (${safeQty}) AS available_quantity,
        ib.status,
        ib.created_at
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.stock_id = :stockId
        AND ib.available_bundle > 0
        ${batchBranchFilter}
      ORDER BY ib.created_at ASC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    // =====================================================
    // ALL BATCHES
    // =====================================================
    const allBatches = await sequelize.query(
      `
      SELECT
        ib.id,
        ib.batch_no,
        ib.parent_batch_id,
        ib.branch_id,
        b.name AS branch_name,
        b.location AS branch_location,
        ib.total_bundle,
        ib.available_bundle,
        ib.bundle_size,
        (${safeQtyTotal}) AS total_quantity,
        (${safeQty}) AS available_quantity,
        ib.status,
        ib.created_at
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.stock_id = :stockId
        ${batchBranchFilter}
      ORDER BY ib.created_at ASC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    // =====================================================
    // MOVEMENT HISTORY
    // =====================================================
    const movementHistory = await sequelize.query(
      `
      SELECT
        sm.id,
        sm.batch_id,
        sm.type,
        sm.quantity,
        sm.bundle_quantity,
        sm.remarks,
        sm.reference_no,
        sm.reference_type,
        sm.created_at,
        fb.name AS from_branch,
        tb.name AS to_branch
      FROM stock_movements sm
      LEFT JOIN branches fb ON fb.id = sm.from_branch_id
      LEFT JOIN branches tb ON tb.id = sm.to_branch_id
      WHERE sm.stock_id = :stockId
        ${movementBranchFilter}
      ORDER BY sm.created_at DESC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    // =====================================================
    // TIMELINE
    // =====================================================
    const timeline = await sequelize.query(
      `
      SELECT
        bt.id,
        bt.batch_id,
        bt.event_type,
        bt.title,
        bt.description,
        bt.quantity,
        bt.bundle_quantity,
        bt.created_at,
        fb.name AS from_branch,
        tb.name AS to_branch
      FROM batch_timelines bt
      LEFT JOIN branches fb ON fb.id = bt.from_branch_id
      LEFT JOIN branches tb ON tb.id = bt.to_branch_id
      WHERE bt.stock_id = :stockId
        ${timelineBranchFilter}
      ORDER BY bt.created_at ASC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    // =====================================================
    // FINAL DESTINATION
    // =====================================================
    const finalDestination = await sequelize.query(
      `
      SELECT
        ib.batch_no,
        ib.branch_id,
        b.name AS branch_name,
        b.location AS branch_location,
        ib.available_bundle,
        (${safeQty}) AS available_quantity,
        ib.status
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.stock_id = :stockId
        AND ib.available_bundle > 0
        ${batchBranchFilter}
      ORDER BY ib.created_at ASC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    return res.status(200).json({
      success: true,
      message: "Item tracker fetched successfully",
      stock,
      tracker: {
        currentLocation,
        finalDestination,
        allBatches,
        movementHistory,
        timeline,
      },
    });

  } catch (err) {
    console.error("ITEM TRACKER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getBatchItemFlow = async (req, res) => {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: "batchId is required",
      });
    }

    const isSuperUser = [
      "super_admin",
      "super_inventory_manager",
    ].includes(req.user.role);

    const replacements = isSuperUser
      ? { batchId }
      : { batchId, branchId: req.user.branch_id };

    const branchFilter = isSuperUser
      ? ""
      : "AND (sm.from_branch_id = :branchId OR sm.to_branch_id = :branchId)";

    // =====================================================
    // 1. BASE BATCH INFO
    // =====================================================
    const batchResult = await sequelize.query(
      `
      SELECT 
        ib.*,
        s.item,
        s.rate
      FROM inventory_batches ib
      LEFT JOIN stocks s ON s.id = ib.stock_id
      WHERE ib.id = :batchId
      LIMIT 1
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    if (!batchResult.length) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    const batch = batchResult[0];

    // =====================================================
    // 2. FULL MOVEMENT HISTORY (REAL FLOW)
    // =====================================================
    const movementFlow = await sequelize.query(
      `
      SELECT
        sm.id,
        sm.type,
        sm.quantity,
        sm.bundle_quantity,
        sm.from_branch_id,
        sm.to_branch_id,
        sm.reference_no,
        sm.reference_type,
        sm.remarks,
        sm.created_at,

        fb.name AS from_branch,
        tb.name AS to_branch

      FROM stock_movements sm

      LEFT JOIN branches fb ON fb.id = sm.from_branch_id
      LEFT JOIN branches tb ON tb.id = sm.to_branch_id

      WHERE sm.batch_id = :batchId
      ${branchFilter}

      ORDER BY sm.created_at ASC
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // 3. WHERE CURRENTLY AVAILABLE (LATEST STATE)
    // =====================================================
    const currentState = await sequelize.query(
      `
      SELECT
        ib.id,
        ib.batch_no,
        ib.available_bundle,
        ib.total_bundle,
        ib.branch_id,
        b.name AS branch_name

      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.id = :batchId
      LIMIT 1
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // RESPONSE
    // =====================================================
    return res.status(200).json({
      success: true,
      message: "Batch movement flow fetched successfully",

      data: {
        batch,

        currentState: currentState[0] || null,

        flow: movementFlow.map((m) => ({
          id: m.id,
          type: m.type,

          quantity: Number(m.quantity || 0),
          bundle_quantity: Number(m.bundle_quantity || 0),

          from_branch: m.from_branch,
          to_branch: m.to_branch,

          reference_no: m.reference_no,
          reference_type: m.reference_type,

          remarks: m.remarks,
          created_at: m.created_at,
        })),
      },
    });
  } catch (err) {
    console.error("BATCH FLOW ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
exports.getBatchFlowTimeline = async (req, res) => {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: "batchId is required",
      });
    }

    // =====================================================
    // 1. GET MAIN BATCH
    // =====================================================
    const batch = await sequelize.query(
      `
      SELECT 
        ib.*,
        s.item,
        s.rate
      FROM inventory_batches ib
      LEFT JOIN stocks s ON s.id = ib.stock_id
      WHERE ib.id = :batchId
      LIMIT 1
      `,
      {
        replacements: { batchId },
        type: QueryTypes.SELECT,
      }
    );

    if (!batch.length) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    // =====================================================
    // 2. GET FULL BATCH TREE
    // =====================================================
    const batchTree = await sequelize.query(
      `
      WITH RECURSIVE tree AS (
        SELECT * FROM inventory_batches WHERE id = :batchId

        UNION ALL

        SELECT ib.*
        FROM inventory_batches ib
        INNER JOIN tree t ON ib.parent_batch_id = t.id
      )
      SELECT * FROM tree
      `,
      {
        replacements: { batchId },
        type: QueryTypes.SELECT,
      }
    );

    const batchIds = batchTree
      .map((b) => Number(b.id))
      .filter((id) => !isNaN(id));

    if (!batchIds.length) {
      return res.status(200).json({
        success: true,
        message: "No batch flow found",
        data: {
          batch: batch[0],
          batchTree: [],
          currentState: null,
          timeline: [],
          movements: [],
          flow_analysis: [],
        },
      });
    }

    // =====================================================
    // 3. TIMELINE
    // =====================================================
    const timeline = await sequelize.query(
      `
      SELECT
        bt.id,
        bt.batch_id,
        bt.event_type,
        bt.title,
        bt.description,
        bt.quantity,
        bt.bundle_quantity,
        bt.from_branch_id,
        bt.to_branch_id,
        fb.name AS from_branch,
        tb.name AS to_branch,
        bt.created_at
      FROM batch_timelines bt
      LEFT JOIN branches fb ON fb.id = bt.from_branch_id
      LEFT JOIN branches tb ON tb.id = bt.to_branch_id
      WHERE bt.batch_id IN (:batchIds)
      ORDER BY bt.created_at ASC
      `,
      {
        replacements: { batchIds },
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // 4. MOVEMENTS (FIXED - USING batch_timelines ONLY)
    // =====================================================
    const movements = await sequelize.query(
      `
      SELECT
        bt.id,
        bt.batch_id,
        bt.event_type AS type,
        bt.quantity,
        bt.bundle_quantity,
        bt.description,
        bt.from_branch_id,
        bt.to_branch_id,
        fb.name AS from_branch,
        tb.name AS to_branch,
        bt.created_at
      FROM batch_timelines bt
      LEFT JOIN branches fb ON fb.id = bt.from_branch_id
      LEFT JOIN branches tb ON tb.id = bt.to_branch_id
      WHERE bt.batch_id IN (:batchIds)
      ORDER BY bt.created_at ASC
      `,
      {
        replacements: { batchIds },
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // 5. FLOW ANALYSIS (FIXED)
    // =====================================================
    const flowMap = {};

    for (const m of movements) {
      const batchIdNum = Number(m.batch_id);
      const type = m.type;
      const qty = Number(m.quantity || 0);

      if (!flowMap[batchIdNum]) {
        flowMap[batchIdNum] = {
          batch_id: batchIdNum,
          sale: 0,
          transfer_in: 0,
          transfer_out: 0,
          adjustment: 0,
          total_moved: 0,
          movements: [],
        };
      }

      flowMap[batchIdNum].movements.push({
        type,
        qty,
        from: m.from_branch,
        to: m.to_branch,
        date: m.created_at,
        description: m.description,
      });

      flowMap[batchIdNum].total_moved += qty;

      if (type === "SALE") flowMap[batchIdNum].sale += qty;
      else if (type === "TRANSFER_IN") flowMap[batchIdNum].transfer_in += qty;
      else if (type === "TRANSFER_OUT") flowMap[batchIdNum].transfer_out += qty;
      else if (type === "ADJUSTMENT") flowMap[batchIdNum].adjustment += qty;
    }

    // =====================================================
    // 6. CURRENT STATE
    // =====================================================
    const currentState = await sequelize.query(
      `
      SELECT
        ib.id,
        ib.batch_no,
        ib.total_bundle,
        ib.available_bundle,
        ib.status,
        ib.branch_id,
        b.name AS branch_name
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.id = :batchId
      LIMIT 1
      `,
      {
        replacements: { batchId },
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // 7. RESPONSE
    // =====================================================
    return res.status(200).json({
      success: true,
      message: "Batch full flow timeline fetched successfully",

      data: {
        batch: batch[0],
        batchTree,
        currentState: currentState[0] || null,
        timeline,
        movements,
        flow_analysis: Object.values(flowMap),
      },
    });

  } catch (err) {
    console.error("BATCH FLOW ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getItemFullTrace = async (req, res) => {
  try {
    const { stockId } = req.params;

    if (!stockId) {
      return res.status(400).json({
        success: false,
        message: "stockId is required",
      });
    }

    const isSuperUser = [
      "super_admin",
      "super_inventory_manager",
    ].includes(req.user.role);

    const replacements = isSuperUser
      ? { stockId }
      : { stockId, branchId: req.user.branch_id };

    // =====================================================
    // 1. CURRENT STOCK LOCATION (REAL-TIME)
    // =====================================================
    const currentStock = await sequelize.query(
      `
      SELECT
        ib.id AS batch_id,
        ib.batch_no,
        ib.branch_id,
        b.name AS branch_name,
        ib.available_bundle,
        ib.total_bundle,
        ib.parent_batch_id
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.stock_id = :stockId
        AND ib.available_bundle > 0
      ORDER BY ib.created_at ASC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    // =====================================================
    // 2. FULL MOVEMENT HISTORY (COMPLETE TRACE)
    // =====================================================
    const movementHistory = await sequelize.query(
      `
      SELECT
        sm.id,
        sm.batch_id,
        sm.type,
        sm.quantity,
        sm.bundle_quantity,

        sm.from_branch_id,
        sm.to_branch_id,

        fb.name AS from_branch,
        tb.name AS to_branch,

        sm.reference_no,
        sm.reference_type,
        sm.created_at

      FROM stock_movements sm
      LEFT JOIN branches fb ON fb.id = sm.from_branch_id
      LEFT JOIN branches tb ON tb.id = sm.to_branch_id
      WHERE sm.stock_id = :stockId
      ORDER BY sm.created_at ASC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    // =====================================================
    // 3. RECONSTRUCT FLOW PATH (IMPORTANT LOGIC)
    // =====================================================
    const flowMap = {};

    movementHistory.forEach((m) => {
      const key = m.batch_id;

      if (!flowMap[key]) {
        flowMap[key] = {
          batch_id: key,
          path: [],
          total_moved: 0,
        };
      }

      flowMap[key].path.push({
        from: m.from_branch,
        to: m.to_branch,
        qty: m.quantity,
        bundle: m.bundle_quantity,
        time: m.created_at,
        type: m.type,
      });

      flowMap[key].total_moved += Number(m.quantity || 0);
    });

    // =====================================================
    // 4. FINAL DESTINATION CALCULATION
    // =====================================================
    const finalDestination = await sequelize.query(
      `
      SELECT
        ib.branch_id,
        b.name AS branch_name,
        SUM(ib.available_bundle) AS total_available,
        COUNT(ib.id) AS batch_count
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.stock_id = :stockId
        AND ib.available_bundle > 0
      GROUP BY ib.branch_id, b.name
      ORDER BY total_available DESC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    // =====================================================
    // RESPONSE
    // =====================================================
    return res.status(200).json({
      success: true,
      message: "Full item trace fetched successfully",

      data: {
        stockId,

        currentLocation: currentStock,

        finalDestination,

        movementTrace: Object.values(flowMap),

        summary: {
          total_current_batches: currentStock.length,
          total_locations: finalDestination.length,
          total_movements: movementHistory.length,
        },
      },
    });

  } catch (err) {
    console.error("ITEM TRACE ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getItemInventoryTrace = async (req, res) => {
  try {
    const { stockId } = req.params;

    if (!stockId) {
      return res.status(400).json({
        success: false,
        message: "stockId is required",
      });
    }

    const isSuperUser = [
      "super_admin",
      "super_inventory_manager",
    ].includes(req.user.role);

    const replacements = isSuperUser
      ? { stockId }
      : { stockId, branchId: req.user.branch_id };

    // =====================================================
    // 1. STOCK INFO
    // =====================================================
    const stock = await sequelize.query(
      `
      SELECT * FROM stocks WHERE id = :stockId LIMIT 1
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    if (!stock.length) {
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    // =====================================================
    // 2. CURRENT STOCK (BATCH WISE)
    // =====================================================
    const currentStock = await sequelize.query(
      `
      SELECT
        ib.id AS batch_id,
        ib.batch_no,
        ib.branch_id,
        b.name AS branch_name,
        ib.available_bundle,
        ib.total_bundle
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.stock_id = :stockId
        AND ib.available_bundle > 0
      ORDER BY ib.created_at ASC
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // 3. MOVEMENTS
    // =====================================================
    const movements = await sequelize.query(
      `
      SELECT
        sm.id,
        sm.batch_id,
        sm.type,
        sm.quantity,
        sm.bundle_quantity,
        sm.from_branch_id,
        sm.to_branch_id,
        fb.name AS from_branch,
        tb.name AS to_branch,
        sm.created_at
      FROM stock_movements sm
      LEFT JOIN branches fb ON fb.id = sm.from_branch_id
      LEFT JOIN branches tb ON tb.id = sm.to_branch_id
      WHERE sm.stock_id = :stockId
        AND sm.batch_id IS NOT NULL
      ORDER BY sm.created_at ASC
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // 4. TRACE MAP
    // =====================================================
    const traceMap = {};

    for (const m of movements) {
      const batchId = Number(m.batch_id);

      if (!traceMap[batchId]) {
        traceMap[batchId] = {
          batch_id: batchId,
          received: 0,
          transferred: 0,
          sold: 0,
          adjusted: 0,
          path: [],
        };
      }

      const node = traceMap[batchId];
      const qty = Number(m.quantity || 0);

      node.path.push({
        type: m.type,
        from: m.from_branch,
        to: m.to_branch,
        qty,
        time: m.created_at,
      });

      if (m.type === "IN") node.received += qty;
      else if (m.type === "TRANSFER") node.transferred += qty;
      else if (m.type === "OUT") node.sold += qty;
      else if (m.type === "ADJUSTMENT") node.adjusted += qty;
    }

    // =====================================================
    // 5. FINAL LOCATIONS (FIXED - NO ADDRESS COLUMN)
    // =====================================================
    const finalLocations = await sequelize.query(
      `
      SELECT
        ib.branch_id,
        b.name AS branch_name,
        b.location AS branch_location,
        SUM(ib.available_bundle) AS qty
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.stock_id = :stockId
        AND ib.available_bundle > 0
      GROUP BY ib.branch_id, b.name, b.location
      ORDER BY qty DESC
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // 6. RESPONSE
    // =====================================================
    return res.status(200).json({
      success: true,
      message: "Item inventory trace fetched successfully",

      data: {
        stock: stock[0],

        summary: {
          total_current_batches: currentStock.length,
          total_locations: finalLocations.length,
          total_events: movements.length,
        },

        current_stock: currentStock,
        final_locations: finalLocations,

        movement_trace: Object.values(traceMap).map((b) => ({
          batch_id: b.batch_id,
          received: b.received,
          transferred: b.transferred,
          sold: b.sold,
          adjusted: b.adjusted,
          available:
            b.received - b.transferred - b.sold + b.adjusted,
          path: b.path,
        })),
      },
    });
  } catch (err) {
    console.error("ITEM INVENTORY TRACE ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};


exports.getItemBatchesByDate = async (req, res) => {
  try {
    const { stockId, date, fromDate, toDate } = req.query;

    if (!stockId) {
      return res.status(400).json({
        success: false,
        message: "stockId is required",
      });
    }

    const role = req.user.role;
    const branchId = req.user.branch_id;

    const isSuperUser = [
      "super_admin",
      "super_inventory_manager",
    ].includes(role);

    // =====================================================
    // DATE FILTER
    // =====================================================
    let dateFilter = "";
    let replacements = { stockId };

    if (date) {
      dateFilter = `
        AND ib.created_at BETWEEN :startDate AND :endDate
      `;
      replacements.startDate = `${date} 00:00:00`;
      replacements.endDate = `${date} 23:59:59`;
    } 
    else if (fromDate && toDate) {
      dateFilter = `
        AND ib.created_at BETWEEN :fromDate AND :toDate
      `;
      replacements.fromDate = fromDate;
      replacements.toDate = toDate;
    } 
    else if (fromDate) {
      dateFilter = `AND ib.created_at >= :fromDate`;
      replacements.fromDate = fromDate;
    } 
    else if (toDate) {
      dateFilter = `AND ib.created_at <= :toDate`;
      replacements.toDate = toDate;
    }

    // =====================================================
    // ROLE-BASED FILTER
    // =====================================================
    let roleFilter = "";

    if (!isSuperUser) {
      roleFilter = `AND ib.branch_id = :branchId`;
      replacements.branchId = branchId;
    }

    // =====================================================
    // QUERY
    // =====================================================
    const batches = await sequelize.query(
      `
      SELECT
        ib.id,
        ib.batch_no,
        ib.stock_id,
        ib.parent_batch_id,
        ib.branch_id,
        b.name AS branch_name,
        ib.total_bundle,
        ib.available_bundle,
        ib.bundle_size,
        ib.status,
        ib.created_at
      FROM inventory_batches ib
      LEFT JOIN branches b ON b.id = ib.branch_id
      WHERE ib.stock_id = :stockId
      ${roleFilter}
      ${dateFilter}
      ORDER BY ib.created_at DESC
      `,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    // =====================================================
    // SUMMARY
    // =====================================================
    const summary = {
      total_batches: batches.length,
      total_quantity: batches.reduce(
        (sum, b) => sum + Number(b.available_bundle || 0),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      message: "Item batches fetched successfully",
      data: {
        summary,
        batches,
      },
    });

  } catch (err) {
    console.error("GET ITEM BATCHES ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};










exports.getBatchMovement = async (req, res) => {
  try {
    const { batchId } = req.params;

    const batch = await InventoryBatch.findByPk(batchId);

    if (!batch) {
      return res.status(404).json({
        success: false,
        error: "Batch not found",
      });
    }

    const movements = await BatchTimeline.findAll({
      where: {
        batch_id: batchId,
      },
      order: [["created_at", "ASC"]],
    });

    return res.status(200).json({
      success: true,
      batch_id: batch.id,
      batch_no: batch.batch_no,
      available_qty: batch.available_bundle,
      movements,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};