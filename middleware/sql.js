const jwt = require("jsonwebtoken");
const { User, Role } = require("../model/SQL_Model/user");

// ================= AUTH =================
const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ["password"] },
      include: [
        {
          model: Role,
          as: "role",
          attributes: ["name"],
        },
      ],
    });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // 👇 this is what controllers & routes will use
    req.user = user;
    /*
      req.user.id
      req.user.role.name
    */

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// ================= ROLE CHECK =================
const checkRole = (allowedRoles = []) => {
  if (typeof allowedRoles === "string") {
    allowedRoles = [allowedRoles];
  }

  return (req, res, next) => {
    const roleName = req.user?.role?.name;

    if (!allowedRoles.includes(roleName)) {
      return res
        .status(403)
        .json({ message: "Access denied: Insufficient role" });
    }

    next();
  };
};

module.exports = {
  auth,
  checkRole,
};
