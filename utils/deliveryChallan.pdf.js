const PDFDocument = require("pdfkit");
const { Branch, DeliveryChallan } = require("../model/SQL_Model");

// ─────────────────────────────────────────────
// PAGE CONFIG
// ─────────────────────────────────────────────
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const L = 15;
const R = 580;
const W = R - L;
const MID = 290;

// ─────────────────────────────────────────────
// TABLE COLUMNS
// ─────────────────────────────────────────────
const TC = {
  sl: 15,
  par: 45,
  hsn: 255,
  uom: 335,
  qty: 390,
  rat: 445,
  amt: 515,
  end: 580,
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const setFont = (doc, bold = false, size = 8) => {
  doc
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(size)
    .fillColor("#000");
};

const line = (
  doc,
  x1,
  y1,
  x2,
  y2,
  lw = 0.4,
  color = "#777"
) => {
  doc
    .save()
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .lineWidth(lw)
    .strokeColor(color)
    .stroke()
    .restore();
};

const rect = (
  doc,
  x,
  y,
  w,
  h,
  lw = 0.45,
  color = "#777"
) => {
  doc
    .save()
    .rect(x, y, w, h)
    .lineWidth(lw)
    .strokeColor(color)
    .stroke()
    .restore();
};

const fillRect = (doc, x, y, w, h, color) => {
  doc.save().rect(x, y, w, h).fill(color).restore();
};

const fmtAmt = (n) =>
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-IN");

const getRowHeight = () => 22;

// ─────────────────────────────────────────────
// GST
// ─────────────────────────────────────────────
const calcGST = (taxable, from, to) => {
  if (
    from?.state_code &&
    to?.state_code &&
    from.state_code === to.state_code
  ) {
    const cgst = taxable * 0.09;

    return {
      cgst,
      sgst: cgst,
      igst: 0,
      total: taxable + cgst + cgst,
    };
  }

  const igst = taxable * 0.18;

  return {
    cgst: 0,
    sgst: 0,
    igst,
    total: taxable + igst,
  };
};

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
exports.generateDCPDF = async ({
  req,
  res,
  quotation,
  clientData,
  toBranchData,
  products,
  branch_id,
  dc_no,
  vehicle_no,
  driver_name,
  transport_name,
  eway_bill_no,
  dispatch_doc_no,
  destination,
}) => {
  try {
    const fromBranch = await Branch.findByPk(branch_id);

    const toBranchId =
      toBranchData?.id ||
      clientData?.linked_branch_id ||
      null;

    const toBranch = toBranchId
      ? await Branch.findByPk(toBranchId)
      : null;

    // SAVE DELIVERY CHALLAN
    await DeliveryChallan.create({
      dc_no,
      quotation_id: quotation?.id || null,
      from_branch_id: branch_id,
      to_branch_id: toBranchId,
      client_id: clientData?.id || null,
      vehicle_no: vehicle_no || null,
      driver_name: driver_name || null,
      transport_name: transport_name || null,
      status: "generated",
    });

    // PDF INIT
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      compress: true,
      autoFirstPage: true,
      bufferPages: true,
    });

    res.setHeader("Content-Type", "application/pdf");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${dc_no}.pdf`
    );

    doc.pipe(res);

    // ─────────────────────────────────────────
    // TITLE
    // ─────────────────────────────────────────
    fillRect(doc, L, 10, W, 24, "#EAEAEA");

    rect(doc, L, 10, W, 24);

    line(doc, MID, 10, MID, 34);

    setFont(doc, true, 13);

    doc.text(
      "DELIVERY CHALLAN",
      L,
      16,
      {
        width: MID - L,
        align: "center",
      }
    );

    doc.text(
      (fromBranch?.city || "BANGALORE").toUpperCase(),
      MID,
      16,
      {
        width: R - MID,
        align: "center",
      }
    );

    // ─────────────────────────────────────────
    // COMPANY SECTION
    // ─────────────────────────────────────────
    let y = 34;

    rect(doc, L, y, W, 90);

    line(doc, MID, y, MID, y + 90);

    line(doc, L, y + 22, R, y + 22);
    line(doc, L, y + 44, R, y + 44);
    line(doc, L, y + 66, R, y + 66);

    // LEFT SIDE
    setFont(doc, true, 9);

    doc.text(
      fromBranch?.name || "",
      20,
      y + 6
    );

    setFont(doc, false, 8);

    doc.text(
      `GSTIN NO - ${fromBranch?.gstin || ""}`,
      20,
      y + 28
    );

    doc.text(
      fromBranch?.address || "",
      20,
      y + 48,
      {
        width: 250,
      }
    );

    doc.text(
      `State Name : ${fromBranch?.state || ""}, Code : ${
        fromBranch?.state_code || ""
      }`,
      20,
      y + 72
    );

    // RIGHT SIDE
    setFont(doc, true, 8);

    doc.text(
      "Delivery Challan No :-",
      300,
      y + 6
    );

    setFont(doc, false, 8);

    doc.text(dc_no || "", 430, y + 6);

    setFont(doc, true, 8);

    doc.text("Date :-", 515, y + 6);

    setFont(doc, false, 8);

    doc.text(fmtDate(new Date()), 545, y + 6);

    setFont(doc, true, 8);

    doc.text(
      "Eway Bill No :-",
      300,
      y + 28
    );

    setFont(doc, false, 8);

    doc.text(
      eway_bill_no || "NA",
      430,
      y + 28
    );

    setFont(doc, true, 8);

    doc.text(
      "Dispatch Doc No :-",
      300,
      y + 50
    );

    setFont(doc, false, 8);

    doc.text(
      dispatch_doc_no || "NA",
      430,
      y + 50
    );

    setFont(doc, true, 8);

    doc.text(
      "Vehicle No :-",
      300,
      y + 72
    );

    setFont(doc, false, 8);

    doc.text(vehicle_no || "", 430, y + 72);

    // ─────────────────────────────────────────
    // CONSIGNEE
    // ─────────────────────────────────────────
    y += 90;

    rect(doc, L, y, W, 75);

    line(doc, MID, y, MID, y + 75);

    line(doc, L, y + 18, R, y + 18);

    const shipName =
      toBranch?.name ||
      clientData?.name ||
      "";

    const shipAddress =
      toBranch?.address ||
      clientData?.ship_address ||
      clientData?.address ||
      "";

    const shipState =
      toBranch?.state ||
      clientData?.state ||
      "";

    setFont(doc, true, 8);

    doc.text(
      "Consignee (Ship to)",
      20,
      y + 5
    );

    doc.text(
      "Bill To",
      300,
      y + 5
    );

    setFont(doc, true, 9);

    doc.text(shipName, 20, y + 24);

    doc.text(
      fromBranch?.name || "",
      300,
      y + 24
    );

    setFont(doc, false, 8);

    doc.text(
      shipAddress,
      20,
      y + 42,
      {
        width: 250,
      }
    );

    doc.text(
      fromBranch?.address || "",
      300,
      y + 42,
      {
        width: 250,
      }
    );

    doc.text(
      `State : ${shipState}`,
      20,
      y + 62
    );

    doc.text(
      `State : ${fromBranch?.state || ""}`,
      300,
      y + 62
    );

    // ─────────────────────────────────────────
    // TABLE HEADER
    // ─────────────────────────────────────────
    y += 75;

    fillRect(doc, L, y, W, 22, "#DCDCDC");

    rect(doc, L, y, W, 22);

    [
      TC.par,
      TC.hsn,
      TC.uom,
      TC.qty,
      TC.rat,
      TC.amt,
    ].forEach((x) => {
      line(doc, x, y, x, y + 22);
    });

    setFont(doc, true, 8);

    doc.text("Sl", 15, y + 7, {
      width: 25,
      align: "center",
    });

    doc.text("Particular", 45, y + 7, {
      width: 200,
      align: "center",
    });

    doc.text("HSN/SAC", 255, y + 7, {
      width: 70,
      align: "center",
    });

    doc.text("UOM", 335, y + 7, {
      width: 50,
      align: "center",
    });

    doc.text("Qty", 390, y + 7, {
      width: 45,
      align: "center",
    });

    doc.text("Rate", 445, y + 7, {
      width: 60,
      align: "center",
    });

    doc.text("Amount", 515, y + 7, {
      width: 55,
      align: "center",
    });

    y += 22;

    // ─────────────────────────────────────────
    // PRODUCTS
    // ─────────────────────────────────────────
    let taxableAmount = 0;

    products.forEach((p, index) => {
      const rowHeight = getRowHeight();

      // PAGE BREAK
      if (y + rowHeight > 730) {
        doc.addPage();

        y = 40;
      }

      const qty = Number(p.quantity || 0);

      const rate = Number(p.rate || 0);

      const amount = qty * rate;

      taxableAmount += amount;

      rect(doc, L, y, W, rowHeight, 0.3);

      [
        TC.par,
        TC.hsn,
        TC.uom,
        TC.qty,
        TC.rat,
        TC.amt,
      ].forEach((x) => {
        line(doc, x, y, x, y + rowHeight, 0.25);
      });

      setFont(doc, false, 8);

      doc.text(
        String(index + 1),
        15,
        y + 6,
        {
          width: 20,
          align: "center",
        }
      );

      doc.text(
        p.product_name || "",
        45,
        y + 6,
        {
          width: 200,
          ellipsis: true,
        }
      );

      doc.text(
        p.hsn || "",
        255,
        y + 6,
        {
          width: 70,
          align: "center",
        }
      );

      doc.text(
        p.unit || "",
        335,
        y + 6,
        {
          width: 50,
          align: "center",
        }
      );

      doc.text(
        String(qty),
        390,
        y + 6,
        {
          width: 40,
          align: "right",
        }
      );

      doc.text(
        rate.toFixed(2),
        445,
        y + 6,
        {
          width: 55,
          align: "right",
        }
      );

      setFont(doc, true, 8);

      doc.text(
        amount.toFixed(2),
        515,
        y + 6,
        {
          width: 55,
          align: "right",
        }
      );

      y += rowHeight;
    });

    // ─────────────────────────────────────────
    // TOTALS
    // ─────────────────────────────────────────
    const gst = calcGST(
      taxableAmount,
      fromBranch,
      toBranch || clientData
    );

    const totals = [
      ["Taxable Amount", taxableAmount],
      ["CGST", gst.cgst],
      ["SGST", gst.sgst],
      ["IGST", gst.igst],
      ["Total", gst.total],
    ];

    const totalStartY = y;

    totals.forEach(([label, value], index) => {
      const isTotal =
        index === totals.length - 1;

      if (isTotal) {
        fillRect(
          doc,
          355,
          y,
          225,
          18,
          "#ECECEC"
        );
      }

      rect(doc, 355, y, 225, 18, 0.3);

      line(doc, 500, y, 500, y + 18, 0.25);

      setFont(doc, isTotal, 8);

      doc.text(label, 360, y + 5, {
        width: 130,
        align: "right",
      });

      doc.text(
        fmtAmt(value),
        505,
        y + 5,
        {
          width: 65,
          align: "right",
        }
      );

      y += 18;
    });

    // LEFT BOX
    rect(
      doc,
      15,
      totalStartY,
      340,
      totals.length * 18,
      0.3
    );

    // ─────────────────────────────────────────
    // REMARKS
    // ─────────────────────────────────────────
    y += 10;

    setFont(doc, true, 8);

    doc.text(
      "Remarks : ",
      20,
      y,
      {
        continued: true,
      }
    );

    setFont(doc, false, 8);

    doc.text(
      "Goods dispatched in good condition."
    );

    // ─────────────────────────────────────────
    // SIGNATURES
    // ─────────────────────────────────────────
    const sigY = 790;

    line(
      doc,
      30,
      sigY - 5,
      160,
      sigY - 5
    );

    line(
      doc,
      420,
      sigY - 5,
      550,
      sigY - 5
    );

    setFont(doc, false, 8);

    doc.text(
      "Receiver Signature",
      30,
      sigY,
      {
        width: 130,
        align: "center",
      }
    );

    doc.text(
      "Authorized Signatory",
      420,
      sigY,
      {
        width: 130,
        align: "center",
      }
    );

    doc.end();
  } catch (err) {
    console.error("generateDCPDF error:", err);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "PDF generation failed",
        error: err.message,
      });
    }
  }
};