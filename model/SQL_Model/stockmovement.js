const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const StockMovement = sequelize.define(
  "StockMovement",
  {
    stock_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    // 🔥 NEW
    batch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    // 🔥 NEW
    from_branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // 🔥 NEW
    to_branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    type: {
      type: DataTypes.ENUM(
        "IN",
        "OUT",
        "DAMAGE",
        "RETURN",
        "TRANSFER",
        "ADJUSTMENT"
      ),
      allowNull: false,
    },

    quantity: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },

    // 🔥 NEW
    bundle_quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    },

    remarks: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    reference_no: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // 🔥 NEW
    reference_type: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "stock_movements",

    schema: "public",

    underscored: true,

    createdAt: "created_at",

    updatedAt: "updated_at",
  }
);

module.exports = StockMovement;
