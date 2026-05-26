// helpers/createMovement.js

const {
  StockMovement,
} = require("../../model/SQL_Model");

const createMovement = async ({
  stock_id,
  batch_id = null,

  branch_id,

  from_branch_id = null,
  to_branch_id = null,

  type,

  quantity,

  bundle_quantity = 0,

  remarks = "",

  reference_no = null,
  reference_type = null,

  created_by = null,

  transaction,
}) => {

  return await StockMovement.create(
    {
      stock_id,
      batch_id,

      branch_id,

      from_branch_id,
      to_branch_id,

      type,

      quantity,
      bundle_quantity,

      remarks,

      reference_no,
      reference_type,

      created_by,
    },
    { transaction }
  );
};

module.exports = createMovement;