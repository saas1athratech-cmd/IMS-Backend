const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");
const checkRole = require("../../middleware/role");
const hrcontroller = require("../../controllers/sqlbase/hr.controller");


router.get('/all-emp',auth,checkRole(['sales_manager']),hrcontroller.getEmployees)
router.get('/all-emp',auth,checkRole(['sales_manager']),hrcontroller.getEmployees)
module.exports = router;
