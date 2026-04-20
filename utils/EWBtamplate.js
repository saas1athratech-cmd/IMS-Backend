const PDFDocument = require("pdfkit");
const fs = require("fs");

function generateInvoicePDF(invoice) {

const doc = new PDFDocument();

doc.pipe(fs.createWriteStream(`invoice-${invoice.number}.pdf`));

doc.fontSize(20).text("TAX INVOICE");

doc.text(`Invoice No: ${invoice.number}`);
doc.text(`Date: ${invoice.date}`);
doc.text(`Buyer: ${invoice.buyer}`);


// E-Way Bill Section
if (invoice.total > 50000) {

doc.moveDown();
doc.fontSize(16).text("E-Way Bill Details");

doc.text(`Mode: Road`);
doc.text(`Approx Distance: 120 KM`);
doc.text(`Type: Outward Supply`);

doc.text(`From GSTIN: ${invoice.fromGstin}`);
doc.text(`To GSTIN: ${invoice.toGstin}`);

doc.text(`Taxable Amount: ${invoice.taxable}`);
doc.text(`IGST: ${invoice.igst}`);

doc.text(`Transporter: ${invoice.transporter}`);
doc.text(`Vehicle No: ${invoice.vehicle}`);
}

doc.end();

}