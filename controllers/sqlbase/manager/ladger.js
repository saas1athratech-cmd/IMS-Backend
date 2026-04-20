const { Ledger, Branch } = require("../../../model/SQL_Model");
const { Op } = require("sequelize");

exports.getLedgerEntries = async (req, res) => {
  try {
    const { branchId, type } = req.query;

    let where = {};

    if (branchId) where.branch_id = Number(branchId);

    if (type) {
      if (!["SALE", "PAYMENT"].includes(type)) {
        return res.status(400).json({ error: "Invalid type" });
      }
      where.type = type;
    }

    const ledger = await Ledger.findAll({
      where,
      include: [
        {
          model: Branch,
          as: "branch",
          attributes: ["id", "name", "location"]
        }
      ],
      order: [["createdAt", "DESC"]]
    });

    res.json({
      total: ledger.length,
      ledger
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};