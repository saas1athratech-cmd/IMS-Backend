const { Stock, User } = require("../../model/SQL_Model");
const sequelize = require("../../config/sqlcon");


const createBatch =
  require("../../service.sql/helpers/createBatch");

const createMovement =
  require("../../service.sql/helpers/createMovement");
const CHUNK_SIZE = 500; 


exports.createStock = async (req, res) => {

  const transaction =
    await sequelize.transaction();

  try {

    const {
      branch_id,
      item,
      quantity,
      rate,

      batch_no,
      total_bundle,
      bundle_size,
    } = req.body;

    if (
      !branch_id ||
      !item ||
      quantity == null ||
      rate == null
    ) {

      return res.status(400).json({
        error: "All fields required",
      });
    }

    // ===================================
    // CREATE STOCK
    // ===================================

    const stock = await Stock.create(
      {
        branch_id,

        item,

        quantity:
          Number(quantity),

        rate:
          Number(rate),

        owner_id:
          req.user.id,
      },
      { transaction }
    );

    // ===================================
    // CREATE ROOT BATCH
    // ===================================

    let batch = null;

    if (
      batch_no &&
      total_bundle &&
      bundle_size
    ) {

      batch =
        await createBatch({
          batch_no,

          stock_id:
            stock.id,

          branch_id,

          total_bundle,

          available_bundle:
            total_bundle,

          bundle_size,

          item_name:
            item,

          transaction,
        });

      // ===================================
      // MOVEMENT ENTRY
      // ===================================

      await createMovement({
        stock_id:
          stock.id,

        batch_id:
          batch.id,

        branch_id,

        type: "IN",

        quantity,

        bundle_quantity:
          total_bundle,

        remarks:
          "Initial Stock Purchase",

        created_by:
          req.user.id,

        transaction,
      });
    }

    await transaction.commit();

    res.status(201).json({
      message:
        "Stock created successfully",

      stock,

      batch,
    });

  } catch (err) {

    await transaction.rollback();

    res.status(500).json({
      error: err.message,
    });
  }
};


exports.getAllStock = async (req, res) => {
  try {
    const role = req.user?.role?.name;

    if (!["admin", "super_admin"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const stocks = await Stock.findAll({
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "name", "email"],
          include: [
            {
              association: "role",
              attributes: ["name"],
            },
          ],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    res.json(stocks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// this is for to the 

exports.bulkCreateStock = async (req, res) => {

    const transaction =
      await sequelize.transaction();

    try {

      const {
        branch_id,
        items,
      } = req.body;

      if (
        !branch_id ||
        !Array.isArray(items) ||
        items.length === 0
      ) {

        return res.status(400).json({
          error:
            "Branch & items required",
        });
      }

      const insertedStocks = [];

      for (const i of items) {

        // ==========================
        // CREATE STOCK
        // ==========================

        const stock =
          await Stock.create(
            {
              branch_id,

              item: i.item,

              quantity:
                Number(i.quantity),

              rate:
                Number(i.rate),

              owner_id:
                req.user.id,
            },
            { transaction }
          );

        insertedStocks.push(stock);

        // ==========================
        // CREATE ROOT BATCH
        // ==========================

        if (
          i.batch_no &&
          i.total_bundle &&
          i.bundle_size
        ) {

          const batch =
            await createBatch({
              batch_no:
                i.batch_no,

              stock_id:
                stock.id,

              branch_id,

              total_bundle:
                i.total_bundle,

              available_bundle:
                i.total_bundle,

              bundle_size:
                i.bundle_size,

              item_name:
                i.item,

              transaction,
            });

          // ==========================
          // CREATE MOVEMENT
          // ==========================

          await createMovement({
            stock_id:
              stock.id,

            batch_id:
              batch.id,

            branch_id,

            type: "IN",

            quantity:
              i.quantity,

            bundle_quantity:
              i.total_bundle,

            remarks:
              "Bulk Stock Purchase",

            created_by:
              req.user.id,

            transaction,
          });
        }
      }

      await transaction.commit();

      res.status(201).json({
        message:
          "Bulk stock inserted successfully",

        totalInserted:
          insertedStocks.length,

        data:
          insertedStocks,
      });

    } catch (err) {

      await transaction.rollback();

      console.error(err);

      res.status(500).json({
        error: err.message,
      });
    }
  };

exports.getStockById = async (req, res) => {
  try {
    const { stockId } = req.params;

    const stock = await Stock.findByPk(stockId, {
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "name", "email"],
          include: [
            {
              association: "role",
              attributes: ["name"],
            },
          ],
        },
      ],
    });

    if (!stock) {
      return res.status(404).json({ error: "Stock not found" });
    }

    res.json({
      stock,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
