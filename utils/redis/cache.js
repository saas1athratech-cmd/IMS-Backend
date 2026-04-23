const { redisClient } = require("../../config/redis");

async function getOrSetCache(key, ttlSeconds, callback) {
  try {
    const cachedData = await redisClient.get(key);

    if (cachedData) {
      return {
        source: "redis",
        data: JSON.parse(cachedData)
      };
    }

    const freshData = await callback();

    await redisClient.set(key, JSON.stringify(freshData), {
      EX: ttlSeconds
    });

    return {
      source: "db",
      data: freshData
    };
  } catch (error) {
    console.error("Cache Helper Error:", error);

    const freshData = await callback();

    return {
      source: "db",
      data: freshData
    };
  }
}

async function deleteCache(key) {
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error("Delete Cache Error:", error);
  }
}

async function deleteManyCache(keys = []) {
  try {
    if (!keys.length) return;
    await redisClient.del(keys);
  } catch (error) {
    console.error("Delete Many Cache Error:", error);
  }
}

module.exports = {
  getOrSetCache,
  deleteCache,
  deleteManyCache
};