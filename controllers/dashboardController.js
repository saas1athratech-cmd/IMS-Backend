// 📁 controllers/dashboardController.js

const Item = require('../model/item');
const Stock = require('../model/Stock');
const Request = require('../model/Request');
const User = require('../model/user');

exports.getDashboardData = async (req, res) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));

    // 🧮 Total Items
    const totalItems = await Item.countDocuments();

    // 📦 Sales Today (dispatched today)
    const salesToday = await Request.countDocuments({
      status: 'dispatched',
      'timestamps.dispatched': { $gte: startOfToday }
    });

    // 📑 Purchase Orders (approved + dispatched)
    const purchaseOrders = await Request.countDocuments({
      status: { $in: ['approved', 'dispatched'] }
    });

    // ⏳ Pending Requests
    const pendingRequests = await Request.countDocuments({ status: 'requested' });

    // 👤 New Users This Month
    const startOfMonth = new Date(currentYear, now.getMonth(), 1);
    const newUsers = await User.countDocuments({ createdAt: { $gte: startOfMonth } });

    // 💰 Revenue (sum of dispatched value)
    const dispatchedRequests = await Request.find({ status: 'dispatched' }).populate('item');
    let revenue = 0;
    dispatchedRequests.forEach(req => {
      if (req.item && req.item.rate) {
        revenue += req.quantity * req.item.rate;
      }
    });

    // 📈 Monthly Data (for charts)
    const monthlyStats = Array(12).fill(0).map((_, i) => ({
      month: new Date(currentYear, i, 1).toLocaleString('default', { month: 'short' }),
      sales: 0,
      purchase: 0
    }));

    // 1️⃣ Sales (from dispatched requests)
    const allDispatched = await Request.find({
      status: 'dispatched',
      'timestamps.dispatched': { $gte: new Date(currentYear, 0, 1) }
    });

    allDispatched.forEach(req => {
      const month = new Date(req.timestamps.dispatched).getMonth();
      monthlyStats[month].sales += req.quantity;
    });

    // 2️⃣ Purchase (from stock added by admins)
    const allStocks = await Stock.find({
      ownerType: 'admin',
      createdAt: { $gte: new Date(currentYear, 0, 1) }
    });

    allStocks.forEach(stock => {
      const month = new Date(stock.createdAt).getMonth();
      monthlyStats[month].purchase += stock.quantity;
    });

    res.status(200).json({
      stats: {
        totalItems,
        salesToday,
        purchaseOrders,
        pendingRequests,
        newUsers,
        revenue
      },
      chartData: monthlyStats
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load dashboard', error: err.message });
  }
};
