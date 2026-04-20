const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const StockMovement = sequelize.define(
  "StockMovement",
  {
    stock_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("IN", "OUT"),
      allowNull: false,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "stock_movements",
    underscored: true,
  }
);

module.exports = StockMovement;