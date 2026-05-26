const {
  BatchTimeline,
} = require(
  "../../model/SQL_Model"
);

const createTimeline =
  async ({
    stock_id,

    batch_id,

    event_type,

    title,

    description,

    from_branch_id = null,

    to_branch_id = null,

    quantity = 0,

    bundle_quantity = 0,

    created_by = null,

    transaction,
  }) => {

    return await BatchTimeline.create(
      {
        stock_id,

        batch_id,

        event_type,

        title,

        description,

        from_branch_id,

        to_branch_id,

        quantity,

        bundle_quantity,

        created_by,
      },
      { transaction }
    );
  };

module.exports =
  createTimeline;