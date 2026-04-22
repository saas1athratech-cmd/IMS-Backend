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
      schema: "public",
    underscored: true,
      createdAt: "created_at",
  updatedAt: "updated_at"
  }
);

module.exports = StockMovement;