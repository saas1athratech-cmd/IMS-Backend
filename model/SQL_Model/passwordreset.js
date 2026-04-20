const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const PasswordReset = sequelize.define(
  "PasswordReset",
  {
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    otp: {
      type: DataTypes.STRING,
      allowNull: false
    },

    status: {
      type: DataTypes.ENUM("pending", "verified", "expired", "used"),
      defaultValue: "pending"
    },

    expires_at: {
      type: DataTypes.DATE,
      allowNull: false
    },

    verified_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    tableName: "password_resets",
    underscored: true,
    timestamps: true
  }
);

module.exports = PasswordReset;