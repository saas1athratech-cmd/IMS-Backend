const xlsx = require("xlsx");
const sequelize = require("./config/sqlcon");

async function importStocksFromExcel(filePath) {
  try {
    // Read Workbook
    const workbook = xlsx.readFile(filePath, {
      cellFormula: true,
      cellText: true,
      cellDates: true,
    });

    const sheetName = workbook.SheetNames[0];

    // Get Sheet
    const sheet = workbook.Sheets[sheetName];

    // Convert To JSON
    const rows = xlsx.utils.sheet_to_json(sheet, {
      defval: null,
      raw: false,
    });

    console.log("Total Rows:", rows.length);

    // Normalize Function
    const normalize = (str) =>
      String(str || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    // Loop Rows
    for (const originalRow of rows) {
      const row = {};

      // Normalize Keys
      Object.keys(originalRow).forEach((key) => {
        row[normalize(key)] = originalRow[key];
      });

      // =========================
      // EXCEL MAPPING
      // =========================

      const category =
        row["category"] || null;

      const brand =
        row["brand"] || null;

      const type =
        row["type"] || null;

      const item =
        row["item name"] ||
        row["item"] ||
        null;

      const size =
        row["size"] || null;

      const bundle_size =
        row["bundle size"] || null;

      const color =
        row["color"] || null;

      const hsn =
        row["hsn code"] || null;

      const unit =
        row["avl. unit"] ||
        row["unit"] ||
        "PCS";

      const quantity = Number(
        row["quantity"] || 0
      );

      const rate = Number(
        row["rate"] || 0
      );

      const value =
        Number(row["amount"]) ||
        quantity * rate;

      // =========================
      // AUTO DESCRIPTION
      // =========================

      let item_description =
        row["item discrimination"] ||
        null;

      // If formula not evaluated
      if (
        item_description &&
        String(item_description).includes(
          "_xlfn"
        )
      ) {
        item_description = [
          brand,
          type,
          item,
          size,
          color,
        ]
          .filter(Boolean)
          .join(" ");
      }

      // Final fallback
      if (!item_description) {
        item_description = [
          brand,
          type,
          item,
          size,
          color,
        ]
          .filter(Boolean)
          .join(" ");
      }

      // Skip Empty
      if (!item) {
        console.log("Skipped Empty Row");
        continue;
      }

      // =========================
      // SPECIFICATION JSON
      // =========================

      const specification = {
        category,
        brand,
        type,
        size,
        color,
        bundle_size,
        unit,
      };

      // =========================
      // DEBUG
      // =========================

      console.log({
        item,
        brand,
        type,
        size,
        color,
        bundle_size,
      });

      // =========================
      // INSERT
      // =========================

      await sequelize.query(
        `
        INSERT INTO stocks (
          item,
          category,
          quantity,
          rate,
          value,
          hsn,
          grn,
          batch_no,
          aging,
          status,
          po_number,
          owner_id,
          branch_id,
          created_at,
          updated_at,
          brand,
          type,
          size,
          color,
          bundle_size,
          unit,
          item_description,
          specification,
          gst_percent,
          min_stock_level,
          warranty_months
        )
        VALUES (
          :item,
          :category,
          :quantity,
          :rate,
          :value,
          :hsn,
          'N/A',
          'BATCH-001',
          0,
          'GOOD',
          'N/A',
          1,
          1,
          NOW(),
          NOW(),
          :brand,
          :type,
          :size,
          :color,
          :bundle_size,
          :unit,
          :item_description,
          :specification,
          18,
          0,
          0
        )
        `,
        {
          replacements: {
            item,
            category,
            quantity,
            rate,
            value,
            hsn,
            brand,
            type,
            size,
            color,
            bundle_size,
            unit,
            item_description,
            specification:
              JSON.stringify(
                specification
              ),
          },
        }
      );

      console.log(`Imported: ${item}`);
    }

    console.log(
      "✅ ALL STOCKS IMPORTED"
    );
  } catch (error) {
    console.log(error);
  }
}

module.exports = importStocksFromExcel;