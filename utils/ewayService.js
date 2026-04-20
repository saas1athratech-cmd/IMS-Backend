const axios = require("axios");

async function generateEwayBill({ invoice, client, branch, items }) {

  const payload = {
    supplyType: "O",
    subSupplyType: 1,
    docType: "INV",
    docNo: invoice.invoice_no,
    docDate: new Date().toLocaleDateString("en-GB"),
    fromGstin: branch.gst,
    toGstin: client.gst_number,
    totalValue: invoice.total_amount,
    transMode: "1",
    vehicleNo: "DL01AB1234",
    distance: 10,
    itemList: items.map(it => ({
      productName: it.product_name,
      productDesc: it.product_name,
      hsnCode: it.hsn,
      quantity: it.quantity,
      taxableAmount: it.subtotal,
      cgstRate: 9,
      sgstRate: 9
    }))
  };

  const response = await axios.post(
    process.env.EWB_GENERATE_URL,
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.EWB_TOKEN}`
      }
    }
  );

  return response.data;
}

module.exports = { generateEwayBill };