const Item = require('../model/item');
const Stock = require('../model/Stock');
const Request = require('../model/Request');
const User = require('../model/user'); 



exports.createOrUpdateStock = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can add/update stock' });
    }

    const { itemName, description, category, quantity, rate, HNBC, unit } = req.body;
    const branch = req.user.branch;

    if (!itemName || quantity == null || rate == null) {
      return res.status(400).json({ message: 'Item name, quantity, and rate are required.' });
    }

    const normalizedItemName = itemName.trim().toLowerCase();

    // 🔍 Find item by name
    let item = await Item.findOne({ name: normalizedItemName });

    if (!item) {
      // ✅ Create new item if doesn't exist
      item = new Item({
        name: normalizedItemName,
        description: description || 'No description provided',
        category: category || 'Uncategorized',
        HNBC,
        unit
      });
      await item.save();
    } else {
      // ✅ Update fields except name
      let changed = false;

      if (description && description !== item.description) {
        item.description = description;
        changed = true;
      }
      if (category && category !== item.category) {
        item.category = category;
        changed = true;
      }
      if (HNBC && HNBC !== item.HNBC) {
        item.HNBC = HNBC;
        changed = true;
      }
      if (unit && unit !== item.unit) {
        item.unit = unit;
        changed = true;
      }

      if (changed) await item.save();
    }

    // ✅ Find existing stock for this item + admin + branch
    let stock = await Stock.findOne({
      item: item._id,
      ownerId: req.user._id,
      ownerType: 'admin',
      branch
    });

    if (stock) {
      // Update existing stock
      stock.quantity = quantity; // replace quantity instead of adding
      stock.rate = rate;
      stock.category = category;
      stock.HNBC = HNBC;
      stock.unit = unit;
    } else {
      // Create new stock only if not present
      stock = new Stock({
        item: item._id,
        quantity,
        rate,
        category,
        branch,
        HNBC,
        unit,
        ownerId: req.user._id,
        ownerType: 'admin'
      });
    }

    await stock.save();

    res.status(200).json({
      message: 'Stock successfully added/updated',
      item,
      updatedStock: stock
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ message: 'Error adding/updating stock', error: error.message });
  }
};


exports.createOrUpdateStockUser = async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ message: 'Only users can add/update stock' });
    }

    const { itemName, description, category, quantity, rate, HNBC, unit } = req.body;
    const branch = req.user.branch;

    if (!itemName || quantity == null || rate == null) {
      return res.status(400).json({ message: 'Item name, quantity, and rate are required.' });
    }

    const normalizedItemName = itemName.trim().toLowerCase();

    // 🔍 Find existing item
    let item = await Item.findOne({ name: normalizedItemName });

    if (!item) {
      // ✅ Create new item (only first time)
      item = new Item({
        name: normalizedItemName,
        description: description || 'No description provided',
        category: category || 'Uncategorized',
        HNBC,
        unit
      });
      await item.save();
    } else {
      // ✅ Update only non-name fields
      let changed = false;

      if (description && description !== item.description) {
        item.description = description;
        changed = true;
      }
      if (category && category !== item.category) {
        item.category = category;
        changed = true;
      }
      if (HNBC && HNBC !== item.HNBC) {
        item.HNBC = HNBC;
        changed = true;
      }
      if (unit && unit !== item.unit) {
        item.unit = unit;
        changed = true;
      }

      if (changed) await item.save();
    }

    // ✅ Find or update user's stock
    let stock = await Stock.findOne({
      item: item._id,
      ownerId: req.user._id,
      ownerType: 'user',
      branch
    });

    if (stock) {
      stock.quantity = quantity; // overwrite instead of adding
      stock.rate = rate;
      stock.category = category;
      stock.HNBC = HNBC;
      stock.unit = unit;
    } else {
      stock = new Stock({
        item: item._id,
        quantity,
        rate,
        category,
        branch,
        HNBC,
        unit,
        ownerId: req.user._id,
        ownerType: 'user'
      });
    }

    await stock.save();

    res.status(200).json({
      message: 'Stock successfully added/updated',
      item,
      updatedStock: stock
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ message: 'Error adding/updating stock', error: error.message });
  }
};




