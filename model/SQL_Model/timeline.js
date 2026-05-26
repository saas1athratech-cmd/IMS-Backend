const { DataTypes } =
  require("sequelize");

const sequelize =
  require("../../config/sqlcon");

const BatchTimeline =
  sequelize.define(
    "BatchTimeline",
    {

      stock_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      batch_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      event_type: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      title: {
        type: DataTypes.STRING,
      },

      description: {
        type: DataTypes.TEXT,
      },

      from_branch_id: {
        type: DataTypes.INTEGER,
      },

      to_branch_id: {
        type: DataTypes.INTEGER,
      },

      quantity: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
      },

      bundle_quantity: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
      },

      created_by: {
        type: DataTypes.INTEGER,
      },
    },
    {
      tableName:
        "batch_timelines",

      schema: "public",

      underscored: true,

      createdAt:
        "created_at",

      updatedAt: false,
    }
  );

module.exports =
  BatchTimeline;