const { deleteManyCache, deleteCache } = require("./cacheHelper");
const cacheKeys = require("./cacheKeys");

async function invalidateDashboardCache() {
  await deleteCache(cacheKeys.dashboardMain());
}

async function invalidateStockCache({ storeId, districtId }) {
  const keys = [cacheKeys.stockSummary({ storeId })];

  if (districtId) {
    keys.push(cacheKeys.districtStockSummary({ districtId }));
  }

  await deleteManyCache(keys);
}

module.exports = {
  invalidateDashboardCache,
  invalidateStockCache
};

