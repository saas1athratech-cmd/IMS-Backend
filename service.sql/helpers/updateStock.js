// helpers/updateStock.js

const { Stock } =
  require("../../model/SQL_Model");

const updateStock = async ({
  stock_id,
  quantity,
  operation,
  transaction,
}) => {

  const stock =
    await Stock.findByPk(
      stock_id,
      { transaction }
    );

  if (!stock) {
    throw new Error(
      "Stock not found"
    );
  }

  if (operation === "ADD") {

    stock.quantity += quantity;
  }

  if (operation === "SUBTRACT") {

    if (
      stock.quantity < quantity
    ) {
      throw new Error(
        "Insufficient stock"
      );
    }

    stock.quantity -= quantity;
  }

  await stock.save({
    transaction,
  });

  return stock;
};

module.exports = updateStock;