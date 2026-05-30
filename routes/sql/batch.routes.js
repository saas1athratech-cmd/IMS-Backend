const router = require("express").Router();

const auth = require("../../middleware/auth");
const checkRole = require("../../middleware/role");

const batchController =
  require("../../controllers/sqlbase/batch.controller");

// =====================================================
// ITEM TRACKER
// =====================================================
router.get(
  "/item-tracker/:stockId",
  auth,
  checkRole([
    "stock_manager",
    "inventory_manager",
    "super_inventory_manager",
    "super_admin",
  ]),
  batchController.getItemTracker
);

// =====================================================
// BATCH TREE
// =====================================================
router.get(
  "/:id/tree",
  auth,
  checkRole([
    "stock_manager",
    "inventory_manager",
    "super_inventory_manager",
    "super_admin",
  ]),
  batchController.getBatchTree
);

// =====================================================
// BATCH HISTORY
// =====================================================
router.get(
  "/:id/history",
  auth,
  checkRole([
    "stock_manager",
    "inventory_manager",
    "super_inventory_manager",
    "super_admin",
  ]),
  batchController.getBatchHistory
);

// =====================================================
// BATCH LOCATION
// =====================================================
router.get(
  "/:id/location",
  auth,
  checkRole([
    "stock_manager",
    "inventory_manager",
    "super_inventory_manager",
    "super_admin",
  ]),
  batchController.getBatchLocation
);

// =====================================================
// 🚀 NEW: BATCH FLOW TRACKER (MAIN FEATURE)
// =====================================================
router.get(
  "/:batchId/flow",
  auth,
 checkRole([
    "stock_manager",
    "inventory_manager",
    "super_inventory_manager",
    "super_admin"
  ]),
  batchController.getBatchItemFlow
);

router.get(
  "/:batchId/timeline",
  auth,
 checkRole([
    "stock_manager",
    "inventory_manager",
    "super_inventory_manager",
    "super_admin"
  ]),
  batchController.getBatchFlowTimeline
);

router.get(
  "/item-tracker/:stockId",
  auth,
 checkRole([
    "stock_manager",
    "inventory_manager",
    "super_inventory_manager",
    "super_admin"
  ]),
  batchController.getItemInventoryTrace
);
router.get(
  "/item-batches",
  auth,
  checkRole([
    "stock_manager",
    "inventory_manager",
    "super_inventory_manager",
    "super_admin",
  ]),
  batchController.getItemBatchesByDate
);

router.get(
  "/inventory/batch/:batchId/movement",
  auth,
  batchController.getBatchMovement
);
module.exports = router;