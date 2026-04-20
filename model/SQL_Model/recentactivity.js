const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const RecentActivity = sequelize.define(
  "RecentActivity",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },

    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "users",
        key: "id"
      }
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "branches",
        key: "id"
      }
    },

    action: {
      type: DataTypes.STRING,
      allowNull: true
    },

    details: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    ref_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    ref_type: {
      type: DataTypes.STRING,
      allowNull: true
    },

    title: {
      type: DataTypes.STRING,
      allowNull: true
    },

    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    type: {
      type: DataTypes.STRING,
      allowNull: true
    }
  },
  {
    tableName: "recent_activities",
    underscored: true,
    timestamps: true
  }
);

module.exports = RecentActivity;