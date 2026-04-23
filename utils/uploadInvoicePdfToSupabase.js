const supabase = require("../config/supabase");

const uploadInvoicePdfToSupabase = async (pdfBuffer, invoiceNo) => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const safeInvoiceNo = String(invoiceNo).replace(/[^\w.-]/g, "_");
  const filePath = `invoices/${year}/${month}/${safeInvoiceNo}.pdf`;

  const { error } = await supabase.storage
    .from("invoice-pdfs")
    .upload(filePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new Error(error.message || "Failed to upload invoice PDF");
  }

  return filePath;
};

const getInvoiceSignedUrl = async (filePath, expiresIn = 60 * 10) => {
  const { data, error } = await supabase.storage
    .from("invoice-pdfs")
    .createSignedUrl(filePath, expiresIn);

  if (error) {
    throw new Error(error.message || "Failed to create signed URL");
  }

  return data?.signedUrl;
};

module.exports = {
  uploadInvoicePdfToSupabase,
  getInvoiceSignedUrl,
};