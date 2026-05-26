const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const StockMovement = sequelize.define(
  "StockMovement",
  {
    stock_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    // =====================================================
    // BATCH
    // =====================================================

    batch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // =====================================================
    // BRANCH
    // =====================================================

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    from_branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    to_branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // =====================================================
    // CLIENT + INVOICE
    // =====================================================

    client_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    invoice_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    // =====================================================
    // MOVEMENT TYPE
    // =====================================================

    type: {
      type: DataTypes.ENUM(
        "IN",
        "OUT",
        "SALE",
        "DAMAGE",
        "RETURN",
        "TRANSFER",
        "ADJUSTMENT"
      ),
      allowNull: false,
    },

    // =====================================================
    // QUANTITY
    // =====================================================

    quantity: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },

    bundle_quantity: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: 0,
    },

    // =====================================================
    // EXTRA DETAILS
    // =====================================================

    remarks: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    reference_no: {
      type: DataTypes.STRING,
      allowNull: true,
    },

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