const sequelize = require("../../config/sqlcon");
const BranchBankAccount = require("../../model/SQL_Model/BranchBankAccount");
const Branch = require("../../model/SQL_Model/branch");
// ================= CREATE BANK ACCOUNT =================
exports.createBranchBankAccount = async (req, res) => {
  try {
    const branch_id = req.user.branch_id;

    const {
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      branch_name,
      account_type,
    } = req.body;

    if (!bank_name || !account_holder_name || !account_number || !ifsc_code) {
      return res.status(400).json({
        success: false,
        message: "Required bank fields missing",
      });
    }

    const existing = await BranchBankAccount.findOne({
      where: { branch_id, account_number },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Account number already exists for this branch",
      });
    }

    const bank = await BranchBankAccount.create({
      branch_id,
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      branch_name,
      account_type: account_type || "SAVING",
    });

    return res.status(201).json({
      success: true,
      message: "Bank account created successfully",
      data: bank,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAllBranchBankAccounts = async (req, res) => {
  try {
    const user = req.user;

    const role = String(user?.role || "").toLowerCase();

    const SUPER_ROLES = [
      "super_admin",
      "admin",
      "super_inventory_manager",
      "super_stock_manager",
      "super_sales_manager",
    ];

    let whereCondition = {};

    // NORMAL BRANCH USER => ONLY OWN BRANCH
    if (!SUPER_ROLES.includes(role)) {
      whereCondition.branch_id = user.branch_id;
    }

    const accounts = await BranchBankAccount.findAll({
      where: whereCondition,

      include: [
        {
          model: Branch,
          as: "branch",
          attributes: [
            "id",
            "name",
            "code",
            "state",
            "type",
            "status",
            "location",
            "contact_number",
            "email",
          ],
        },
      ],

      order: [["id", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      count: accounts.length,
      data: accounts,
    });
  } catch (error) {
    console.log("GET BANK ACCOUNTS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bank accounts",
      error: error.message,
    });
  }
};