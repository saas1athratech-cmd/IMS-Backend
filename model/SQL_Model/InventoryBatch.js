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
    },

    stock_id: {
      type: DataTypes.INTEGER,
    },

    parent_batch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    branch_id: {
      type: DataTypes.INTEGER,
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
  type: DataTypes.STRING
},

    item_name: {
      type: DataTypes.STRING,
    },

    status: {
      type: DataTypes.STRING,
      defaultValue: "ACTIVE",
    },
  },
  {
    tableName: "inventory_batches",
    timestamps: false,
  }
);

module.exports = InventoryBatch;