const express = require("express");
const router = express.Router();

const {
  getStockLocations,
  getBranchesByLocation,
  getBranchDashboard,
  updateStockQuantity,  getStockManagerHeadDashboard,getSuperStockManagerDashboard,getSuperBranchDashboard,getItemBranchAnalytics,getAgingAnalytics,getSuperStockManagerLocationDashboard,getAllStatesDashboard,getGlobalStockAgingDashboard, getReportsAndAnalytics,getFullDashboard,getStateWiseStock,getCitiesByState

} = require("../../controllers/sqlbase/manager/stock.manager");

const auth = require("../../middleware/auth");
const checkRole = require("../../middleware/role");


// this is for finding branch in head 
router.get(
  "/locations",
  auth,
  checkRole(["stock_manager","super_stock_manager","super_inventory_manager"]),
  getStockLocations
);

router.get(
  "/state",
  auth,
  checkRole(["stock_manager","super_stock_manager","super_inventory_manager"]),
  getStateWiseStock
);

router.get(
  "/state-graph",
  auth,
  checkRole(["stock_manager","super_stock_manager","super_inventory_manager"]),
  getFullDashboard
);
router.get(
  "/city/:state/cities",
  auth,
  checkRole(["stock_manager","super_stock_manager","super_inventory_manager"]),
  getCitiesByState
);
router.get(
  "/locations/:location",
  auth,
  checkRole(["stock_manager","super_stock_manager","super_inventory_manager"]),
  getBranchesByLocation
);



router.get(
  "/branchs/:branchId",
  auth,
  checkRole(["stock_manager","super_stock_manager","super_inventory_manager"]),
  getBranchDashboard
);



// router.put(
//   "/stock/:stockId",
//   auth,
//   checkRole(["stock_manager"]),
//   updateStockQuantity
// );

router.get(
  "/head-dashboard",
  auth,
  checkRole(["stock_manager","super_stock_manager"]),
  getStockManagerHeadDashboard
);
router.get(
  "/head-dashboards",
  auth,
  checkRole(["super_stock_manager"]),
  getSuperStockManagerDashboard
);
router.get(
  "/branch/:branchId",
  auth,
  checkRole(["super_stock_manager","stock_manager","super_admin","admin"]),
  getSuperBranchDashboard
);
router.get(
  "/analytics/item/:branchId/:itemName",
  auth,
  checkRole(["stock_manager", "super_stock_manager", "super_admin"]),
  getItemBranchAnalytics
);
router.get("/aging/:branchId", getAgingAnalytics);

router.get(
  "/locations-super/:location",
  auth,
  checkRole(["stock_manager","super_stock_manager"]),
  getSuperStockManagerLocationDashboard

);

router.get(
  "/aging-global",
  auth,
  checkRole(["super_stock_manager"]),
  getGlobalStockAgingDashboard
);
router.get(
  "/reports-analytics",
  auth,
  checkRole(["super_stock_manager"]),
  getReportsAndAnalytics
);
// getSuperStockManagerLocationDashboard

module.exports = router;