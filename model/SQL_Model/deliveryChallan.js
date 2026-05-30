const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {

  const DeliveryChallan = sequelize.define(
    "DeliveryChallan",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },

      dc_no: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },

      quotation_id: {
        type: DataTypes.INTEGER,
        allowNull: true
      },

      client_id: {
        type: DataTypes.INTEGER,
        allowNull: true
      },

      from_branch_id: {
        type: DataTypes.INTEGER,
        allowNull: false
      },

      to_branch_id: {
        type: DataTypes.INTEGER,
        allowNull: true
      },

      vehicle_no: {
        type: DataTypes.STRING,
        allowNull: true
      },

      driver_name: {
        type: DataTypes.STRING,
        allowNull: true
      },

      driver_phone: {
        type: DataTypes.STRING,
        allowNull: true
      },

      transport_name: {
        type: DataTypes.STRING,
        allowNull: true
      },

      remarks: {
        type: DataTypes.TEXT,
        allowNull: true
      },

      status: {
        type: DataTypes.ENUM(
          "generated",
          "dispatched",
          "in_transit",
          "received",
          "cancelled"
        ),
        defaultValue: "generated"
      },

      dispatched_at: {
        type: DataTypes.DATE,
        allowNull: true
      },

      received_at: {
        type: DataTypes.DATE,
        allowNull: true
      }
    },
    {
      tableName: "delivery_challans",

      underscored: true,

      timestamps: true,

      createdAt: "created_at",

      updatedAt: "updated_at"
    }
  );

  return DeliveryChallan;
};