const express = require("express");
const router = express.Router();
const checkRole = require("../../middleware/role");
const auth = require("../../middleware/auth");
const authController = require("../../controllers/sqlbase/auth.controller");



router.post("/login", authController.login);
router.post("/register", authController.register);


router.post("/request-password-reset", authController.requestPasswordReset);
router.post("/verify-password-reset-otp", authController.verifyPasswordResetOTP);
router.post("/reset-password", authController.resetPasswordWithOTP);


router.get("/notifications", auth,checkRole(["super_admin","admin"]), authController.getMyNotifications);
router.patch(
  "/notifications/:id/read",
 auth,checkRole(["super_admin","admin"]),
  authController.markNotificationRead
);


router.get("/recent-activities",auth,checkRole(["super_admin","admin"]), authController.getRecentActivities);

module.exports = router;