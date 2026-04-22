const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const SecurityActivity = sequelize.define(
  "SecurityActivity",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "id"
      }
    },

    activity_type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "login"
    },

    device_name: {
      type: DataTypes.STRING,
      allowNull: true
    },

    ip_address: {
      type: DataTypes.STRING,
      allowNull: true
    },

    location: {
      type: DataTypes.STRING,
      allowNull: true
    },

    session_token: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },

    logged_in_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },

    logout_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    tableName: "security_activities",
    schema: "public",
    underscored: true,
    timestamps: true,
      createdAt: "created_at",
  updatedAt: "updated_at",
    indexes: [
      {
        fields: ["user_id"]
      },
      {
        fields: ["activity_type"]
      },
      {
        fields: ["is_active"]
      },
      {
        fields: ["user_id", "activity_type", "is_active"]
      }
    ]
  }
);

module.exports = SecurityActivity;