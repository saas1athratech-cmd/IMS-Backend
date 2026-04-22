const { Branch, User, Role, Stock, sequelize, Ledger,  ClientLedger,
 
  QuotationItem } = require("../../model/SQL_Model");
const { Op } = require("sequelize");
const StockMovement = require("../../model/SQL_Model/stockmovement");
const bcrypt = require("bcryptjs");
const { encryptPassword } = require("../../utils/crypto"); 
const { decryptPassword } = require("../../utils/crypto");
function getDateFilter(range) {
  const now = new Date();

  if (range === "day") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return { [Op.gte]: start };
  }

  if (range === "week") {
    const start = new Date();
    start.setDate(start.getDate() - 7);

    return { [Op.gte]: start };
  }

  if (range === "month") {
    const start = new Date();
    start.setMonth(start.getMonth() - 1);

    return { [Op.gte]: start };
  }

  return null;
}



 generatePassword = () => {
  return Math.random().toString(36).slice(-8);
};

exports.createBranch = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { name, code, location, type, state } = req.body;

    if (!name || !code || !location || !type || !state) {
      return res.status(400).json({
        error: "All branch fields required"
      });
    }

    const exists = await Branch.findOne({
      where: {
        [Op.or]: [{ name }, { code }]
      }
    });

    if (exists) {
      return res.status(400).json({
        error: "Branch already exists"
      });
    }

    const branch = await Branch.create(
      {
        name,
        code,
        location,
        type,
        state,
        status: "ACTIVE"
      },
      { transaction: t }
    );

    const roles = await Role.findAll();

    const roleMap = {};
    roles.forEach(r => {
      roleMap[r.name] = r.id;
    });

    const usersToCreate = [
      { role: "admin", prefix: "admin" },
      { role: "sales_manager", prefix: "sales" },
      { role: "inventory_manager", prefix: "inventory" }
    ];

    const createdUsers = [];

    for (const u of usersToCreate) {
      if (!roleMap[u.role]) {
        throw new Error(`${u.role} role not found in DB`);
      }

      const plainPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(plainPassword, 10);
      const encryptedPassword = encryptPassword(plainPassword);

      const email = `${u.prefix}_${code}@company.com`;

      const user = await User.create(
        {
          name: `${name} ${u.role}`,
          email,
          password: hashedPassword,        // 🔐 login
          secure_password: encryptedPassword, // 👁️ super admin
          role_id: roleMap[u.role],
          branch_id: branch.id
        },
        { transaction: t }
      );

      createdUsers.push({
        role: u.role,
        email,
        password: plainPassword // 👈 ek baar show
      });
    }

    await t.commit();

    res.status(201).json({
      message: "Branch + Users created successfully",
      branch,
      users: createdUsers
    });

  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

