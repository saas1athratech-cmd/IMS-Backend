const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");
const checkRole = require("../../middleware/role");
const admincontroller = require("../../controllers/sqlbase/admin.controller");


router.post("/create-branch",auth,checkRole(["super_admin"]),
  admincontroller.createBranch
);

// Get All Branches
router.get(
  "/branches",
  auth,
  checkRole(["super_admin"]),
  admincontroller.getAllBranches
);

// Super Admin Global Dashboard
router.get(
  "/super-dashboard",
  auth,
  checkRole(["super_admin","admin"]),
  admincontroller.getSuperAdminDashboard
);

// Global Location Summary Dashboard
router.get(
  "/global-dashboard",
  auth,
  checkRole(["super_admin"]),
  admincontroller.getGlobalDashboard
);




router.get(
  "/location/:location",
  auth,
  checkRole(["super_admin", "admin"]),
  admincontroller.getLocationDashboard
);




router.get(
  "/branch/:branchId",
  auth,
  checkRole(["super_admin", "admin"]),
  admincontroller.getBranchDashboard
);





router.get(
  "/admin-dashboard",
  auth,
  checkRole(["admin",'super_admin']),
  admincontroller.getAdminDashboard
);

router.get('/brach/:branchId',auth,checkRole(['admin','super_admin']),admincontroller.getBranchAnalytics)
router.get("/d/get-users", auth,checkRole(['admin','super_admin']),admincontroller.getAllUsersForDashboard);
router.get("/d/branch-overview",auth,checkRole(['super_admin',"admin"]), admincontroller.getBranchOverview);
router.get("/d/locationbranch",auth,checkRole(['super_admin']),admincontroller.getLocationWiseSummary)// ye h location k hisab s 
router.get('/d/report',auth,checkRole(['super_admin',"admin"]),admincontroller.getReportsAnalytics)
router.get("/branch/:branchId/item/:stockId/dashboard",auth,checkRole(['super_admin',"admin"]),admincontroller.getItemDashboard)
router.patch("/users/:id/toggle-status",auth,checkRole(['super_admin',"admin"]),admincontroller.toggleUserStatus);
// 
router.get("/d/get-branch-user/:branch_id", auth,checkRole(['admin','super_admin']),admincontroller.getBranchUsersWithPassword);
router.post('/update-pass',auth,checkRole(['admin','super_admin']),admincontroller.resetUserPassword)
router.put(
  "/branch/:id/toggle",
 auth,checkRole(['admin','super_admin']),
  admincontroller.toggleBranchStatus
);
module.exports = router;