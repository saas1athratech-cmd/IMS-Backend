const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Branch = sequelize.define("Branch", {

  code: {
    type: DataTypes.STRING,
    unique: true
  },

  name: {
    type: DataTypes.STRING,
    allowNull: false
  },

  manager_name: {
    type: DataTypes.STRING
  },

  phone: {
    type: DataTypes.STRING
  },

  email: {
    type: DataTypes.STRING
  },

  address: {
    type: DataTypes.TEXT
  },

  status: {
    type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
    defaultValue: "ACTIVE"
  }

}, {
  tableName: "branches",
  schema: "public",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at"
});

module.exports = Branch;