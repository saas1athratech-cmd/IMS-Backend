const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const BranchBankAccount = sequelize.define(
  "BranchBankAccount",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    bank_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    account_holder_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    account_number: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    ifsc_code: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    branch_name: {
      type: DataTypes.STRING,
    },

    account_type: {
      type: DataTypes.ENUM("SAVING", "CURRENT"),
      defaultValue: "SAVING",
    },
  },
  {
    tableName: "branch_bank_accounts",
    schema: "public",
    timestamps: true,
    underscored: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = BranchBankAccount;