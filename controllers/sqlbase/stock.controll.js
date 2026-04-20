const { Stock, User } = require("../../model/SQL_Model");

const CHUNK_SIZE = 500; 
exports.createStock = async (req, res) => {
  try {
    const { branch, item, quantity, rate } = req.body;

    if (!branch || !item || quantity == null || rate == null) {
      return res.status(400).json({ error: "All fields required" });
    }

    const stock = await Stock.create({
      branch,
      item,
      quantity: Number(quantity),
      rate: Number(rate),
      owner_id: req.user.id, 
    });

    res.status(201).json({
      message: "Stock created successfully",
      stock,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  try {
    const { branch, items } = req.body;

    if (!branch || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Branch & items required" });
    }

    
    const payload = items.map((i, idx) => {
      if (!i.item || i.quantity == null || i.rate == null) {
        throw new Error(`Invalid data at index ${idx}`);
      }

      return {
        branch,
        item: i.item,
        quantity: Number(i.quantity),
        rate: Number(i.rate),
        owner_id: req.user.id,
      };
    });

    let inserted = 0;

    // 🔥 chunked bulk insert WITH hooks
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      const chunk = payload.slice(i, i + CHUNK_SIZE);

      await Stock.bulkCreate(chunk, {
        individualHooks: true, // ✅ VERY IMPORTANT
      });

      inserted += chunk.length;
    }

    res.status(201).json({
      message: "Bulk stock inserted successfully",
      totalInserted: inserted,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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