exports.getDashboardSummary = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    const items = await Item.find();
    const stocks = await Stock.find().populate('item');

    const itemMap = {};

    // Group stocks by item
    stocks.forEach(stock => {
      const itemId = stock.item._id.toString();
      if (!itemMap[itemId]) {
        itemMap[itemId] = {
          name: stock.item.name,
          totalQuantity: 0,
          branches: []
        };
      }

      itemMap[itemId].totalQuantity += stock.quantity;
      itemMap[itemId].branches.push({
        branch: stock.branch,
        quantity: stock.quantity
      });
    });

    const itemSummaries = Object.values(itemMap);

    // Request stats
    const total = await Request.countDocuments({ createdAt: { $gte: currentMonthStart } });
    const approved = await Request.countDocuments({ status: 'approved', createdAt: { $gte: currentMonthStart } });
    const dispatched = await Request.countDocuments({ status: 'dispatched', createdAt: { $gte: currentMonthStart } });
    const pending = await Request.countDocuments({ status: 'requested', createdAt: { $gte: currentMonthStart } });

    res.json({
      totalItems: items.length,
      totalQuantity: itemSummaries.reduce((sum, item) => sum + item.totalQuantity, 0),
      items: itemSummaries,
      requests: { total, approved, dispatched, pending }
    });

  } catch (err) {
    res.status(500).json({ message: 'Dashboard failed', error: err.message });
  }
};
// controllers/stockController.js


// ADMIN: Get all stock summary
exports.getAdminStockSummary = async (req, res) => {
   try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Fetch all stocks
    const stocks = await Stock.find()
      .populate('item')
      .populate('ownerId', 'name role')
      .lean();

    if (!stocks.length) {
      return res.status(200).json({
        message: 'No stock available',
        stock: []
      });
    }

    const response = stocks.map(stock => ({
      itemName: stock.item?.name || 'Unknown',
      category: stock.item?.category || 'Other',
      HNBC:stock.item?.HNBC,
      unit:stock.item?.unit,
      description: stock.item?.description || '',
      branch: stock.branch || '-',
      quantity: stock.quantity || 0,
      rate: stock.rate || 0,
      value: stock.value || 0,
      ownerType: stock.ownerType,
      ownerName: stock.ownerId?.name || 'Unknown'
    }));

    res.status(200).json({
      message: 'All Stock Summary',
      totalItems: response.length,
      stock: response
    });

  } catch (err) {
    console.error('❌ Error fetching admin all stock summary:', err);
    res.status(500).json({ message: 'Failed to fetch stock summary', error: err.message });
  }
};