exports.getBranchUsersWithPassword = async (req, res) => {
  try {
    const role = req.user?.role?.name || req.user?.role || "";

    if (role !== "super_admin") {
      return res.status(403).json({
        success: false,
        error: "Access denied"
      });
    }

    const rawBranchId = req.params.branch_id;
    const branchId = rawBranchId ? Number(rawBranchId) : null;

    if (branchId !== null && isNaN(branchId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid branch_id"
      });
    }

    const where = {
      "$role.name$": [
        "admin",
        "sales_manager",
        "inventory_manager"
      ]
    };

    if (branchId !== null) {
      where.branch_id = branchId;
    }

    const users = await User.findAll({
      include: [
        {
          model: Role,
          as: "role",
          attributes: ["name"]
        }
      ],
      where,
      attributes: [
        "id",
        "name",
        "email",
        "branch_id",
        "secure_password"
      ],
      raw: true,
      nest: true
    });

    const result = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role?.name || null,
      branch_id: u.branch_id,
      password: u.secure_password
        ? decryptPassword(u.secure_password)
        : null
    }));

    return res.json({
      success: true,
      branch_id: branchId,
      total: result.length,
      users: result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
exports.resetUserPassword = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    const { userId } = req.body;

    const newPassword = generatePassword();
    const hashed = await bcrypt.hash(newPassword, 10);
    const encrypted = encryptPassword(newPassword);

    await User.update(
      {
        password: hashed,
        secure_password: encrypted
      },
      { where: { id: userId } }
    );

    res.json({
      userId,
      password: newPassword
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getAllBranches = async (req, res) => {
  try {
    const branches = await Branch.findAll();

    res.status(200).json({
      message: "Branches fetched successfully",
      total: branches.length,
      branches
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getGlobalDashboard = async (req, res) => {
  try {
    // ✅ FIXED ROLE CHECK
    if (!superRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    const totalUsers = await User.count();
    const totalBranches = await Branch.count();

    const locations = await Branch.findAll({
      attributes: [
        "location",

        [sequelize.fn("COUNT", sequelize.col("Branch.id")), "total_branches"],

        [
          sequelize.fn(
            "COALESCE",
            sequelize.fn("SUM", sequelize.col("stocks.quantity")),
            0
          ),
          "total_stock"
        ],

        [
          sequelize.fn(
            "COALESCE",
            sequelize.fn("SUM", sequelize.col("stocks.value")),
            0
          ),
          "total_value"
        ]
      ],

      include: [
        {
          model: Stock,
          as: "stocks",
          attributes: []
        }
      ],

      group: ["location"],
      order: [["location", "ASC"]],
      raw: true
    });

    res.json({
      stats: {
        totalUsers,
        totalBranches
      },
      locations
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getLocationDashboard = async (req, res) => {
  try {
    const { location } = req.params;

    const branches = await Branch.findAll({
      where: { location },

      attributes: [
        "id",
        "name",
        "code",

        [
          sequelize.fn(
            "COALESCE",
            sequelize.fn("SUM", sequelize.col("stocks.quantity")),
            0
          ),
          "total_stock"
        ],

        [
          sequelize.fn(
            "COALESCE",
            sequelize.fn("SUM", sequelize.col("stocks.value")),
            0
          ),
          "total_value"
        ]
      ],

      include: [
        {
          model: Stock,
          as: "stocks",
          attributes: []
        }
      ],

      group: ["Branch.id"],
      subQuery: false
    });

    res.json({
      location,
      totalBranches: branches.length,
      branches
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBranchDashboard = async (req, res) => {
  try {
    const user = req.user;
    const requestedBranchId = parseInt(req.params.branchId);

    console.log("USER:", user);
    console.log("REQUESTED:", requestedBranchId);

    // =========================
    // 🔐 FINAL SECURITY CHECK (FIXED)
    // =========================
    const isSuper = user.branches?.[0] === "ALL";

    if (!isSuper) {
      // 👇 agar branches array nahi hai to fallback
      if (user.branches?.length) {
        if (!user.branches.includes(requestedBranchId)) {
          return res.status(403).json({ error: "❌ Access Denied - Wrong Branch" });
        }
      } else {
        // 👇 most important fix (branch admin case)
        if (user.branch_id !== requestedBranchId) {
          return res.status(403).json({ error: "❌ Access Denied - Wrong Branch" });
        }
      }
    }

    // =========================
    // 🔥 FORCE BRANCH (SAFE)
    // =========================
    const finalBranchId = isSuper
      ? requestedBranchId
      : (user.branch_id || requestedBranchId);

    console.log("FINAL BRANCH USED:", finalBranchId);

    // =========================
    // FETCH BASIC DATA
    // =========================
    const branch = await Branch.findByPk(finalBranchId);

    const stocks = await Stock.findAll({
      where: { branch_id: finalBranchId },
    });

    const users = await User.findAll({
      where: { branch_id: finalBranchId },
    });

    // =========================
    // CALCULATE STATS
    // =========================
    const totalStock = stocks.reduce((sum, i) => sum + i.quantity, 0);
    const totalValue = stocks.reduce((sum, i) => sum + i.value, 0);

    const totalSales =
      (await Ledger.sum("total", {
        where: { branch_id: finalBranchId, type: "SALE" },
      })) || 0;

    const agingItems = stocks.filter((s) => s.aging > 5).length;

    // =========================
    // CHARTS DATA
    // =========================

    const stockMovement = await StockMovement.findAll({
      where: { branch_id: finalBranchId },
      attributes: [
        [sequelize.literal(`TO_CHAR("StockMovement"."created_at",'IW')`), "week"],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(
              `CASE WHEN "StockMovement"."type"='IN' THEN quantity ELSE 0 END`
            )
          ),
          "stockIn",
        ],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(
              `CASE WHEN "StockMovement"."type"='OUT' THEN quantity ELSE 0 END`
            )
          ),
          "stockOut",
        ],
      ],
      group: [sequelize.literal(`TO_CHAR("StockMovement"."created_at",'IW')`)],
      order: [[sequelize.literal(`TO_CHAR("StockMovement"."created_at",'IW')`), "ASC"]],
      raw: true,
    });

    const barChart = stockMovement.map((d, i) => ({
      week: `Week ${i + 1}`,
      stockIn: Number(d.stockIn),
      stockOut: Number(d.stockOut),
    }));

    const salesData = await Ledger.findAll({
      where: { branch_id: finalBranchId },
      attributes: [
        [sequelize.literal(`TO_CHAR("Ledger"."createdAt",'IW')`), "week"],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`CASE WHEN "Ledger"."type"='SALE' THEN total ELSE 0 END`)
          ),
          "sales",
        ],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`CASE WHEN "Ledger"."type"='PURCHASE' THEN total ELSE 0 END`)
          ),
          "purchase",
        ],
      ],
      group: [sequelize.literal(`TO_CHAR("Ledger"."createdAt",'IW')`)],
      order: [[sequelize.literal(`TO_CHAR("Ledger"."createdAt",'IW')`), "ASC"]],
      raw: true,
    });

    const lineChart = salesData.map((d, i) => ({
      week: `Week ${i + 1}`,
      stockIn: Number(d.sales),
      stockOut: Number(d.purchase),
    }));

    // =========================
    // FINAL RESPONSE
    // =========================
    res.json({
      branchUsed: finalBranchId,
      branchInfo: branch,
      stats: {
        totalStock,
        totalValue,
        totalSales,
        agingItems,
      },
      charts: {
        stockMovement: barChart,
        salesTrend: lineChart,
      },
      stocks,
      users,
    });

  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.getAdminDashboard = async (req, res) => {
  try {

  
    const totalUsers = await User.count();

  
    const totalStock = await Stock.sum("quantity");

    const totalBranches = await Branch.count();

 
    const totalStockValue = await Stock.sum("value");

    const weeklyAnalytics = await Stock.findAll({
      attributes: [
        [sequelize.fn("DATE", sequelize.col("created_at")), "date"],
        [sequelize.fn("SUM", sequelize.col("value")), "total"]
      ],
      group: ["date"],
      order: [["date", "ASC"]],
      raw: true
    });

    const stockDistribution = await Stock.findAll({
      attributes: [
        "item",
        [sequelize.fn("SUM", sequelize.col("quantity")), "total_quantity"]
      ],
      group: ["item"],
      raw: true
    });

 
    const branchOverview = await Branch.findAll({
      include: [
        {
          model: User,
          as: "users",
          attributes: ["id"]
        }
      ]
    });

    res.json({
      stats: {
        totalUsers,
        totalStock,
        totalBranches,
        totalStockValue
      },
      weeklyAnalytics,
      stockDistribution,
      branchOverview
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// const { Branch, User, Stock, sequelize } = require("../../model/SQL_Model");

exports.getSuperAdminDashboard = async (req, res) => {
  try {
    const user = req.user;

    // =========================
    // 🔑 ROLE CHECK
    // =========================
    const isSuperAdmin =
      user.role === "super_admin" || user.branches?.[0] === "ALL";

    // =========================
    // 🔑 BRANCH FILTER
    // =========================
    let branchFilter = {};

    if (!isSuperAdmin) {
      branchFilter = {
        branch_id: user.branch_id
      };
    }

    // =========================
    // 🔹 TOP STATS
    // =========================
    const totalUsers = isSuperAdmin
      ? await User.count()
      : await User.count({ where: { branch_id: user.branch_id } });

    const totalBranches = isSuperAdmin ? await Branch.count() : 1;

    const totalStock =
      (await Stock.sum("quantity", { where: branchFilter })) || 0;

    const totalStockValue =
      (await Stock.sum("value", { where: branchFilter })) || 0;

    const totalSales =
      (await Ledger.sum("total", {
        where: { ...branchFilter, type: "SALE" }
      })) || 0;

    // =========================
    // 🔹 SALES ANALYTICS
    // =========================
    const salesData = await Ledger.findAll({
      attributes: [
        [sequelize.fn("DATE", sequelize.col("createdAt")), "date"],
        [sequelize.fn("SUM", sequelize.col("total")), "total"]
      ],
      where: { ...branchFilter, type: "SALE" },
      group: [sequelize.fn("DATE", sequelize.col("createdAt"))],
      order: [[sequelize.fn("DATE", sequelize.col("createdAt")), "ASC"]],
      raw: true
    });

    const purchaseData = await Ledger.findAll({
      attributes: [
        [sequelize.fn("DATE", sequelize.col("createdAt")), "date"],
        [sequelize.fn("SUM", sequelize.col("total")), "total"]
      ],
      where: { ...branchFilter, type: "PURCHASE" },
      group: [sequelize.fn("DATE", sequelize.col("createdAt"))],
      order: [[sequelize.fn("DATE", sequelize.col("createdAt")), "ASC"]],
      raw: true
    });

    // =========================
    // 🔹 STOCK DISTRIBUTION
    // =========================
    const stockRaw = await Stock.findAll({
      attributes: [
        "category",
        [sequelize.fn("SUM", sequelize.col("quantity")), "total"]
      ],
      where: branchFilter,
      group: ["category"],
      raw: true
    });

    const totalCategoryStock = stockRaw.reduce(
      (sum, i) => sum + Number(i.total),
      0
    );

    const stockDistribution = stockRaw.map((i) => ({
      category: i.category || "Others",
      total: Number(i.total),
      percentage: totalCategoryStock
        ? ((i.total / totalCategoryStock) * 100).toFixed(1)
        : 0
    }));

    // =========================
    // 🔹 BRANCH OVERVIEW (ONLY SUPER ADMIN)
    // =========================
    let branchOverview = [];

    if (isSuperAdmin) {
      const branches = await Branch.findAll({
        attributes: [
          "id",
          "name",
          [
            sequelize.fn(
              "COALESCE",
              sequelize.fn("SUM", sequelize.col("stocks.quantity")),
              0
            ),
            "stockItems"
          ],
          [
            sequelize.fn(
              "COALESCE",
              sequelize.fn("SUM", sequelize.col("stocks.value")),
              0
            ),
            "purchase"
          ]
        ],
        include: [
          {
            model: Stock,
            as: "stocks",
            attributes: []
          }
        ],
        group: ["Branch.id"],
        raw: true
      });

      branchOverview = branches.map((b) => ({
        branchName: b.name,
        stockItems: Number(b.stockItems),
        purchase: Number(b.purchase),
        sale: Math.floor(Number(b.purchase) * 0.4),
        stockIn: Number(b.stockItems),
        stockOut: Math.floor(Number(b.stockItems) * 0.3)
      }));
    }

    // =========================
    // 🔹 RECENT ACTIVITIES
    // =========================
    const ledgerActivities = await Ledger.findAll({
      where: branchFilter,
      limit: 5,
      order: [["createdAt", "DESC"]],
      raw: true
    });

    const userActivities = await User.findAll({
      where: isSuperAdmin ? {} : { branch_id: user.branch_id },
      limit: 2,
      order: [["createdAt", "DESC"]],
      raw: true
    });

    const stockActivities = await Stock.findAll({
      where: branchFilter,
      limit: 2,
      order: [["updatedAt", "DESC"]],
      raw: true
    });

    let activities = [];

    userActivities.forEach((u) => {
      activities.push({
        title: "User Registered",
        description: u.name || "New User",
        time: u.createdAt,
        type: "user",
        icon: "user"
      });
    });

    stockActivities.forEach((s) => {
      activities.push({
        title: "Stock Updated",
        description: s.item || "Stock Item",
        time: s.updatedAt,
        type: "stock",
        icon: "box"
      });
    });

    ledgerActivities.forEach((l) => {
      activities.push({
        title:
          l.type === "SALE"
            ? "Sales Transaction"
            : "Purchase Entry",
        description: `₹${l.total}`,
        time: l.createdAt,
        type: l.type.toLowerCase(),
        icon: l.type === "SALE" ? "dollar" : "cart"
      });
    });

    const recentActivities = activities
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 5);

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    res.json({
      stats: {
        totalUsers,
        totalStock,
        totalBranches,
        totalSales,
        totalStockValue
      },
      salesAnalytics: {
        sales: salesData,
        purchase: purchaseData
      },
      stockDistribution,
      branchOverview,
      recentActivities
    });

  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};


exports.getBranchAnalytics = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { range = "month" } = req.query;

    let dateFilter = {};

    if (range === "day") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      dateFilter = { created_at: { [Op.gte]: start } };
    }

    if (range === "week") {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      dateFilter = { created_at: { [Op.gte]: start } };
    }

    if (range === "month") {
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      dateFilter = { created_at: { [Op.gte]: start } };
    }

    const where = {
      branch_id: branchId,
      ...dateFilter
    };

   
    const barChart = await Stock.findAll({
      where,
      attributes: [
        [sequelize.fn("DATE", sequelize.col("created_at")), "date"],
        [sequelize.fn("SUM", sequelize.col("quantity")), "stockIn"]
      ],
      group: ["date"],
      order: [["date", "ASC"]],
      raw: true
    });

    
    const lineChart = await Stock.findAll({
      where,
      attributes: [
        [sequelize.fn("DATE", sequelize.col("created_at")), "date"],
        [sequelize.fn("SUM", sequelize.col("value")), "totalValue"]
      ],
      group: ["date"],
      order: [["date", "ASC"]],
      raw: true
    });


    const pieChart = await Stock.findAll({
      where,
      attributes: [
        "item",
        [sequelize.fn("SUM", sequelize.col("quantity")), "qty"]
      ],
      group: ["item"],
      raw: true
    });

 
    res.json({
      filter: range,

      charts: {
        barChart,
        lineChart,
        pieChart
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getAllUsersForDashboard = async (req, res) => {
  try {
    const user = req.user;

    let whereCondition = {};

    // =========================
    // ROLE + BRANCH LOGIC
    // =========================
    if (user.role === "super_admin") {
      whereCondition = {};
    } else if (user.role === "admin") {
      whereCondition.branch_id = user.branch_id;
    } else {
      if (user.branches?.[0] !== "ALL") {
        whereCondition.branch_id = {
          [Op.in]: user.branches || [],
        };
      }
    }

    const users = await User.findAll({
      where: whereCondition,
      attributes: [
        "id",
        "name",
        "email",
        "phone",
        "address",
        "profile_image",
        "profile_image_public_id",
        "is_profile_set",
        "created_at",
        "branch_id",
        "last_login",
        "is_active",
        "recovery_email",
        "recovery_phone",
        "password_changed_at",
      ],
      include: [
        {
          association: "role",
          attributes: ["id", "name"],
        },
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "location"],
          required: false,
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const result = users.map((u) => {
      const createdAt = u.created_at ? new Date(u.created_at) : null;

      const aging = createdAt
        ? Math.floor(
            (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone || null,
        address: u.address || null,
        profile_image: u.profile_image || null,
        profile_image_public_id: u.profile_image_public_id || null,
        is_profile_set: u.is_profile_set ?? false,
        role: u.role?.name || null,
        role_id: u.role?.id || u.role_id || null,
        branch_id: u.branch_id || null,
        branch: u.branch?.name || null,
        branch_location: u.branch?.location || null,
        aging,
        created_at: u.created_at || null,
        lastLogin: u.last_login || null,
        isActive: u.is_active,
        recovery_email: u.recovery_email || null,
        recovery_phone: u.recovery_phone || null,
        password_changed_at: u.password_changed_at || null,
      };
    });

    return res.json({
      totalUsers: result.length,
      users: result,
    });
  } catch (err) {
    console.error("ERROR in getAllUsersForDashboard:", err);
    return res.status(500).json({ error: err.message });
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ toggle
    user.is_active = !user.is_active;

    await user.save();

    res.json({
      message: `User ${user.is_active ? "Activated" : "Deactivated"} successfully`,
      is_active: user.is_active
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBranchOverview = async (req, res) => {
  try {

    // =========================
    // 🔹 CARDS
    // =========================
    const totalStock = (await Stock.sum("quantity")) || 0;
    const totalStockValue = (await Stock.sum("value")) || 0;

    const totalSales =
      (await Ledger.sum("total", { where: { type: "SALE" } })) || 0;

    const agingItems =
      (await Stock.count({
        where: { quantity: { [Op.lt]: 50 } }
      })) || 0;

    // =========================
    // 🔹 STOCK STATUS
    // =========================
    const stockStatusRaw = await Stock.findAll({
      attributes: [
        "status",
        [sequelize.fn("COUNT", sequelize.col("id")), "count"]
      ],
      group: ["status"],
      raw: true
    });

    const stockStatus = {
      GOOD: 0,
      DAMAGED: 0,
      REPAIRABLE: 0
    };

    stockStatusRaw.forEach((s) => {
      stockStatus[s.status] = Number(s.count);
    });

    // =========================
    // 🔹 BAR GRAPH (FIXED)
    // =========================
    const barGraphRaw = await StockMovement.findAll({
      attributes: [
        [
          sequelize.literal(`TO_CHAR("created_at", 'IW')`),
          "week"
        ],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`CASE WHEN type='IN' THEN quantity ELSE 0 END`)
          ),
          "stockIn"
        ],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`CASE WHEN type='OUT' THEN quantity ELSE 0 END`)
          ),
          "stockOut"
        ]
      ],
      group: [sequelize.literal(`TO_CHAR("created_at", 'IW')`)],
      order: [[sequelize.literal(`TO_CHAR("created_at", 'IW')`), "ASC"]],
      raw: true
    });

    const barGraph = barGraphRaw.map((d, i) => ({
      week: `Week ${i + 1}`,
      stockIn: Number(d.stockIn),
      stockOut: Number(d.stockOut)
    }));

    // =========================
    // 🔹 LINE GRAPH
    // =========================
    const lineGraph = barGraph.map((d) => ({
      week: d.week,
      stockIn: d.stockIn,
      stockOut: d.stockOut
    }));

    // =========================
    // 🔹 BRANCH DATA (STATE INCLUDED)
    // =========================
    const branches = await Branch.findAll({
      attributes: [
        "id",
        "name",
        "state", // ✅ ADDED

        [
          sequelize.fn(
            "COALESCE",
            sequelize.fn("SUM", sequelize.col("stocks.quantity")),
            0
          ),
          "stockItems"
        ],

        [
          sequelize.fn(
            "COALESCE",
            sequelize.fn("SUM", sequelize.col("stocks.value")),
            0
          ),
          "purchase"
        ]
      ],
      include: [
        {
          model: Stock,
          as: "stocks",
          attributes: []
        }
      ],
      group: ["Branch.id", "Branch.name", "Branch.state"], // ✅ FIXED
      raw: true
    });

    // =========================
    // 🔹 STOCK MOVEMENT MAP
    // =========================
    const movement = await StockMovement.findAll({
      attributes: [
        "branch_id",
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`CASE WHEN type='IN' THEN quantity ELSE 0 END`)
          ),
          "stockIn"
        ],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`CASE WHEN type='OUT' THEN quantity ELSE 0 END`)
          ),
          "stockOut"
        ]
      ],
      group: ["branch_id"],
      raw: true
    });

    const movementMap = {};
    movement.forEach((m) => {
      movementMap[m.branch_id] = {
        stockIn: Number(m.stockIn),
        stockOut: Number(m.stockOut)
      };
    });

    // =========================
    // 🔹 FORMAT ₹
    // =========================
    const formatRupee = (num) => {
      if (!num) return "₹ 0";
      return `₹ ${(num / 100000).toFixed(0)} Lakhs`;
    };

    // =========================
    // 🔹 FINAL TABLE
    // =========================
    const branchData = branches.map((b) => {
      const move = movementMap[b.id] || { stockIn: 0, stockOut: 0 };

      return {
        branchName: b.name,
        state: b.state, // ✅ NOW INCLUDED

        stockItems:
          Number(b.stockItems) >= 1000
            ? `${Math.floor(Number(b.stockItems) / 1000)}K`
            : Number(b.stockItems),

        purchase: formatRupee(Number(b.purchase)),

        // TEMP (can replace with real sales)
        sale: formatRupee(Number(b.purchase)),

        stockIn:
          move.stockIn >= 1000
            ? `${Math.floor(move.stockIn / 1000)}K`
            : move.stockIn,

        stockOut:
          move.stockOut >= 1000
            ? `${Math.floor(move.stockOut / 1000)}K`
            : move.stockOut
      };
    });

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    res.json({
      cards: {
        totalStock,
        totalStockValue,
        totalSales,
        agingItems
      },
      barGraph,
      lineGraph,
      stockStatus,
      branches: branchData
    });

  } catch (err) {
    console.error("BRANCH OVERVIEW ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};


exports.getSuperAdminAnalytics = async (req, res) => {
  try {
    const { range = "week" } = req.query;

    let dateFilter = {};

    if (range === "day") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      dateFilter = { created_at: { [Op.gte]: start } };
    }

    if (range === "week") {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      dateFilter = { created_at: { [Op.gte]: start } };
    }

    if (range === "month") {
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      dateFilter = { created_at: { [Op.gte]: start } };
    }


    const lineChart = await Stock.findAll({
      where: dateFilter,
      attributes: [
        [sequelize.fn("DATE", sequelize.col("created_at")), "date"],
        [sequelize.fn("SUM", sequelize.col("value")), "stockIn"]
      ],
      group: ["date"],
      order: [["date", "ASC"]],
      raw: true
    });

  
    const lineData = lineChart.map((d) => ({
      date: d.date,
      stockIn: Number(d.stockIn),
      stockOut: Math.floor(Number(d.stockIn) * 0.6)
    }));

 
    const pieChart = await Stock.findAll({
      where: dateFilter,
      attributes: [
        "category",
        [sequelize.fn("SUM", sequelize.col("quantity")), "qty"]
      ],
      group: ["category"],
      raw: true
    });

    const pieData = pieChart.map((p) => ({
      name: p.category || "General",
      value: Number(p.qty)
    }));

    res.json({
      charts: {
        lineChart: lineData,
        pieChart: pieData
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getLocationWiseSummary = async (req, res) => {
  try {
    const locations = await Branch.findAll({
      attributes: [
        "location",

        // total branches per location
        [
          sequelize.fn("COUNT", sequelize.col("Branch.id")),
          "totalBranches"
        ],

        // total users per location
        [
          sequelize.fn(
            "COUNT",
            sequelize.fn("DISTINCT", sequelize.col("users.id"))
          ),
          "totalUsers"
        ],

        // total stock quantity per location
        [
          sequelize.fn(
            "COALESCE",
            sequelize.fn("SUM", sequelize.col("stocks.quantity")),
            0
          ),
          "totalStock"
        ],

        // total stock value per location
        [
          sequelize.fn(
            "COALESCE",
            sequelize.fn("SUM", sequelize.col("stocks.value")),
            0
          ),
          "totalStockValue"
        ]
      ],

      include: [
        {
          model: Stock,
          as: "stocks",
          attributes: []
        },
        {
          model: User,
          as: "users",
          attributes: []
        }
      ],

      group: ["location"],
      order: [["location", "ASC"]],
      raw: true
    });

    res.json({
      totalLocations: locations.length,
      locations
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};




exports.getReportsAnalytics = async (req, res) => {
  try {

    // 🔹 USER INFO
    const { role, branches } = req.user;
    const isSuperAdmin = role === "super_admin";

    // =========================
    // 🔹 FILTERS
    // =========================

    // Ledger uses association with Branch
    const ledgerWhere = isSuperAdmin
      ? {}
      : { "$branch.id$": { [Op.in]: branches } };

    // Stock uses direct column: branch_id
    const stockWhere = isSuperAdmin
      ? {}
      : { branch_id: { [Op.in]: branches } };

    // =========================
    // 🔹 1. SALES / PURCHASE TREND
    // =========================
    const trendRaw = await Ledger.findAll({
      attributes: [
        [sequelize.col("branch.name"), "branch"],

        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`
              CASE 
                WHEN "Ledger"."type"='SALE' 
                THEN "Ledger"."total" 
                ELSE 0 
              END
            `)
          ),
          "sales"
        ],

        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`
              CASE 
                WHEN "Ledger"."type"='PURCHASE' 
                THEN "Ledger"."total" 
                ELSE 0 
              END
            `)
          ),
          "purchase"
        ]
      ],

      include: [
        {
          model: Branch,
          as: "branch",
          attributes: [],
          required: true
        }
      ],

      where: ledgerWhere,
      group: ["branch.name"],
      raw: true
    });

    const trendChart = trendRaw.map((t) => ({
      name: t.branch,
      repairable: Number(t.sales),
      scrap: Number(t.purchase)
    }));

    // =========================
    // 🔹 2. SCRAP & REPAIRABLE
    // =========================
    const scrapRaw = await Stock.findAll({
      attributes: [
        "category",

        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`
              CASE 
                WHEN status='REPAIRABLE' 
                THEN quantity 
                ELSE 0 
              END
            `)
          ),
          "repairable"
        ],

        [
          sequelize.fn(
            "SUM",
            sequelize.literal(`
              CASE 
                WHEN status='DAMAGED' 
                THEN quantity 
                ELSE 0 
              END
            `)
          ),
          "scrap"
        ]
      ],

      where: stockWhere,
      group: ["category"],
      raw: true
    });

    const scrapChart = scrapRaw.map((s) => ({
      category: s.category || "Others",
      repairable: Number(s.repairable),
      scrap: Number(s.scrap)
    }));

    // =========================
    // 🔹 3. TRANSIT GOODS
    // =========================
    const transitRaw = await Stock.findAll({
      attributes: [
        "category",
        [sequelize.fn("SUM", sequelize.col("quantity")), "total"]
      ],

      where: stockWhere,
      group: ["category"],
      raw: true
    });

    const totalQty = transitRaw.reduce(
      (sum, i) => sum + Number(i.total),
      0
    );

    const transitChart = transitRaw.map((t) => ({
      name: t.category,
      value: Number(t.total),
      percentage: totalQty
        ? ((t.total / totalQty) * 100).toFixed(1)
        : 0
    }));

    // =========================
    // 🔹 4. REPORTS TABLE
    // =========================
    const reports = [
      {
        name: "Monthly Sales Report - January 2026",
        type: "Sale",
        date: "04-02-2026",
        generatedBy: "Admin",
        format: "PDF"
      },
      {
        name: "Inventory Aging Analysis Q4 2025",
        type: "Inventory",
        date: "04-02-2026",
        generatedBy: "Sales Manager",
        format: "CSV"
      },
      {
        name: "Financial Statement - December 2025",
        type: "Financial",
        date: "04-02-2026",
        generatedBy: "System",
        format: "Excel"
      },
      {
        name: "User Activity Log - Week 5",
        type: "Users",
        date: "04-02-2026",
        generatedBy: "Admin",
        format: "PDF"
      }
    ];

    // =========================
    // ✅ FINAL RESPONSE
    // =========================
    res.json({
      trendChart,
      scrapChart,
      transitChart,
      reports
    });

  } catch (err) {
    console.error("REPORT DASHBOARD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};
exports.getItemDashboard = async (req, res) => {
  try {
    const user = req.user;
    const requestedBranchId = parseInt(req.params.branchId, 10);
    const stockId = parseInt(req.params.stockId, 10);

    if (Number.isNaN(requestedBranchId) || Number.isNaN(stockId)) {
      return res.status(400).json({
        error: "Invalid branchId or stockId",
      });
    }

    // =========================
    // ACCESS CONTROL
    // =========================
    if (
      user.branches[0] !== "ALL" &&
      !user.branches.includes(requestedBranchId)
    ) {
      return res.status(403).json({
        error: "❌ Access Denied - Wrong Branch",
      });
    }

    const finalBranchId =
      user.branches[0] === "ALL" ? requestedBranchId : user.branch_id;

    // =========================
    // ITEM FIND
    // =========================
    const stockItem = await Stock.findOne({
      where: {
        id: stockId,
        branch_id: finalBranchId,
      },
      raw: true,
    });

    if (!stockItem) {
      return res.status(404).json({
        error: "❌ Item not found",
      });
    }

    // =========================
    // RELATED STOCKS
    // =========================
    const relatedStocks = await Stock.findAll({
      where: {
        branch_id: finalBranchId,
        item: stockItem.item,
      },
      raw: true,
    });

    const stockIds = relatedStocks.map((s) => s.id);

    // =========================
    // SUMMARY
    // =========================
    const totalStock = relatedStocks.reduce(
      (sum, i) => sum + Number(i.quantity || 0),
      0
    );

    const totalStockValue = relatedStocks.reduce(
      (sum, i) => sum + Number(i.value || 0),
      0
    );

    const totalSales =
      (await Ledger.sum("total", {
        where: {
          branch_id: finalBranchId,
          type: "SALE",
        },
      })) || 0;

    const agingItems = relatedStocks.filter(
      (i) => Number(i.aging || 0) > 5
    ).length;

    // =========================
    // AUTO DETECT DATE COLUMN
    // =========================
    const getDateColumn = async (tableName) => {
      const columns = await sequelize.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = :tableName
        ORDER BY ordinal_position
        `,
        {
          replacements: { tableName },
          type: sequelize.QueryTypes.SELECT,
        }
      );

      const names = columns.map((c) => c.column_name);

      if (names.includes("created_at")) return "created_at";
      if (names.includes("createdAt")) return "createdAt";
      if (names.includes("date")) return "date";
      if (names.includes("movement_date")) return "movement_date";
      if (names.includes("ledger_date")) return "ledger_date";

      return null;
    };

    const stockMovementDateColumn = await getDateColumn("stock_movements");
    const ledgerDateColumn = await getDateColumn("ledger");

    // =========================
    // STOCK MOVEMENT
    // =========================
    let stockMovement = [];

    if (stockMovementDateColumn && stockIds.length) {
      stockMovement = await sequelize.query(
        `
        SELECT
          TO_CHAR(DATE("${stockMovementDateColumn}"), 'YYYY-MM-DD') AS label,
          COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END), 0) AS stock_in,
          COALESCE(SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END), 0) AS stock_out
        FROM stock_movements
        WHERE branch_id = :branchId
          AND stock_id IN (:stockIds)
        GROUP BY DATE("${stockMovementDateColumn}")
        ORDER BY DATE("${stockMovementDateColumn}") ASC
        `,
        {
          replacements: {
            branchId: finalBranchId,
            stockIds,
          },
          type: sequelize.QueryTypes.SELECT,
        }
      );
    } else {
      // fallback if no date column
      stockMovement = await sequelize.query(
        `
        SELECT
          'Overall' AS label,
          COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END), 0) AS stock_in,
          COALESCE(SUM(CASE WHEN type = 'OUT' THEN quantity ELSE 0 END), 0) AS stock_out
        FROM stock_movements
        WHERE branch_id = :branchId
          AND stock_id IN (:stockIds)
        `,
        {
          replacements: {
            branchId: finalBranchId,
            stockIds: stockIds.length ? stockIds : [0],
          },
          type: sequelize.QueryTypes.SELECT,
        }
      );
    }

    // =========================
    // REVENUE / COST TREND
    // =========================
    let revenueCostTrend = [];

    if (ledgerDateColumn) {
      revenueCostTrend = await sequelize.query(
        `
        SELECT
          TO_CHAR(DATE("${ledgerDateColumn}"), 'YYYY-MM-DD') AS label,
          COALESCE(SUM(CASE WHEN type = 'SALE' THEN total ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN type = 'PURCHASE' THEN total ELSE 0 END), 0) AS cost
        FROM ledger
        WHERE branch_id = :branchId
        GROUP BY DATE("${ledgerDateColumn}")
        ORDER BY DATE("${ledgerDateColumn}") ASC
        `,
        {
          replacements: {
            branchId: finalBranchId,
          },
          type: sequelize.QueryTypes.SELECT,
        }
      );
    } else {
      revenueCostTrend = await sequelize.query(
        `
        SELECT
          'Overall' AS label,
          COALESCE(SUM(CASE WHEN type = 'SALE' THEN total ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN type = 'PURCHASE' THEN total ELSE 0 END), 0) AS cost
        FROM ledger
        WHERE branch_id = :branchId
        `,
        {
          replacements: {
            branchId: finalBranchId,
          },
          type: sequelize.QueryTypes.SELECT,
        }
      );
    }

    // =========================
    // CONDITION
    // =========================
    const goodCondition = relatedStocks
      .filter((i) => (i.status || "").toUpperCase() === "GOOD")
      .reduce((sum, i) => sum + Number(i.quantity || 0), 0);

    const scrapDamaged = relatedStocks
      .filter((i) =>
        ["DAMAGED", "SCRAP"].includes((i.status || "").toUpperCase())
      )
      .reduce((sum, i) => sum + Number(i.quantity || 0), 0);

    const repairable = relatedStocks
      .filter((i) => (i.status || "").toUpperCase() === "REPAIRABLE")
      .reduce((sum, i) => sum + Number(i.quantity || 0), 0);

    const inTransit = relatedStocks
      .filter((i) => (i.status || "").toUpperCase() === "IN_TRANSIT")
      .reduce((sum, i) => sum + Number(i.quantity || 0), 0);

    // =========================
    // AGING TABLE
    // =========================
    const agingAnalysis = relatedStocks.map((i) => {
      let status = "Good";

      if ((i.status || "").toUpperCase() === "DAMAGED") status = "Damaged";
      else if ((i.status || "").toUpperCase() === "SCRAP") status = "Damaged";
      else if ((i.status || "").toUpperCase() === "REPAIRABLE") {
        status = "Repairable";
      } else if (Number(i.aging || 0) > 8) {
        status = "Damaged";
      } else if (Number(i.aging || 0) > 4) {
        status = "Repairable";
      }

      return {
        stockId: i.id,
        batchNo: i.grn || "-",
        ageRange: `${i.aging || 0} months`,
        quantity: Number(i.quantity || 0),
        value: Number(i.value || 0),
        status,
      };
    });

    const branchInfo = await Branch.findByPk(finalBranchId);

    return res.json({
      branchUsed: finalBranchId,
      branchInfo,
      debug: {
        stockMovementDateColumn,
        ledgerDateColumn,
      },
      itemInfo: {
        id: stockItem.id,
        name: stockItem.item,
        category: stockItem.category,
        hsn: stockItem.hsn,
        grn: stockItem.grn,
      },
      summaryCards: {
        totalStock,
        totalStockValue,
        totalSales,
        agingItems,
      },
      conditionCards: {
        goodCondition,
        scrapDamaged,
        repairable,
        inTransit,
      },
      charts: {
        stockMovement,
        revenueCostTrend,
      },
      agingAnalysis,
    });
  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
};

exports.toggleBranchStatus = async (req, res) => {
  try {
    let { id } = req.params;

    console.log("👉 Incoming ID:", id);

    // ✅ FORCE NUMBER
    id = Number(id);

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid branch id"
      });
    }

    const branch = await Branch.findByPk(id);

    console.log("👉 Found Branch:", branch);

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found"
      });
    }

    // 🔁 TOGGLE
    const newStatus =
      branch.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    branch.status = newStatus;
    await branch.save();

    return res.json({
      success: true,
      message:
        newStatus === "ACTIVE"
          ? "Branch Activated successfully"
          : "Branch Deactivated successfully",
      branch
    });

  } catch (err) {
    console.error("❌ ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
