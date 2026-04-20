const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");

const {
  getSystemSettings,
  upsertSystemSettings,
  getSecurityOverview,
  changePassword,
  updateRecoveryDetails,

  // 🔥 NEW (Super Admin OTP Reset)
  sendSuperAdminResetOtp,
  verifySuperAdminOtpAndResetPassword

} = require("../../controllers/sqlbase/password/systemsetting");

// ================= SYSTEM SETTINGS =================

// GET settings
router.get(
  "/get/system-settings",
  auth,
  getSystemSettings
);

// CREATE / UPDATE
router.post(
  "/update/system",
  auth,
  upsertSystemSettings
);

router.put(
  "/update/system-settings",
  auth,
  upsertSystemSettings
);

// ================= SECURITY =================

// Get security overview
router.get(
  "/get/security",
  auth,
  getSecurityOverview
);

// Change password (logged-in user)
router.post(
  "/change-password",
  auth,
  changePassword
);

// Update recovery details
router.put(
  "/update/recovery",
  auth,
  updateRecoveryDetails
);

// ================= SUPER ADMIN RESET (OTP BASED) =================

// 🔐 Send OTP (NO auth required)
router.post(
  "/super-admin/send-reset-otp",
  sendSuperAdminResetOtp
);

// 🔐 Verify OTP + Reset Password (NO auth required)
router.post(
  "/super-admin/verify-reset-otp",
  verifySuperAdminOtpAndResetPassword
);

module.exports = router;