const multer = require("multer");

// memory storage (excel ke liye best)
const storage = multer.memoryStorage();

const upload = multer({ storage });

module.exports = { upload };