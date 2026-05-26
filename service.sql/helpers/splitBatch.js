// helpers/splitBatch.js

const {
  StockTracker,
} = require("../../model/SQL_Model");
const createTimeline =
  require("./createTimeline");
const createBatch =
  require("./createBatch");

const createMovement =
  require("./createMovement");

const updateStock =
  require("./updateStock");

const splitBatch = async ({
  batch_id,

  split_bundle,

  type,

  branch_id,

  to_branch_id = null,

  created_by = null,

  transaction,
}) => {

  // =====================================
  // GET PARENT BATCH
  // =====================================

  const parentBatch =
    await StockTracker.findByPk(
      batch_id,
      { transaction }
    );

  if (!parentBatch) {
    throw new Error(
      "Batch not found"
    );
  }

  // =====================================
  // VALIDATION
  // =====================================

  if (
    parentBatch.available_bundle <
    split_bundle
  ) {
    throw new Error(
      "Insufficient bundle quantity"
    );
  }

  // =====================================
  // REDUCE PARENT
  // =====================================

  parentBatch.available_bundle -=
    split_bundle;

  parentBatch.available_quantity =
    parentBatch.available_bundle *
    parentBatch.bundle_size;

  // =====================================
  // AUTO CONSUMED
  // =====================================

  if (
    parentBatch.available_bundle === 0
  ) {
    parentBatch.status =
      "CONSUMED";
  }

  await parentBatch.save({
    transaction,
  });

  // =====================================
  // TOTAL QUANTITY
  // =====================================

  const totalQty =
    split_bundle *
    parentBatch.bundle_size;

  // =====================================
  // CHILD BATCH NAME
  // =====================================

  const childBatchNo =
    type === "SALE"
      ? `${parentBatch.batch_no}-S-${Date.now()}`
      : `${parentBatch.batch_no}-T-${Date.now()}`;

  // =====================================
  // CREATE CHILD BATCH
  // =====================================

  const childBatch =
    await createBatch({

      batch_no:
        childBatchNo,

      stock_id:
        parentBatch.stock_id,

      parent_batch_id:
        parentBatch.id,

      branch_id:
        type === "TRANSFER"
          ? to_branch_id
          : branch_id,

      total_bundle:
        split_bundle,

      available_bundle:
        type === "TRANSFER"
          ? split_bundle
          : 0,

      bundle_size:
        parentBatch.bundle_size,

      item_name:
        parentBatch.item_name,

      status:
        type === "SALE"
          ? "SOLD"
          : "ACTIVE",

      transaction,
    });

  // =====================================
  // SALE → REDUCE STOCK
  // =====================================

  if (type === "SALE") {

    await updateStock({

      stock_id:
        parentBatch.stock_id,

      quantity:
        totalQty,

      operation:
        "SUBTRACT",

      transaction,
    });
  }

  // =====================================
  // CREATE MOVEMENT
  // =====================================

  await createMovement({

    stock_id:
      parentBatch.stock_id,

    batch_id:
      childBatch.id,

    branch_id,

    from_branch_id:
      type === "TRANSFER"
        ? branch_id
        : null,

    to_branch_id:
      type === "TRANSFER"
        ? to_branch_id
        : null,

    type:
      type === "SALE"
        ? "OUT"
        : "TRANSFER",

    quantity:
      totalQty,

    bundle_quantity:
      split_bundle,

    remarks:
      `${type} batch split`,

    created_by,

    transaction,
  });

  return childBatch;
};
await createTimeline({

    stock_id:
      parentBatch.stock_id,

    batch_id:
      childBatch.id,

    event_type:
      type,

    title:
      type === "SALE"
        ? "Batch Sold"
        : "Batch Transferred",

    description:
      type === "SALE"
        ? `${split_bundle} bundle sold`
        : `${split_bundle} bundle transferred`,

    from_branch_id:
      type === "TRANSFER"
        ? branch_id
        : null,

    to_branch_id:
      type === "TRANSFER"
        ? to_branch_id
        : null,

    quantity:
      totalQty,

    bundle_quantity:
      split_bundle,

    created_by,

    transaction,
  });
module.exports = splitBatch;