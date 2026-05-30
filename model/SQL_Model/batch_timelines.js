const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sqlcon");

const BatchTimeline = sequelize.define(
  "BatchTimeline",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    stock_id: DataTypes.INTEGER,
    batch_id: DataTypes.INTEGER,
    event_type: DataTypes.STRING,
    title: DataTypes.STRING,
    description: DataTypes.TEXT,
    from_branch_id: DataTypes.INTEGER,
    to_branch_id: DataTypes.INTEGER,
    quantity: { type: DataTypes.DECIMAL, defaultValue: 0 },
    bundle_quantity: { type: DataTypes.DECIMAL, defaultValue: 0 },
    created_by: DataTypes.INTEGER,
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  },
  {
    tableName: "batch_timelines",
    timestamps: false,
  }
);

module.exports = BatchTimeline;