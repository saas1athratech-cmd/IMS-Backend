module.exports = (allowedRoles = []) => {
  return (req, res, next) => {
    const userRole = req.user?.role;  // <-- directly role string

    if (!userRole) {
      return res.status(403).json({ message: "Role not found" });
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: "Access denied: Insufficient role" });
    }

    next();
  };
};