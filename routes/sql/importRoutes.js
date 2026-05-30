// routes/importRoutes.js

const express = require("express");
const multer = require("multer");
const path = require("path");

const importStocksFromExcel = require("../../importStocksFromExcel");

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },

  filename: function (req, file, cb) {
    cb(
      null,
      Date.now() + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage });

router.post(
  "/import-stocks",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "File not found",
        });
      }

      await importStocksFromExcel(req.file.path);

      return res.status(200).json({
        success: true,
        message: "Stocks Imported Successfully",
      });
    } catch (error) {
      console.log(error);

      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

module.exports = router;