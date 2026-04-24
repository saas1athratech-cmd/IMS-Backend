const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");
const checkRole = require("../../middleware/role");
const  exportcsv  = require("../../controllers/sqlbase/csvdownload");


router.get("/stock-aging/export", auth,exportcsv.exportStockAgingExcel);
router.get("/inventory/export-excel",auth,exportcsv.exportInventoryExcel);
router.get("/report/export-excel",auth,exportcsv.exportSalesExcel);
router.get("/ladger/export-excel",auth,exportcsv.exportClientsExcel);
router.get('/user-get/export-excel',auth,exportcsv.exportUsersExcel);
router.get('/report-superadmin/export-csv',auth,exportcsv.downloadReport)
// router.get('/ladger-client',auth,exportcsv.exportSalesExcel)
// router.get('/')
module.exports = router;