const PDFDocument = require("pdfkit");

function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("en-GB").replace(/\//g, "-");
}

function money(val) {
  return Number(val || 0).toFixed(2);
}

function numberToWords(num) {
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const inWords = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + inWords(n % 100) : "");
    if (n < 100000) return inWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + inWords(n % 1000) : "");
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + inWords(n % 100000) : "");
    return inWords(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + inWords(n % 10000000) : "");
  };

  const integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);

  let words = inWords(integerPart) + " Rupees";
  if (decimalPart > 0) {
    words += " and " + inWords(decimalPart) + " Paisa";
  }
  return words + " Only";
}

async function generateGSTInvoicePDF({ branch, invoice, client, items }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 20
      });

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      const pageWidth = doc.page.width;
      const startX = 20;
      const endX = pageWidth - 20;
      const usableWidth = endX - startX;

      // ========== CALCULATIONS ==========
      const subtotal = items.reduce((sum, i) => sum + Number(i.subtotal || i.amount || 0), 0);
      const gstAmount = Number(invoice.gst_amount || 0);
      const cgst = gstAmount / 2;
      const sgst = gstAmount / 2;
      const grandTotal = Number(invoice.total_amount || 0);

      // ========== HEADER ==========
      doc
        .font("Helvetica-Bold")
        .fontSize(28)
        .fillColor("#5DADE2")
        .text(branch.name || "Construct Ability", startX, 20, {
          width: usableWidth,
          align: "center"
        });

      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("black")
        .text(
          `Address- ${branch.address || ""}, ${branch.city || ""}, ${branch.state || ""} - ${branch.pincode || ""}`,
          startX,
          60,
          { width: usableWidth, align: "center" }
        );

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(`GST No- ${branch.gst_number || branch.gst || ""}`, startX, 74, {
          width: usableWidth,
          align: "center"
        });

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("TAX-INVOICE", startX, 92, { width: usableWidth, align: "center" });

      doc
        .font("Helvetica")
        .fontSize(8)
        .text("(Original for buyer)", startX + usableWidth - 110, 92, { width: 100, align: "right" });

      // ========== MAIN BOX ==========
      let y = 110;
      doc.rect(startX, y, usableWidth, 190).stroke();

      // vertical divider
      doc.moveTo(startX + usableWidth / 2, y).lineTo(startX + usableWidth / 2, y + 190).stroke();

      // left section headings
      doc.font("Helvetica-Bold").fontSize(10).text(branch.name || "Company", startX + 5, y + 5);
      doc.font("Helvetica").fontSize(9)
        .text(`House no- ${branch.address || ""}`, startX + 5, y + 22)
        .text(`${branch.city || ""}, ${branch.state || ""} - ${branch.pincode || ""}`, startX + 5, y + 36)
        .text(`GSTIN/UIN: ${branch.gst_number || branch.gst || ""}`, startX + 5, y + 52)
        .text(`State Name: ${branch.state || ""}`, startX + 5, y + 66)
        .text(`E-Mail: ${branch.email || ""}`, startX + 5, y + 80);

      // Buyer/Supplier left lower
      doc.moveTo(startX, y + 105).lineTo(startX + usableWidth / 2, y + 105).stroke();
      doc.font("Helvetica-Bold").fontSize(10).text(client.name || client.company_name || "Client", startX + 5, y + 110);
      doc.font("Helvetica").fontSize(9)
        .text(`(Formerly ${client.name || client.company_name || ""})`, startX + 5, y + 125)
        .text(`${client.address || ""}`, startX + 5, y + 145)
        .text(`GST No: ${client.gst_number || client.gst || ""}`, startX + 5, y + 175)
        .text(`State Name: ${client.state || ""}`, startX + 5, y + 188);

      // right section rows
      const rx = startX + usableWidth / 2;
      const rw = usableWidth / 2;
      const rowH = 18;
      const labelW = 110;

      const rightRows = [
        ["Invoice No.", invoice.invoice_no || ""],
        ["Dated", formatDate(invoice.createdAt || new Date())],
        ["Delivery Note", ""],
        ["Mode/Terms of payment", "RTGS"],
        ["Supplier's Ref.", ""],
        ["Other Reference(s)", invoice.quotation_no || ""],
        ["Despatch Document No.", ""],
        ["Project Name", client.name || client.company_name || ""],
        ["", client.address || ""],
        ["", client.city || ""]
      ];

      let ry = y;
      for (let i = 0; i < rightRows.length; i++) {
        doc.rect(rx, ry, rw, rowH).stroke();
        doc.moveTo(rx + labelW, ry).lineTo(rx + labelW, ry + rowH).stroke();

        doc.font("Helvetica").fontSize(8)
          .text(rightRows[i][0], rx + 4, ry + 5, { width: labelW - 8 })
          .text(rightRows[i][1], rx + labelW + 4, ry + 5, { width: rw - labelW - 8 });

        ry += rowH;
      }

      // ========== ITEMS TABLE ==========
      y = 310;
      const tableX = startX;
      const tableW = usableWidth;
      const col = {
        sl: 35,
        desc: 255,
        hsn: 70,
        qty: 60,
        rate: 70,
        unit: 60,
        amount: 90
      };

      const headers = ["SL No.", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "Unit", "Amount"];
      const colXs = [
        tableX,
        tableX + col.sl,
        tableX + col.sl + col.desc,
        tableX + col.sl + col.desc + col.hsn,
        tableX + col.sl + col.desc + col.hsn + col.qty,
        tableX + col.sl + col.desc + col.hsn + col.qty + col.rate,
        tableX + col.sl + col.desc + col.hsn + col.qty + col.rate + col.unit
      ];

      const tableEndX = tableX + tableW;

      // header row
      doc.rect(tableX, y, tableW, 22).stroke();
      colXs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + 22).stroke());
      doc.moveTo(tableEndX, y).lineTo(tableEndX, y + 22).stroke();

      doc.font("Helvetica-Bold").fontSize(8);
      doc.text(headers[0], tableX + 5, y + 7, { width: col.sl - 10, align: "center" });
      doc.text(headers[1], colXs[1] + 5, y + 7, { width: col.desc - 10 });
      doc.text(headers[2], colXs[2] + 5, y + 7, { width: col.hsn - 10, align: "center" });
      doc.text(headers[3], colXs[3] + 5, y + 7, { width: col.qty - 10, align: "center" });
      doc.text(headers[4], colXs[4] + 5, y + 7, { width: col.rate - 10, align: "center" });
      doc.text(headers[5], colXs[5] + 5, y + 7, { width: col.unit - 10, align: "center" });
      doc.text(headers[6], colXs[6] + 5, y + 7, { width: col.amount - 10, align: "center" });

      y += 22;

      // item rows
      doc.font("Helvetica").fontSize(8);

      items.forEach((item, index) => {
        const rowH = 20;
        doc.rect(tableX, y, tableW, rowH).stroke();
        colXs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowH).stroke());
        doc.moveTo(tableEndX, y).lineTo(tableEndX, y + rowH).stroke();

        doc.text(String(index + 1), tableX + 5, y + 6, { width: col.sl - 10, align: "center" });
        doc.text(item.product_name || "", colXs[1] + 5, y + 6, { width: col.desc - 10 });
        doc.text(item.hsn || "", colXs[2] + 5, y + 6, { width: col.hsn - 10, align: "center" });
        doc.text(String(item.quantity || 0), colXs[3] + 5, y + 6, { width: col.qty - 10, align: "center" });
        doc.text(money(item.unit_price || 0), colXs[4] + 5, y + 6, { width: col.rate - 10, align: "center" });
        doc.text(item.unit || "", colXs[5] + 5, y + 6, { width: col.unit - 10, align: "center" });
        doc.text(money(item.subtotal || item.amount || 0), colXs[6] + 5, y + 6, { width: col.amount - 10, align: "right" });

        y += rowH;
      });

      // blank rows to keep format similar
      for (let i = items.length; i < 6; i++) {
        const rowH = 20;
        doc.rect(tableX, y, tableW, rowH).stroke();
        colXs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowH).stroke());
        doc.moveTo(tableEndX, y).lineTo(tableEndX, y + rowH).stroke();
        y += rowH;
      }

      // totals rows
      const totalRows = [
        ["Total Amount", money(subtotal)],
        ["CGST @9%", money(cgst)],
        ["SGST @9%", money(sgst)],
        ["Round Off", "0.00"],
        ["Total", money(grandTotal)]
      ];

      totalRows.forEach((r) => {
        const rowH = 18;
        doc.rect(tableX, y, tableW, rowH).stroke();
        colXs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowH).stroke());
        doc.moveTo(tableEndX, y).lineTo(tableEndX, y + rowH).stroke();

        doc.font("Helvetica-Bold").fontSize(8)
          .text(r[0], colXs[1], y + 5, {
            width: col.desc + col.hsn + col.qty + col.rate + col.unit - 10,
            align: "right"
          })
          .text(r[1], colXs[6] + 5, y + 5, {
            width: col.amount - 10,
            align: "right"
          });

        y += rowH;
      });

      // ========== AMOUNT IN WORDS ==========
      doc.rect(tableX, y, tableW, 28).stroke();
      doc.font("Helvetica").fontSize(8)
        .text(`Amount Chargeable (in words): ${numberToWords(grandTotal)}`, tableX + 5, y + 8, {
          width: tableW - 10
        });

      y += 28;

      // ========== TAX SUMMARY ==========
      doc.rect(tableX, y, tableW, 70).stroke();
      doc.moveTo(tableX + 180, y).lineTo(tableX + 180, y + 70).stroke();
      doc.moveTo(tableX + 360, y).lineTo(tableX + 360, y + 70).stroke();
      doc.moveTo(tableX + 470, y).lineTo(tableX + 470, y + 70).stroke();

      doc.font("Helvetica-Bold").fontSize(8)
        .text("HSN/SAC", tableX + 60, y + 8)
        .text("Integrated Tax", tableX + 230, y + 8)
        .text("Total Tax Amount", tableX + 490, y + 8);

      doc.font("Helvetica").fontSize(8)
        .text("CGST @9%", tableX + 220, y + 28)
        .text(money(cgst), tableX + 310, y + 28)
        .text(money(cgst + sgst), tableX + 500, y + 28)
        .text("SGST @9%", tableX + 220, y + 45)
        .text(money(sgst), tableX + 310, y + 45);

      y += 70;

      // ========== BANK + DECLARATION ==========
      doc.rect(tableX, y, tableW, 100).stroke();
      doc.moveTo(tableX + tableW / 2, y).lineTo(tableX + tableW / 2, y + 100).stroke();

      doc.font("Helvetica").fontSize(8)
        .text(`Total Amount (in words): ${numberToWords(gstAmount)}`, tableX + 5, y + 10, {
          width: tableW / 2 - 10
        });

      doc.font("Helvetica-Bold").fontSize(9)
        .text("Company Bank's Details:", tableX + tableW / 2 + 5, y + 10);

      doc.font("Helvetica").fontSize(8)
        .text(`Bank Name: ${branch.bank_name || "HDFC"}`, tableX + tableW / 2 + 5, y + 30)
        .text(`A/c No.: ${branch.bank_account || ""}`, tableX + tableW / 2 + 5, y + 45)
        .text(`Branch & IFSC Code: ${branch.ifsc || ""}`, tableX + tableW / 2 + 5, y + 60);

      y += 100;

      // Declaration + Signature
      doc.rect(tableX, y, tableW, 70).stroke();
      doc.moveTo(tableX + tableW / 2, y).lineTo(tableX + tableW / 2, y + 70).stroke();

      doc.font("Helvetica-Bold").fontSize(8)
        .text("Declaration :", tableX + 5, y + 8);

      doc.font("Helvetica").fontSize(8)
        .text(
          "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
          tableX + 5,
          y + 20,
          { width: tableW / 2 - 10 }
        );

      doc.font("Helvetica-Bold").fontSize(9)
        .text(`FOR ${String(branch.name || "COMPANY").toUpperCase()}`, tableX + tableW / 2 + 50, y + 10);

      doc.font("Helvetica").fontSize(8)
        .text("Authorised Signatory", tableX + tableW / 2 + 70, y + 50);

      y += 70;

      // Footer
      doc.font("Helvetica").fontSize(8)
        .text("SUBJECT TO JURISDICTION", tableX, y + 5, {
          width: tableW / 2,
          align: "center"
        })
        .text("(This is Computer Generated Invoice)", tableX + tableW / 2, y + 5, {
          width: tableW / 2,
          align: "center"
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = generateGSTInvoicePDF;