exports.getUserStockSummary = async (req, res) => {
  try {
    const userId = req.user._id.toString(); // ✅ ensure string match
    const branch = req.user.branch;

    const stocks = await Stock.find({
      ownerId: userId,
      ownerType: 'user'
    }).populate('item');

    if (!stocks.length) {
      return res.status(200).json({
        message: "No stock assigned yet",
        user: req.user.name,
        stock: []
      });
    }

    const stockData = stocks.map(s => ({
      itemId:s.item._id,
      itemName: s.item.name,
      category: s.item.category,
      HNBC:s.item.HNBC,
      unit:s.item.unit,
      description: s.item.description,
      quantity: s.quantity,
      rate: s.rate,
      value: s.value
    }));

    const totalValue = stockData.reduce((sum, s) => sum + s.value, 0);

    res.status(200).json({
      user: req.user.name,
      branch,
      totalItems: stockData.length,
      totalValue,
      stock: stockData
    });

  } catch (err) {
    console.error("❌ Error fetching user stock:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};



 // ensure path is correct

exports.getAllUsers = async (req, res) => {
  try {
  
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const users = await User.find().select('-password'); 
    const totalUsers = users.length;

    res.status(200).json({
      totalUsers,
      users
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
};


exports.getAllStockForAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const stocks = await Stock.find().populate('item').populate('ownerId', 'name role'); // show item and owner

    const grouped = {};

    stocks.forEach(stock => {
      const itemId = stock.item._id.toString();
      if (!grouped[itemId]) {
        grouped[itemId] = {
          itemName: stock.item.name,
          category: stock.item.category,
          HNBC:stock.item.HNBC,
          unit:stock.item.unit,
          description: stock.item.description,
          totalQuantity: 0,
          stockDetails: []
        };
      }

      grouped[itemId].totalQuantity += stock.quantity;
     grouped[itemId].stockDetails.push({
  quantity: stock.quantity,
  rate: stock.rate,
  value: stock.value,
  category:stock.category,
  branch: stock.branch,
  ownerName: stock.ownerId?.name || 'Unknown',
  ownerRole: stock.ownerType
});

    });

    res.status(200).json({
      totalItems: Object.keys(grouped).length,
      stocks: Object.values(grouped)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching all stock', error: err.message });
  }
};
exports.getAllUserStockSummary = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    //  Fetch all users except admin (because admin ka already separate hai)
    const users = await User.find({ role: 'user' }).select('_id name branch');

    const response = [];

    for (const user of users) {
      const stocks = await Stock.find({
        ownerId: user._id,
        ownerType: 'user'
      }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        quantity: stock.quantity,
        rate: stock.rate,
        value: stock.value,
        category:stock.category,
        HNBC:stock.item.HNBC,
        unit:stock.item.unit
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      response.push({
        userName: user.name,
        branch: user.branch,
        totalItems: items.length,
        totalValue,
        items
      });
    }

    res.status(200).json({
      message: "All User Stock Summary",
      users: response
    });

  } catch (err) {
    console.error("❌ Error fetching all user stock:", err);
    res.status(500).json({ message: "Error fetching all user stock", error: err.message });
  }
};
exports.getMyStockSummary = async (req, res) => {
  try {
    const user = req.user; // Logged-in user

    if (user.role === 'admin') {
      //  ADMIN VIEW
      const stocks = await Stock.find({ ownerId: user._id, ownerType: 'admin' }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        category: stock.item.category,
            HNBC:stock.item.HNBC,
            
        description: stock.item.description,
        quantity: stock.quantity,
        unit:stock.item.unit,
        rate: stock.rate,
        value: stock.value
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      return res.status(200).json({
        userName: user.name,
        role: "admin",
        totalItems: items.length,
        totalValue,
        items
      });

    } else {
      //  USER VIEW
      const stocks = await Stock.find({ ownerId: user._id, ownerType: 'user' }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        category: stock.item.category,
        HNBC:stock.item.HNBC,
        unit:stock.item.unit,
        description: stock.item.description,
        quantity: stock.quantity,
        rate: stock.rate,
        value: stock.value
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      return res.status(200).json({
        userName: user.name,
        role: "user",
        totalItems: items.length,
        totalValue,
        items
      });
    }

  } catch (err) {
    console.error("❌ Error in stock summary:", err);
    res.status(500).json({ message: "Error fetching stock summary", error: err.message });
  }
};

exports.getMyStockSummary = async (req, res) => {
  try {
    const user = req.user; // Logged-in user

    if (user.role === 'admin') {
      //  ADMIN VIEW
      const stocks = await Stock.find({ ownerId: user._id, ownerType: 'admin' }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        category: stock.item.category,
        HNBC:stock.item.HNBC,
        unit:stock.item.unit,
        description: stock.item.description,
        quantity: stock.quantity,
        rate: stock.rate,
        value: stock.value
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      return res.status(200).json({
        userName: user.name,
        role: "admin",
        totalItems: items.length,
        totalValue,
        items
      });

    } else {
      //  USER VIEW
      const stocks = await Stock.find({ ownerId: user._id, ownerType: 'user' }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        category: stock.item.category,
            HNBC:stock.item.HNBC,
        description: stock.item.description,
        quantity: stock.quantity,
        rate: stock.rate,
        value: stock.value
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      return res.status(200).json({
        userName: user.name,
        role: "user",
        totalItems: items.length,
        totalValue,
        items
      });
    }

  } catch (err) {
    console.error("❌ Error in stock summary:", err);
    res.status(500).json({ message: "Error fetching stock summary", error: err.message });
  }
};

exports.getStockByUserId = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const userId = req.params.id;

    // ✅ Validate ObjectId
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(userId).select('name branch');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const stocks = await Stock.find({
      ownerId: userId,
      ownerType: 'user'
    }).populate('item');

    if (!stocks.length) {
      return res.status(200).json({
        message: "This user has no stock",
        user: user.name,
        stock: []
      });
    }

    const stockData = stocks.map(s => ({
      itemId: s.item._id,
      itemName: s.item.name,
      category: s.item.category || 'not available',
          HNBC:s.item.HNBC|| 'not available',
          unit:s.item.unit,
      description: s.item.description,
      quantity: s.quantity,
      rate: s.rate,
      value: s.value
    }));

    const totalValue = stockData.reduce((sum, s) => sum + s.value, 0);

    res.status(200).json({
      userName: user.name,
      branch: user.branch,
      totalItems: stockData.length,
      totalValue,
      stock: stockData
    });

  } catch (err) {
    console.error("❌ Error fetching user stock by admin:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};






exports.createOrUpdateStock = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can add/update stock' });
    }

    const { itemName, description, category, quantity, rate, HNBC, unit } = req.body;
    const branch = req.user.branch;

    if (!itemName || quantity == null || rate == null) {
      return res.status(400).json({ message: 'Item name, quantity, and rate are required.' });
    }

    const normalizedItemName = itemName.trim().toLowerCase();

    // 🔍 Find item by name
    let item = await Item.findOne({ name: normalizedItemName });

    if (!item) {
      // ✅ Create new item if doesn't exist
      item = new Item({
        name: normalizedItemName,
        description: description || 'No description provided',
        category: category || 'Uncategorized',
        HNBC,
        unit
      });
      await item.save();
    } else {
      // ✅ Update fields except name
      let changed = false;

      if (description && description !== item.description) {
        item.description = description;
        changed = true;
      }
      if (category && category !== item.category) {
        item.category = category;
        changed = true;
      }
      if (HNBC && HNBC !== item.HNBC) {
        item.HNBC = HNBC;
        changed = true;
      }
      if (unit && unit !== item.unit) {
        item.unit = unit;
        changed = true;
      }

      if (changed) await item.save();
    }

    // ✅ Find existing stock for this item + admin + branch
    let stock = await Stock.findOne({
      item: item._id,
      ownerId: req.user._id,
      ownerType: 'admin',
      branch
    });

    if (stock) {
      // Update existing stock
      stock.quantity = quantity; // replace quantity instead of adding
      stock.rate = rate;
      stock.category = category;
      stock.HNBC = HNBC;
      stock.unit = unit;
    } else {
      // Create new stock only if not present
      stock = new Stock({
        item: item._id,
        quantity,
        rate,
        category,
        branch,
        HNBC,
        unit,
        ownerId: req.user._id,
        ownerType: 'admin'
      });
    }

    await stock.save();

    res.status(200).json({
      message: 'Stock successfully added/updated',
      item,
      updatedStock: stock
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ message: 'Error adding/updating stock', error: error.message });
  }
};


exports.createOrUpdateStockUser = async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ message: 'Only users can add/update stock' });
    }

    const { itemName, description, category, quantity, rate, HNBC, unit } = req.body;
    const branch = req.user.branch;

    if (!itemName || quantity == null || rate == null) {
      return res.status(400).json({ message: 'Item name, quantity, and rate are required.' });
    }

    const normalizedItemName = itemName.trim().toLowerCase();

    // 🔍 Find existing item
    let item = await Item.findOne({ name: normalizedItemName });

    if (!item) {
      // ✅ Create new item (only first time)
      item = new Item({
        name: normalizedItemName,
        description: description || 'No description provided',
        category: category || 'Uncategorized',
        HNBC,
        unit
      });
      await item.save();
    } else {
      // ✅ Update only non-name fields
      let changed = false;

      if (description && description !== item.description) {
        item.description = description;
        changed = true;
      }
      if (category && category !== item.category) {
        item.category = category;
        changed = true;
      }
      if (HNBC && HNBC !== item.HNBC) {
        item.HNBC = HNBC;
        changed = true;
      }
      if (unit && unit !== item.unit) {
        item.unit = unit;
        changed = true;
      }

      if (changed) await item.save();
    }

    // ✅ Find or update user's stock
    let stock = await Stock.findOne({
      item: item._id,
      ownerId: req.user._id,
      ownerType: 'user',
      branch
    });

    if (stock) {
      stock.quantity = quantity; // overwrite instead of adding
      stock.rate = rate;
      stock.category = category;
      stock.HNBC = HNBC;
      stock.unit = unit;
    } else {
      stock = new Stock({
        item: item._id,
        quantity,
        rate,
        category,
        branch,
        HNBC,
        unit,
        ownerId: req.user._id,
        ownerType: 'user'
      });
    }

    await stock.save();

    res.status(200).json({
      message: 'Stock successfully added/updated',
      item,
      updatedStock: stock
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ message: 'Error adding/updating stock', error: error.message });
  }
};




exports.getDashboardSummary = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    const items = await Item.find();
    const stocks = await Stock.find().populate('item');

    const itemMap = {};

    // Group stocks by item
    stocks.forEach(stock => {
      const itemId = stock.item._id.toString();
      if (!itemMap[itemId]) {
        itemMap[itemId] = {
          name: stock.item.name,
          totalQuantity: 0,
          branches: []
        };
      }

      itemMap[itemId].totalQuantity += stock.quantity;
      itemMap[itemId].branches.push({
        branch: stock.branch,
        quantity: stock.quantity
      });
    });

    const itemSummaries = Object.values(itemMap);

    // Request stats
    const total = await Request.countDocuments({ createdAt: { $gte: currentMonthStart } });
    const approved = await Request.countDocuments({ status: 'approved', createdAt: { $gte: currentMonthStart } });
    const dispatched = await Request.countDocuments({ status: 'dispatched', createdAt: { $gte: currentMonthStart } });
    const pending = await Request.countDocuments({ status: 'requested', createdAt: { $gte: currentMonthStart } });

    res.json({
      totalItems: items.length,
      totalQuantity: itemSummaries.reduce((sum, item) => sum + item.totalQuantity, 0),
      items: itemSummaries,
      requests: { total, approved, dispatched, pending }
    });

  } catch (err) {
    res.status(500).json({ message: 'Dashboard failed', error: err.message });
  }
};
// controllers/stockController.js


