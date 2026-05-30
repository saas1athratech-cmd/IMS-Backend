const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {

  const DeliveryChallanItem = sequelize.define(
    "DeliveryChallanItem",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },

      dc_id: {
        type: DataTypes.INTEGER,
        allowNull: false
      },

      product_name: {
        type: DataTypes.STRING,
        allowNull: false
      },

      hsn: {
        type: DataTypes.STRING,
        allowNull: true
      },

      unit: {
        type: DataTypes.STRING,
        allowNull: true
      },

      quantity: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        defaultValue: 0
      },

      rate: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        defaultValue: 0
      },

      amount: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        defaultValue: 0
      }
    },
    {
      tableName: "delivery_challan_items",

      underscored: true,

      timestamps: false
    }
  );

  return DeliveryChallanItem;
};