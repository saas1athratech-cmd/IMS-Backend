const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const Invoice = sequelize.define(
  "Invoice",
  {
    quotation_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true
    },

    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    invoice_no: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },

    quotation_no: {
      type: DataTypes.STRING,
      allowNull: true
    },

    total_amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0
    },

    gst_amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0
    },

    status: {
      type: DataTypes.ENUM("draft", "final", "paid"),
      defaultValue: "draft"
    },

    eway_bill_no: {
      type: DataTypes.STRING,
      allowNull: true
    },

    eway_bill_date: {
      type: DataTypes.DATE,
      allowNull: true
    },

    irn: {
      type: DataTypes.STRING,
      allowNull: true
    },

    ack_no: {
      type: DataTypes.STRING,
      allowNull: true
    },

    ack_date: {
      type: DataTypes.DATE,
      allowNull: true
    },

    qr_code: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    tableName: "invoices",
      schema: "public",
    underscored: true,
    timestamps: true,
      createdAt: "created_at",
  updatedAt: "updated_at"
  }
);

module.exports = Invoice;