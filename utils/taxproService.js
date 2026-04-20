const axios = require("axios");

exports.generateIRN = async (payload) => {
  try {

    const response = await axios.post(
      process.env.TAXPRO_URL,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.TAXPRO_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;

  } catch (err) {

    console.log("TaxPro Error:", err.response?.data || err.message);

    throw err;
  }
};