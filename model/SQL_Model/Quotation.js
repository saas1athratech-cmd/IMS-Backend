const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Quotation = sequelize.define("Quotation", {
  quotation_no: DataTypes.STRING,
  client_id: DataTypes.INTEGER,
  branch_id: DataTypes.INTEGER,
  total_amount: DataTypes.FLOAT,
  gst_amount: DataTypes.FLOAT,
  valid_till: DataTypes.DATE,
  reference_no: DataTypes.STRING,
  terms: DataTypes.TEXT,
  notes: DataTypes.TEXT,

  status: {
    type: DataTypes.ENUM("pending","approved","rejected","invoiced"),
    defaultValue: "pending"
  },

  // 🔥 NEW FIELDS (ADD ONLY THIS)
  approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },

  approved_at: {
    type: DataTypes.DATE,
    allowNull: true
  }

},{
  tableName:"quotations",
  timestamps:true
});

const QuotationItem = sequelize.define("QuotationItem",{
  quotation_id: DataTypes.INTEGER,
  product_name: DataTypes.STRING,
  quantity: DataTypes.INTEGER,
  unit_price: DataTypes.FLOAT,
  unit: DataTypes.STRING,
  hsn: DataTypes.STRING,
  cgst: DataTypes.FLOAT,
  sgst: DataTypes.FLOAT,
  subtotal: DataTypes.FLOAT,
  amount: DataTypes.FLOAT
},{
  tableName:"quotation_items",
  timestamps:true
});


/* ASSOCIATIONS */

Quotation.hasMany(QuotationItem,{
  foreignKey:"quotation_id",
  as:"items"
});

QuotationItem.belongsTo(Quotation,{
  foreignKey:"quotation_id",
  as:"parentQuotation"
});

module.exports = {
  Quotation,
  QuotationItem
};