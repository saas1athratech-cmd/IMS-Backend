const axios = require("axios");

exports.generateIRN = async (payload) => {

  const response = await axios.post(
    "https://api.taxpro.in/einvoice/generate",
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.TAXPRO_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
};