const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");        
const checkRole = require("../../middleware/role");  
const authcontroller = require("../../controllers/sqlbase/auth.controller");
router.post('/register-emp',auth,checkRole(['hr_admin']),authcontroller.register)


module.exports = router;
