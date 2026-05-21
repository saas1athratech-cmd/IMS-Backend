// models/stocktracker.js

const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const StockTracker = sequelize.define(
  "StockTracker",
  {
    batch_no: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    stock_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    parent_batch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    item_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    total_bundle: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    available_bundle: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    bundle_size: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0,
    },

    total_quantity: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0,
    },

    available_quantity: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.ENUM(
        "ACTIVE",
        "SOLD",
        "TRANSFERRED",
        "DAMAGED",
        "RETURNED"
      ),
      defaultValue: "ACTIVE",
    },
  },
  {
    tableName: "inventory_batches",

    schema: "public",

    underscored: true,

    createdAt: "created_at",

    updatedAt: false,
  }
);

module.exports = StockTracker;