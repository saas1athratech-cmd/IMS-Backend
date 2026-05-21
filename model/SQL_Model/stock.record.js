const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Stock = sequelize.define(
  "Stock",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    item: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    category: DataTypes.STRING(255),
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    rate: {
      type: DataTypes.DOUBLE,
      allowNull: false,
    },

    value: {
      type: DataTypes.DOUBLE,
      allowNull: false,
    },

    hsn: DataTypes.STRING(255),
    grn: DataTypes.STRING(255),
    batch_no: DataTypes.STRING(255),

    aging: {
      type: DataTypes.DOUBLE,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.ENUM("GOOD", "DAMAGED", "REPAIRABLE"),
      defaultValue: "GOOD",
    },

    po_number: {
      type: DataTypes.STRING(255),
      defaultValue: "N/A",
    },

    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    sku: {
      type: DataTypes.STRING(255),
      unique: true,
    },

    sub_category: DataTypes.STRING(255),
    brand: DataTypes.STRING(255),
    type: DataTypes.STRING(255),
    size: DataTypes.STRING(255),
    color: DataTypes.STRING(255),

    bundle_size: {
      type: DataTypes.STRING(255), // 👈 DB me STRING hai (IMPORTANT)
      allowNull: true,
    },

    unit: {
      type: DataTypes.STRING(100),
      defaultValue: "PCS",
    },

    model_no: DataTypes.STRING(255),
    serial_no: DataTypes.STRING(255),

    item_description: DataTypes.TEXT,

    item_code: DataTypes.STRING(255),

    specification: DataTypes.JSONB,

    gst_percent: {
      type: DataTypes.DOUBLE,
      defaultValue: 18,
    },

    rack_no: DataTypes.STRING(255),
    location: DataTypes.STRING(255),

    min_stock_level: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    expiry_date: DataTypes.DATE,
    warranty_months: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  },
  {
    tableName: "stocks",
    schema: "public",
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

// AUTO CALCULATE VALUE
Stock.beforeValidate((stock) => {
  const qty = Number(stock.quantity) || 0;
  const rate = Number(stock.rate) || 0;

  stock.value = qty * rate;
});

module.exports = Stock;