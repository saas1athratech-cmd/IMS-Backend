const CryptoJS = require("crypto-js");

const SECRET_KEY = process.env.SECRET_KEY || "MY_SECRET_KEY";

// 🔐 ENCRYPT
const encryptPassword = (password) => {
  try {
    if (!password) return null;
    return CryptoJS.AES.encrypt(password, SECRET_KEY).toString();
  } catch (err) {
    console.error("Encrypt Error:", err.message);
    return null;
  }
};

// 🔓 SAFE DECRYPT (NO CRASH)
const decryptPassword = (encrypted) => {
  try {
    if (!encrypted || typeof encrypted !== "string") return null;

    const bytes = CryptoJS.AES.decrypt(encrypted, SECRET_KEY);

    if (!bytes) return null;

    const result = bytes.toString(CryptoJS.enc.Utf8);

    return result || null;
  } catch (err) {
    console.error("Decrypt Error:", err.message);
    return null;
  }
};

module.exports = { encryptPassword, decryptPassword };