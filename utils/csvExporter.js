const { Parser } = require("json2csv");

exports.generateCSV = (data, fields) => {
  try {
    const parser = new Parser({ fields });
    return parser.parse(data);
  } catch (err) {
    throw new Error("CSV generation failed");
  }
};

exports.sendCSV = (res, csv, filename = "report.csv") => {
  res.header("Content-Type", "text/csv");
  res.attachment(filename);
  return res.send(csv);
};