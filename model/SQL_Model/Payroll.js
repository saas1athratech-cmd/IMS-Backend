const { DataTypes } = require("sequelize");
const sequelize = require("../config/sqlcon");

const Payroll = sequelize.define("Payroll", {

  employee_id: DataTypes.INTEGER,
  branch_id: DataTypes.INTEGER,

  month: DataTypes.STRING, 

  company_name: DataTypes.STRING,
  designation: DataTypes.STRING,

  bank_account: DataTypes.STRING,
  ifsc_code: DataTypes.STRING,
  bank_name: DataTypes.STRING,

  ctc: DataTypes.FLOAT,
  tds: { type: DataTypes.FLOAT, defaultValue: 0 },

  days_present: DataTypes.INTEGER,
  leave_days: { type: DataTypes.INTEGER, defaultValue: 0 },
  absent_days: { type: DataTypes.INTEGER, defaultValue: 0 },

  per_day_salary: DataTypes.FLOAT,
  advance: { type: DataTypes.FLOAT, defaultValue: 0 },

  pf: { type: DataTypes.FLOAT, defaultValue: 0 },
  food_allowance: { type: DataTypes.FLOAT, defaultValue: 0 },
  travel_allowance: { type: DataTypes.FLOAT, defaultValue: 0 },

  bonus: { type: DataTypes.FLOAT, defaultValue: 0 },

  net_payable: DataTypes.FLOAT,

  remarks: DataTypes.STRING,

  status: {
    type: DataTypes.ENUM("PENDING","PAID"),
    defaultValue: "PENDING"
  }

},{
  tableName: "payrolls",
  underscored: true
});

module.exports = Payroll;
