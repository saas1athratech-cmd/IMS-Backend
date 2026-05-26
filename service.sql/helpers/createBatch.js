const {
  InventoryBatch,
} = require("../../model/SQL_Model");

const createBatch = async ({
  batch_no,
  stock_id,
  parent_batch_id = null,
  branch_id,
  total_bundle,
  available_bundle,
  bundle_size,
  item_name,
  status = "ACTIVE",
  transaction,
}) => {
  return await InventoryBatch.create(
    {
      batch_no,
      stock_id,
      parent_batch_id,
      branch_id,

      total_bundle,

      available_bundle,

      bundle_size,

      item_name,

      status,
    },
    { transaction }
  );
};

module.exports = createBatch;