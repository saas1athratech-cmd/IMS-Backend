const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const checkRole = require('../middleware/role');

const {
  getAllStockForAdmin,
  getAdminStockSummary,
  getUserStockSummary,
  createOrUpdateStock,
  getAllUsers,getStockByUserId,createOrUpdateStockUser,
} = require('../controllers/stockController');

// Admin-only routes
router.get('/stock-summary', auth, checkRole('admin'), getAdminStockSummary); // admin's own stock
router.get('/all-stock-summary', auth, checkRole('admin'), getAllStockForAdmin); // all users' stock
router.post('/stock-add', auth, checkRole('admin'), createOrUpdateStock);
router.get('/stock-user-summary', auth, checkRole('admin'), getUserStockSummary);
router.get('/get-user', auth, checkRole('admin'), getAllUsers);
router.post('/stock-add-user', auth, checkRole('user'),createOrUpdateStockUser);

// ✅ New route: User can see their own stock
router.get('/user/stock-summary', auth,checkRole('user'), getUserStockSummary);
// router.get('/user/:id/stock', auth, checkRole('admin'), getStockByUserId);
// ✅ New route: User can see their own stock
router.get('/user/:id/stock', auth, checkRole('admin'), getStockByUserId);

module.exports = router;
