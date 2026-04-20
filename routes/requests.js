const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/role');
const Request = require('../model/Request');
const Item = require('../model/item');

const {
  createRequest,
  getAllRequests,
  approveRequest,
  rejectRequest,
  dispatchRequest,
  getDispatchCount,
  getDispatchSummary,
  getDispatchSummaryPDF,
  getOrderStatusReport,
  addSale,
  getSales,
  downloadSalesPdf,
  getInvoice,
  uploadInvoice,
  getMyRequests,getAllDispatches, superAdminMonitor,createRequestFromFR
} = require('../controllers/requestController');


// 🟢 USER ROUTES
router.post('/R-M', auth, checkRole('user'), createRequest);
router.post('/add-sales', auth, checkRole('user'), addSale);
router.get('/orders/status-report', auth, checkRole('user'), getOrderStatusReport);
router.get('/get-sales', auth, checkRole('user'), getSales);
router.get('/get-sales-pdf', auth, checkRole('user'), downloadSalesPdf);
router.get('/requests/my', auth, checkRole('user'), getMyRequests);


//  ADMIN ROUTES
router.get('/R-Me', auth, checkRole('admin'), getAllRequests);
router.put('/:id/approve', auth, checkRole('admin'), approveRequest);
router.put('/:id/reject', auth, checkRole('admin'), rejectRequest);
router.put('/:id/dispatch', auth, checkRole('admin'), dispatchRequest);
router.get('/sales', auth, checkRole('admin'), getDispatchCount);
router.get('/sales-summary', auth, checkRole('admin'), getDispatchSummary);
router.get('/sales-summary-pdf', auth, checkRole('admin'), getDispatchSummaryPDF);
router.post('/requests/:id/upload-invoice', auth, checkRole('admin'), uploadInvoice);

//  SUPER ADMIN ROUTE
router.get('/superadmin/monitor', auth, checkRole('superadmin'), superAdminMonitor);

//  Download a specific invoice by Request ID
router.get('/requests/:id/invoice', auth, getInvoice);

//  Download the latest invoice automatically for current user/admin
router.get('/requests/invoice', auth, getInvoice);

router.get('/all-dispatch', auth,getAllDispatches);
// ( Removed duplicate inline route definition)



router.post('/from-fr',createRequestFromFR)

module.exports = router;
