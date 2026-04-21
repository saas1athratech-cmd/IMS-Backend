const express = require("express");
const router = express.Router();
const checkRole = require("../../middleware/role");
const auth = require("../../middleware/auth");
const profileController = require("../../controllers/sqlbase/profile");
const upload = require("../../utils/multer")


router.post(
  "/set-profile",
  auth,
  upload.single("image"),
  profileController.setProfile
);
router.post("/upload",auth, upload.single("image"),profileController.updateProfile);
router.get('/get-profile',auth,profileController.getProfile)
module.exports = router;