const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Ledger = sequelize.define(
  "Ledger",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },

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
      allowNull: false
    },

    reference_no: {
      type: DataTypes.STRING,
      allowNull: true
    },

    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    invoice_file: {
      type: DataTypes.STRING,
      allowNull: true
    }
  },
  {
    tableName: "ledger",
    schema: "public",

    timestamps: true,
    underscored: true,

    createdAt: "created_at",
    updatedAt: "updated_at"
  }
);

module.exports = Ledger;