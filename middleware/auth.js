const jwt = require("jsonwebtoken");
const { User, Role } = require("../model/SQL_Model");

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ["password"] },
      include: {
        model: Role,
        as: "role",
        attributes: ["name"],
      },
    });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const roleName = user.role?.name;

    // ✅ FINAL SUPER ROLES
    const superRoles = [
      "super_admin",
      "super_sales_manager",
      "super_inventory_manager"
      
    ];

    let branches = [];

    // =========================
    // 👑 SUPER USER FIX
    // =========================
    if (
      superRoles.includes(roleName) ||
      decoded.branches?.includes("ALL")
    ) {
      branches = ["ALL"]; // 🔥 FORCE ALL
    } 
    // =========================
    // 👤 NORMAL USER
    // =========================
    else {
      if (!user.branch_id) {
        return res.status(400).json({
          error: "No branch assigned to user",
        });
      }

      branches = [user.branch_id];
    }

    // =========================
    // FINAL USER OBJECT
    // =========================
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: roleName,
      branch_id: user.branch_id,
      branches,
    };

    console.log(" FINAL USER:", req.user);

    next();

  } catch (err) {
    console.error("JWT ERROR:", err.message);
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = auth;