exports.generateEinvoicePayload = ({
  invoice,
  client,
  branch,
  items
}) => {

  return {

    Version: "1.1",

    TranDtls: {
      TaxSch: "GST",
      SupTyp: "B2B"
    },

    DocDtls: {
      Typ: "INV",
      No: invoice.invoice_no,
      Dt: new Date().toLocaleDateString("en-GB")
    },

    SellerDtls: {
      Gstin: branch.gst_number,
      LglNm: branch.name,
      Addr1: branch.address,
      Loc: branch.city,
      Pin: branch.pincode,
      Stcd: branch.state_code
    },

    BuyerDtls: {
      Gstin: client.gst_number,
      LglNm: client.name,
      Addr1: client.address,
      Loc: client.city,
      Pin: client.pincode,
      Stcd: client.state_code
    },

    ItemList: items.map((i, index) => ({
      SlNo: String(index + 1),
      PrdDesc: i.product_name,
      HsnCd: i.hsn || "",
      Qty: i.quantity,
      UnitPrice: i.unit_price,
      TotAmt: i.subtotal,
      GstRt: 18
    })),

    ValDtls: {
      AssVal: invoice.total_amount,
      CgstVal: invoice.gst_amount / 2,
      SgstVal: invoice.gst_amount / 2,
      TotInvVal: invoice.total_amount
    }

  };

};