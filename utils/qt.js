function quotationHTML({ branch, quotation, client, items }) {
  const rows = items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${it.product_name || ""}</td>
      <td>${it.hsn || ""}</td>
      <td>${it.quantity}</td>
      <td>${it.unit || ""}</td>
      <td>${Number(it.unit_price).toFixed(2)}</td>
      <td>${Number(it.subtotal).toFixed(2)}</td>
      <td>${Number(it.cgst || 0).toFixed(2)}</td>
      <td>${Number(it.sgst || 0).toFixed(2)}</td>
      <td>${Number(it.amount || it.subtotal).toFixed(2)}</td>
    </tr>
  `).join("");

  return `
  <html>
    <head>
      <style>
        body{ font-family: Arial, sans-serif; font-size:12px; color:#111;}
        .row{ display:flex; justify-content:space-between; gap:16px;}
        .box{ border:1px solid #222; padding:8px;}
        table{ width:100%; border-collapse:collapse; margin-top:10px;}
        th,td{ border:1px solid #222; padding:6px; text-align:left; }
        th{ background:#f2f2f2; }
        .right{text-align:right;}
        .title{ text-align:center; font-size:18px; font-weight:700; margin:10px 0;}
      </style>
    </head>
    <body>
      <div>
        <div style="font-weight:700; font-size:16px;">${branch.name || ""}</div>
        <div>${branch.address || ""}</div>
        <div>GST: ${branch.gst || ""} | Phone: ${branch.phone || ""}</div>
      </div>

      <div class="title">QUOTATION</div>

      <div class="row">
        <div class="box" style="flex:1;">
          <div><b>Quotation No:</b> ${quotation.quotation_no}</div>
          <div><b>Date:</b> ${new Date(quotation.createdAt).toLocaleDateString()}</div>
          <div><b>Status:</b> ${quotation.status}</div>
        </div>
        <div class="box" style="flex:1;">
          <div><b>GSTIN:</b> ${branch.gst || ""}</div>
          <div><b>Valid Till:</b> ${quotation.valid_till ? new Date(quotation.valid_till).toLocaleDateString() : "-"}</div>
        </div>
      </div>

      <div class="row" style="margin-top:10px;">
        <div class="box" style="flex:1;">
          <b>Billing Address</b><br/>
          ${client.name || ""}<br/>
          ${client.address || ""}
        </div>
        <div class="box" style="flex:1;">
          <b>Shipping Address</b><br/>
          ${client.name || ""}<br/>
          ${client.address || ""}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>No.</th><th>Item</th><th>HSN</th><th>Qty</th><th>Unit</th>
            <th class="right">Rate</th><th class="right">Taxable</th>
            <th class="right">CGST</th><th class="right">SGST</th><th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="row" style="margin-top:10px;">
        <div style="flex:1;">
          <b>Notes:</b> Computer generated quotation.
        </div>
        <div class="box" style="width:280px;">
          <div class="row"><span>Total before tax</span><span class="right">${Number(quotation.total_before_tax || (quotation.total_amount - quotation.gst_amount)).toFixed(2)}</span></div>
          <div class="row"><span>GST</span><span class="right">${Number(quotation.gst_amount || 0).toFixed(2)}</span></div>
          <div class="row"><b>Grand Total</b><b class="right">${Number(quotation.total_amount).toFixed(2)}</b></div>
        </div>
      </div>
    </body>
  </html>`;
}

module.exports = { quotationHTML };