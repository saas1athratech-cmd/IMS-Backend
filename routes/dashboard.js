const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const auth = require('../middleware/auth');
const checkRole = require('../middleware/role');

router.get('/dashboard-summary',  auth, checkRole('admin'), dashboardController.getDashboardData);

module.exports = router;
