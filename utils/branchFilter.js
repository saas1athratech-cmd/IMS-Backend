// utils/branchFilter.js

const { Op } = require("sequelize");

const getBranchFilter = (user) => {

  // 👑 SUPER ADMIN → ALL DATA
  if (user.branches?.[0] === "ALL") {
    return {};
  }

  // 🏢 MULTI BRANCH USER
  if (user.branches?.length) {
    return {
      branch_id: {
        [Op.in]: user.branches
      }
    };
  }

  // 👤 SINGLE BRANCH USER
  if (user.branch_id) {
    return {
      branch_id: user.branch_id
    };
  }

  return null;
};

module.exports = getBranchFilter;