const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Ledger = sequelize.define("Ledger", {

  branch_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  stock_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  type: {
    type: DataTypes.ENUM(
      "PURCHASE",
      "SALE",
      "TRANSFER_IN",
      "TRANSFER_OUT",
      "DAMAGE",
      "ADJUSTMENT"
  
    ),
    allowNull: false
  },

  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  rate: {
    type: DataTypes.FLOAT,
    allowNull: false
  },

  total: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },

  reference_no: DataTypes.STRING,

  created_by: DataTypes.INTEGER,

  invoice_file: {   // ✅ PDF file path
    type: DataTypes.STRING,
    allowNull: true
  }

}, {
  tableName: "ledger",
  timestamps: true
});

module.exports = Ledger;