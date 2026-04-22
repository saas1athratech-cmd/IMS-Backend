const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const ClientLedger = sequelize.define("ClientLedger", {

  client_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },


  branch_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },

  type: {
    type: DataTypes.ENUM("SALE", "PAYMENT"),
    allowNull: false
  },

  invoice_no: {
    type: DataTypes.STRING
  },
 
  amount: {
    type: DataTypes.FLOAT,
    allowNull: false,
    validate: { min: 0 }
  },

  remark: {
    type: DataTypes.STRING
  },

  invoice_file: {
    type: DataTypes.STRING,
    allowNull: true
  }

}, {
  tableName: "client_ledger",
    schema: "public",
  timestamps: true,
    createdAt: "created_at",
  updatedAt: "updated_at"
});

module.exports = ClientLedger;