const PDFDocument = require("pdfkit");

function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return d.toLocaleDateString("en-GB");
}

function money(val) {
  return Number(val || 0).toFixed(2);
}

function numberToWords(num) {
  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

  const inWords = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n/10)] + (n%10 ? " " + a[n%10] : "");
    if (n < 1000) return a[Math.floor(n/100)] + " Hundred " + inWords(n%100);
    if (n < 100000) return inWords(Math.floor(n/1000)) + " Thousand " + inWords(n%1000);
    if (n < 10000000) return inWords(Math.floor(n/100000)) + " Lakh " + inWords(n%100000);
    return inWords(Math.floor(n/10000000)) + " Crore " + inWords(n%10000000);
  };

  return inWords(Math.floor(num)) + " Rupees Only";
}

async function generateGSTInvoicePDF({ branch, invoice, client, items }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 20 });

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      const W = doc.page.width - 40;
      const X = 20;
      const mid = X + W / 2;

      // ================= HEADER =================
      doc.font("Helvetica-Bold").fontSize(22)
        .fillColor("#1F4E79")
        .text(branch.name || "COMPANY", X, 20, { width: W, align: "center" });

      doc.font("Helvetica").fontSize(9).fillColor("black")
        .text(`${branch.address}, ${branch.city}, ${branch.state}`, X, 48, { width: W, align: "center" })
        .text(`GST: ${branch.gst_number || ""}`, X, 62, { width: W, align: "center" });

      doc.font("Helvetica-Bold").fontSize(11)
        .text("TAX INVOICE", X, 78, { width: W, align: "center" });

      // ================= MAIN BOX =================
      let y = 100;
      const boxH = 200;

      doc.rect(X, y, W, boxH).stroke();
      doc.moveTo(mid, y).lineTo(mid, y + boxH).stroke();

      // ================= LEFT =================
      doc.font("Helvetica-Bold").fontSize(10)
        .text(branch.name, X + 8, y + 8);

      doc.font("Helvetica").fontSize(8)
        .text(branch.address, X + 8, y + 25, { width: W/2 - 20 })
        .text(`GST: ${branch.gst_number}`, X + 8, y + 55)
        .text(`Email: ${branch.email || ""}`, X + 8, y + 70);

      doc.font("Helvetica-Bold").text("BILL TO:", X + 8, y + 95);

      doc.font("Helvetica").fontSize(8)
        .text(client.name, X + 8, y + 110)
        .text(client.address, X + 8, y + 125, { width: W/2 - 20 })
        .text(`GST: ${client.gst_number || ""}`, X + 8, y + 150);

      // ================= RIGHT =================
      const rightX = mid + 8;
      const rw = W / 2 - 16;
      const rowH = 18;

      const rows = [
        ["Invoice", invoice.invoice_no],
        ["Date", formatDate(invoice.createdAt)],
        ["Payment", "RTGS"],
        ["Ref", invoice.quotation_no || ""],
        ["Project", client.name]
      ];

      let ry = y + 10;

      rows.forEach(r => {
        doc.rect(rightX, ry, rw, rowH).stroke();

        doc.font("Helvetica").fontSize(8)
          .text(r[0], rightX + 5, ry + 5, { width: 70 })
          .text(r[1] || "", rightX + 80, ry + 5, { width: rw - 85 });

        ry += rowH;
      });

      // ================= ITEMS TABLE =================
      y = 310;

      const col = {
        sl: 35,
        desc: 210,
        hsn: 70,
        qty: 60,
        rate: 70,
        unit: 60,
        amt: 70
      };

      const x = [
        X,
        X + col.sl,
        X + col.sl + col.desc,
        X + col.sl + col.desc + col.hsn,
        X + col.sl + col.desc + col.hsn + col.qty,
        X + col.sl + col.desc + col.hsn + col.qty + col.rate,
        X + col.sl + col.desc + col.hsn + col.qty + col.rate + col.unit
      ];

      const headers = ["SL", "Item", "HSN", "Qty", "Rate", "Unit", "Amount"];

      doc.rect(X, y, W, 22).stroke();
      doc.font("Helvetica-Bold").fontSize(8);

      headers.forEach((h, i) => {
        doc.text(h, x[i] + 2, y + 7, { width: col[Object.keys(col)[i]] - 4, align: "center" });
      });

      y += 22;

      doc.font("Helvetica").fontSize(8);

      items.forEach((it, i) => {
        const h = 20;
        doc.rect(X, y, W, h).stroke();

        doc.text(i + 1, x[0] + 5, y + 6);
        doc.text(it.product_name, x[1] + 5, y + 6);
        doc.text(it.hsn || "", x[2] + 5, y + 6);
        doc.text(it.quantity, x[3] + 5, y + 6);
        doc.text(money(it.unit_price), x[4] + 5, y + 6);
        doc.text(it.unit || "", x[5] + 5, y + 6);
        doc.text(money(it.subtotal), x[6] + 5, y + 6);

        y += h;
      });

      // ================= TOTALS =================
      const subtotal = items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
      const gst = Number(invoice.gst_amount || 0);
      const cgst = gst / 2;
      const sgst = gst / 2;
      const total = Number(invoice.total_amount || 0);

      const totals = [
        ["Subtotal", subtotal],
        ["CGST 9%", cgst],
        ["SGST 9%", sgst],
        ["Total", total]
      ];

      totals.forEach(t => {
        const h = 18;
        doc.rect(X, y, W, h).stroke();

        doc.font("Helvetica-Bold")
          .text(t[0], X + 400, y + 5)
          .text(money(t[1]), X + 520, y + 5);

        y += h;
      });

      // ================= WORDS =================
      doc.rect(X, y, W, 25).stroke();
      doc.font("Helvetica").fontSize(8)
        .text(`Amount in words: ${numberToWords(total)}`, X + 5, y + 8);

      y += 30;

      // ================= BANK =================
      doc.rect(X, y, W, 70).stroke();

      doc.font("Helvetica-Bold").text("Bank Details", X + 5, y + 10);
      doc.font("Helvetica").fontSize(8)
        .text(`Bank: ${branch.bank_name}`, X + 5, y + 25)
        .text(`A/C: ${branch.bank_account}`, X + 5, y + 40)
        .text(`IFSC: ${branch.ifsc}`, X + 5, y + 55);

      doc.end();

    } catch (e) {
      reject(e);
    }
  });
}