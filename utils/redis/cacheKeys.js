const cacheKeys = {
  dashboardMain: () => "dashboard:main",

  reportAnalysis: ({ from, to, branchId = "all" }) =>
    `report:analysis:${from}:${to}:${branchId}`,

  stockList: ({ storeId, page = 1, limit = 10, search = "" }) =>
    `stock:list:${storeId}:${page}:${limit}:${search}`,

  stockSummary: ({ storeId }) =>
    `stock:summary:${storeId}`,

  districtStockSummary: ({ districtId }) =>
    `district:stock:summary:${districtId}`
};

module.exports = cacheKeys;