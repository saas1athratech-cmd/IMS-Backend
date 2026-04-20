const express = require("express");
const router = express.Router();

const {
  getInventoryDashboard,
  getInventoryDashboardCharts,
  getBranchOverview,
  getBranchDashboard,
  getFullInventoryDashboard,
  getInventoryTable,
  getPurchaseSalesSummary,
  getPurchaseItems,
  getDamageStock,
  getAgingStock,
  getStockMovements,
  getStockAgingDashboard,
  getReportsAnalyticsDashboard,
  getCompleteDashboard,
  addStockItem,
  getAllStatesDashboard,getStateDetailsDashboard,getBranchDetailsDashboard,getItemFullDetails,getCityBranchDashboard,getClientLedgerByBranch,bulkUploadStock
} = require("../../controllers/sqlbase/combine/combinemanager");

const auth = require("../../middleware/auth");
const checkRole = require("../../middleware/role");
const { upload } = require("../../middleware/upload"); 

// =====================================
// MAIN DASHBOARD
// =====================================

// Full dashboard (cards + charts + clients) ye ladger screen on combine ki h
router.get(
  "/dashboard/complete",
  auth,
  checkRole(["inventory_manager","super_inventory_manager"]),
  getCompleteDashboard
);


// Inventory dashboard
router.get(
  "/dashboard/inventory",
  auth,
  checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),
  getInventoryDashboard
);


// Dashboard charts
router.get(
  "/dashboard/charts",
  auth,
  checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),
  getInventoryDashboardCharts
);


// Full inventory dashboard (all branches)
router.get(
  "/dashboard/full",
  auth,
  checkRole(["inventory_manager","stock_manager","super_inventory_manager"]),
  getFullInventoryDashboard
);



// Branch overview (all branches)
router.get(
  "/dashboard/branches",
  auth,
  checkRole(["inventory_manager","stock_manager","super_inventory_manager"]),
  getBranchOverview
);


// Single branch dashboard
router.get(
  "/dashboard/branch/:branch",
  auth,
  checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),
  getBranchDashboard
);




router.get(
  "/inventory/table",
  auth,
  checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),
  getInventoryTable
);



router.get(
  "/inventory/purchase-sales-summary",
  auth,
  checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),
  getPurchaseSalesSummary
);


// Purchase items list
router.get(
  "/inventory/purchases",
  auth,
  checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),
  getPurchaseItems
);



// Damaged stock
router.get(
  "/inventory/damaged",
  auth,
  checkRole(["stock_manager","inventory_manager"]),
  getDamageStock
);


// Aging stock
router.get(
  "/inventory/aging",
  auth,
  checkRole(["stock_manager","inventory_manager"]),
  getAgingStock
);


// Stock movement history
router.get(
  "/inventory/movements",
  auth,
  checkRole(["stock_manager","inventory_manager"]),
  getStockMovements
);



// Stock aging analytics dashboard
router.get(
  "/dashboard/aging",
  auth,
  checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),
  getStockAgingDashboard
);


// Reports & analytics dashboard
router.get(
  "/dashboard/reports",
  auth,
  checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),
  getReportsAnalyticsDashboard
);

router.post(
  "/bulk-upload",
  auth,                  // login user
  upload.single("file"), // excel file key = file
  bulkUploadStock,checkRole(["stock_manager","inventory_manager","super_inventory_manager"])
);

router.post('/add-stock',auth,checkRole(["stock_manager","inventory_manager","super_inventory_manager"]),addStockItem)
router.get('/dashboard/states',auth,checkRole(["stock_manager","inventory_manager","super_inventory_manager","super_admin","super_sales_manager"]), getAllStatesDashboard);
router.get('/dashboard/state/:stateName',auth,checkRole(["stock_manager","inventory_manager","super_inventory_manager","super_admin","admin","super_sales_manager"]),getStateDetailsDashboard);
router.get('/dashboard/branch-id/:branchId',auth,checkRole(["inventory_manager","super_inventory_manager","super_admin","admin","super_sales_manager","super_sales_manager"]),getBranchDetailsDashboard);
// router.get('/dashboard',)
router.get(
  "/dashboard/item/:branchId/:itemName",
  auth,
  checkRole(["super_inventory_manager","super_admin","super_stock_manager","inventory_manager","super_admin","admin","super_sales_manager"]),
  getItemFullDetails
);
router.get(
  "/dashboard/state/:stateName/city/:cityName/branches",
  auth,
  checkRole([
    "super_stock_manager",
    "super_admin",
    "super_sales_manager",
    "super_inventory_manager",
    "admin",
    "super_sales_manager"
  ]),
  getCityBranchDashboard
);
router.get('/ledger/client/:clientId',   auth,
  checkRole([
    "super_stock_manager",
    "super_admin",
    "super_sales_manager",
    "inventory_manager",
    "super_inventory_manager",
    
    "admin",
    "super_sales_manager"
  ]), getClientLedgerByBranch);
module.exports = router;