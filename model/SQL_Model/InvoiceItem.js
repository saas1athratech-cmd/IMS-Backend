const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const InvoiceItem = sequelize.define("InvoiceItem", {

  invoice_id: DataTypes.INTEGER,

  product_name: DataTypes.STRING,

  quantity: DataTypes.INTEGER,

  unit_price: DataTypes.FLOAT,

  subtotal: DataTypes.FLOAT

}, {
  tableName: "invoice_items",
    schema: "public",
  timestamps: true
});

module.exports = InvoiceItem;