// ADMIN: Get all stock summary
exports.getAdminStockSummary = async (req, res) => {
   try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Fetch all stocks
    const stocks = await Stock.find()
      .populate('item')
      .populate('ownerId', 'name role')
      .lean();

    if (!stocks.length) {
      return res.status(200).json({
        message: 'No stock available',
        stock: []
      });
    }

    const response = stocks.map(stock => ({
      itemName: stock.item?.name || 'Unknown',
      category: stock.item?.category || 'Other',
      HNBC:stock.item?.HNBC,
      unit:stock.item?.unit,
      description: stock.item?.description || '',
      branch: stock.branch || '-',
      quantity: stock.quantity || 0,
      rate: stock.rate || 0,
      value: stock.value || 0,
      ownerType: stock.ownerType,
      ownerName: stock.ownerId?.name || 'Unknown'
    }));

    res.status(200).json({
      message: 'All Stock Summary',
      totalItems: response.length,
      stock: response
    });

  } catch (err) {
    console.error('❌ Error fetching admin all stock summary:', err);
    res.status(500).json({ message: 'Failed to fetch stock summary', error: err.message });
  }
};





exports.getUserStockSummary = async (req, res) => {
  try {
    const userId = req.user._id.toString(); // ✅ ensure string match
    const branch = req.user.branch;

    const stocks = await Stock.find({
      ownerId: userId,
      ownerType: 'user'
    }).populate('item');

    if (!stocks.length) {
      return res.status(200).json({
        message: "No stock assigned yet",
        user: req.user.name,
        stock: []
      });
    }

    const stockData = stocks.map(s => ({
      itemId:s.item._id,
      itemName: s.item.name,
      category: s.item.category,
      HNBC:s.item.HNBC,
      unit:s.item.unit,
      description: s.item.description,
      quantity: s.quantity,
      rate: s.rate,
      value: s.value
    }));

    const totalValue = stockData.reduce((sum, s) => sum + s.value, 0);

    res.status(200).json({
      user: req.user.name,
      branch,
      totalItems: stockData.length,
      totalValue,
      stock: stockData
    });

  } catch (err) {
    console.error("❌ Error fetching user stock:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};



 // ensure path is correct

exports.getAllUsers = async (req, res) => {
  try {
  
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const users = await User.find().select('-password'); 
    const totalUsers = users.length;

    res.status(200).json({
      totalUsers,
      users
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
};


exports.getAllStockForAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const stocks = await Stock.find().populate('item').populate('ownerId', 'name role'); // show item and owner

    const grouped = {};

    stocks.forEach(stock => {
      const itemId = stock.item._id.toString();
      if (!grouped[itemId]) {
        grouped[itemId] = {
          itemName: stock.item.name,
          category: stock.item.category,
          HNBC:stock.item.HNBC,
          unit:stock.item.unit,
          description: stock.item.description,
          totalQuantity: 0,
          stockDetails: []
        };
      }

      grouped[itemId].totalQuantity += stock.quantity;
     grouped[itemId].stockDetails.push({
  quantity: stock.quantity,
  rate: stock.rate,
  value: stock.value,
  category:stock.category,
  branch: stock.branch,
  ownerName: stock.ownerId?.name || 'Unknown',
  ownerRole: stock.ownerType
});

    });

    res.status(200).json({
      totalItems: Object.keys(grouped).length,
      stocks: Object.values(grouped)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching all stock', error: err.message });
  }
};
exports.getAllUserStockSummary = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    //  Fetch all users except admin (because admin ka already separate hai)
    const users = await User.find({ role: 'user' }).select('_id name branch');

    const response = [];

    for (const user of users) {
      const stocks = await Stock.find({
        ownerId: user._id,
        ownerType: 'user'
      }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        quantity: stock.quantity,
        rate: stock.rate,
        value: stock.value,
        category:stock.category,
        HNBC:stock.item.HNBC,
        unit:stock.item.unit
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      response.push({
        userName: user.name,
        branch: user.branch,
        totalItems: items.length,
        totalValue,
        items
      });
    }

    res.status(200).json({
      message: "All User Stock Summary",
      users: response
    });

  } catch (err) {
    console.error("❌ Error fetching all user stock:", err);
    res.status(500).json({ message: "Error fetching all user stock", error: err.message });
  }
};
exports.getMyStockSummary = async (req, res) => {
  try {
    const user = req.user; // Logged-in user

    if (user.role === 'admin') {
      //  ADMIN VIEW
      const stocks = await Stock.find({ ownerId: user._id, ownerType: 'admin' }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        category: stock.item.category,
            HNBC:stock.item.HNBC,
            
        description: stock.item.description,
        quantity: stock.quantity,
        unit:stock.item.unit,
        rate: stock.rate,
        value: stock.value
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      return res.status(200).json({
        userName: user.name,
        role: "admin",
        totalItems: items.length,
        totalValue,
        items
      });

    } else {
      //  USER VIEW
      const stocks = await Stock.find({ ownerId: user._id, ownerType: 'user' }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        category: stock.item.category,
        HNBC:stock.item.HNBC,
        unit:stock.item.unit,
        description: stock.item.description,
        quantity: stock.quantity,
        rate: stock.rate,
        value: stock.value
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      return res.status(200).json({
        userName: user.name,
        role: "user",
        totalItems: items.length,
        totalValue,
        items
      });
    }

  } catch (err) {
    console.error("❌ Error in stock summary:", err);
    res.status(500).json({ message: "Error fetching stock summary", error: err.message });
  }
};

exports.getMyStockSummary = async (req, res) => {
  try {
    const user = req.user; // Logged-in user

    if (user.role === 'admin') {
      //  ADMIN VIEW
      const stocks = await Stock.find({ ownerId: user._id, ownerType: 'admin' }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        category: stock.item.category,
        HNBC:stock.item.HNBC,
        unit:stock.item.unit,
        description: stock.item.description,
        quantity: stock.quantity,
        rate: stock.rate,
        value: stock.value
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      return res.status(200).json({
        userName: user.name,
        role: "admin",
        totalItems: items.length,
        totalValue,
        items
      });

    } else {
      //  USER VIEW
      const stocks = await Stock.find({ ownerId: user._id, ownerType: 'user' }).populate('item');

      const items = stocks.map(stock => ({
        itemName: stock.item.name,
        category: stock.item.category,
            HNBC:stock.item.HNBC,
        description: stock.item.description,
        quantity: stock.quantity,
        rate: stock.rate,
        value: stock.value
      }));

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);

      return res.status(200).json({
        userName: user.name,
        role: "user",
        totalItems: items.length,
        totalValue,
        items
      });
    }

  } catch (err) {
    console.error("❌ Error in stock summary:", err);
    res.status(500).json({ message: "Error fetching stock summary", error: err.message });
  }
};

exports.getStockByUserId = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const userId = req.params.id;

    // ✅ Validate ObjectId
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(userId).select('name branch');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const stocks = await Stock.find({
      ownerId: userId,
      ownerType: 'user'
    }).populate('item');

    if (!stocks.length) {
      return res.status(200).json({
        message: "This user has no stock",
        user: user.name,
        stock: []
      });
    }

    const stockData = stocks.map(s => ({
      itemId: s.item._id,
      itemName: s.item.name,
      category: s.item.category || 'not available',
          HNBC:s.item.HNBC|| 'not available',
          unit:s.item.unit,
      description: s.item.description,
      quantity: s.quantity,
      rate: s.rate,
      value: s.value
    }));

    const totalValue = stockData.reduce((sum, s) => sum + s.value, 0);

    res.status(200).json({
      userName: user.name,
      branch: user.branch,
      totalItems: stockData.length,
      totalValue,
      stock: stockData
    });

  } catch (err) {
    console.error("❌ Error fetching user stock by admin:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
