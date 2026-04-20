const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");        
const checkRole = require("../../middleware/role");  
const stockController = require("../../controllers/sqlbase/stock.controll");

router.post(
  "/stock",
  auth,
  checkRole(["admin", "super_admin", "stock"]),
  stockController.createStock
);

router.get(
  "/stock",
  auth,
  checkRole(["admin", "super_admin"]),
  stockController.getAllStock
);
router.post(
  "/stock/bulk",
  auth,
  checkRole(["super_admin", "admin", "stock"]),
  stockController.bulkCreateStock
);

module.exports = router;
