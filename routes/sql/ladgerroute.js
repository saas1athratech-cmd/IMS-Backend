const express = require("express");
const router = express.Router();

const { getLedgerEntries } = require("../../controllers/sqlbase/manager/ladger");
const auth = require("../../middleware/auth");
const checkRole = require("../../middleware/role");

router.get(
  "/",

  getLedgerEntries
);

module.exports = router;