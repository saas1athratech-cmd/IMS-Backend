const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Stock = sequelize.define(
  "Stock",
  {
    item: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    category: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    rate: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },

    value: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },

    hsn: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    grn: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    batch_no: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    aging: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
    },

    status: {
      type: DataTypes.ENUM("GOOD", "DAMAGED", "REPAIRABLE"),
      defaultValue: "GOOD",
    },

    po_number: {
      type: DataTypes.STRING,
      allowNull: false,
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
  },
  {
    tableName: "stocks",
      schema: "public",
    underscored: true,
  }
);

// ===============================
// AUTO CALCULATE VALUE
// ===============================
Stock.beforeValidate((stock) => {
  if (stock.quantity && stock.rate) {
    stock.value = stock.quantity * stock.rate;
  }
});

module.exports = Stock;