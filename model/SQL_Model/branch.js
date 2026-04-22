const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Branch = sequelize.define(
  "Branch",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

       state: {
      type: DataTypes.STRING,
      allowNull: false
    },

    type: {
      type: DataTypes.ENUM("HEAD_OFFICE", "WAREHOUSE", "RETAIL", "FRANCHISE"),
      allowNull: false,
    },

    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      defaultValue: "ACTIVE",
    },

    location: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    contact_number: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    email: {
      type: DataTypes.STRING,
      allowNull: true,
    }
  },
  {
    tableName: "branches",
      schema: "public",
    underscored: true,
    timestamps: true
  }
);

module.exports = Branch;
