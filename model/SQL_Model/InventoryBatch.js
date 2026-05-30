
const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const InventoryBatch = sequelize.define(
  "InventoryBatch",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    batch_no: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    stock_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    parent_batch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    total_bundle: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    available_bundle: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    bundle_size: {
      type: DataTypes.STRING,
    },

    item_name: {
      type: DataTypes.STRING,
    },

    status: {
      type: DataTypes.STRING,
      defaultValue: "ACTIVE",
    },

    // =====================================
    // SUPPLIER ID
    // =====================================

    supplier_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
supplier: {
  type: DataTypes.STRING,
  allowNull: true,
},
expiry_date: {
  type: DataTypes.DATE,
  allowNull: true,
},
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

  },
  {
    tableName: "inventory_batches",
    timestamps: false,
  }
);

module.exports = InventoryBatch;

