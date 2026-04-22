const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Client = sequelize.define("Client", {
    client_code: {
    type: DataTypes.STRING
  },

  name: {
    type: DataTypes.STRING,
    
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

  gst_number: {
    type: DataTypes.STRING(15),
    allowNull: true
  },

  credit_limit: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },

  branch_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  }

}, {
  tableName: "clients",
    schema: "public",
  timestamps: true,
    createdAt: "created_at",
  updatedAt: "updated_at"
});

module.exports = Client;