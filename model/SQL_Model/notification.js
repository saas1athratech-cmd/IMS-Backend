const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Notification = sequelize.define(
  "Notification",
  {
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    title: {
      type: DataTypes.STRING,
      allowNull: false
    },

    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },

    type: {
      type: DataTypes.STRING,
      defaultValue: "general"
    },

    is_read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  },
  {
    tableName: "notifications",
      schema: "public",
    underscored: true,
    timestamps: true,
      createdAt: "created_at",
  updatedAt: "updated_at"
  }
);

module.exports = Notification;