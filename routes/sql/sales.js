const express = require("express");
const router = express.Router();
const salemanager=require('../../controllers/sqlbase/manager/sales.manager')

const auth = require("../../middleware/auth");
const checkRole = require("../../middleware/role");




router.post("/clients-create", auth, checkRole(["sales_manager","admin","super_admin"]), salemanager.createClient);
router.get("/clients", auth, checkRole(["sales_manager","admin","finance","super_stock_manager"]), salemanager.listClients);
router.post('/qt-gen',auth,checkRole(["sales_manager","admin"]),salemanager.createQuotation)
router.post("/ledger/sale", auth, checkRole(["sales_manager","admin"]), salemanager.createSaleEntry);
router.post("/ledger/payment", auth, checkRole(["sales_manager","admin","finance"]), salemanager.addClientPayment);

router.get("/ledger/:clientId", auth, checkRole(["sales_manager","admin","finance","super_stock_manager","super_admin","super_sales_manager"]), salemanager.getClientLedger);
router.post('/gt/:id/convert-invoice',auth,checkRole(["sales_manager","admin","super_admin"]),salemanager.convertQuotationToInvoice)
router.get("/get", auth, checkRole(["sales_manager","admin","finance","super_stock_manager","super_admin","super_sales_manager"]), salemanager.listQuotations);
// router.get("/getsales",auth,checkRole(["sales_manager","admin","super_admin"]),salemanager.getClientLedger)
 
// router.get("/client-ledger/:clientId", auth, checkRole(["sales_manager","admin"]), salemanager.getClientLedgerDetails);
router.get('/report-all',auth, checkRole(["sales_manager","admin","super_sales_manager"]), salemanager.reportandanalysis)
router.put("/approve/:id",auth,checkRole(["sales_manager","super_admin", "super_sales_manager"]),salemanager.approveQuotation);
router.get('/dashbord',auth,checkRole(["sales_manager","super_admin", "super_sales_manager"]),salemanager.getAdvancedSalesAnalytics)

//Ladger-screen-entries
router.get('/get-ladger',auth,checkRole(["sales_manager","super_admin", "super_sales_manager","inventory_manager","super_inventory_manager"]),salemanager.getClientLedgerSummary)
//Ladger-screen-entries
router.get('/get-ladger/:clientId',auth,checkRole(["sales_manager","super_admin", "super_sales_manager","inventory_manager","super_inventory_manager"]),salemanager.getClientLedgerDetails)
router.get('/get-invoice',auth,checkRole(["sales_manager","super_admin", "super_sales_manager"]),salemanager.getInvoiceDashboard)
router.get(
  "/state/:state",
  auth,
  checkRole(["admin","sales_manager","super_sales_manager"]),
  salemanager.getBranchesByState
);
router.get(
  "/state",
  auth, 
  checkRole(["admin","sales_manager","super_sales_manager"]),
  salemanager.getStateWiseSales
);


// ye saare parth k screen sales manager ka data provide kr rahi h 

router.get('/getstate',auth, checkRole(["admin","sales_manager","super_sales_manager"]),salemanager.getAllStatesDashboard)
router.get('/getstate/:state',auth, checkRole(["admin","sales_manager","super_sales_manager"]),salemanager.getStateDashboard)
router.get('/branch/:branchId',auth, checkRole(["admin","sales_manager","super_sales_manager"]),salemanager.getBranchDashboard)
router.get('/dashboard/item/:itemId',auth, checkRole(["admin","sales_manager","super_sales_manager"]),salemanager.getItemDashboard )
router.get('/invoice/:invoice_no',auth, checkRole(["admin","sales_manager","super_sales_manager"]),salemanager.getInvoicePDF )

module.exports=router;
