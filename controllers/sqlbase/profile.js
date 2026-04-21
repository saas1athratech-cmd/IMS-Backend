const { Op } = require("sequelize");
const User = require("../../model/SQL_Model/user");
const cloudinary = require("../../config/cloudanry"); // ✅ FIXED
const PasswordReset = require("../../model/SQL_Model/passwordreset");
exports.setProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const { name, email, phone, address } = req.body;

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (user.is_profile_set) {
      return res.status(400).json({
        success: false,
        message: "Profile already set. Use update API."
      });
    }

    let imageUrl = null;
    let publicId = null;

    // 🖼️ IMAGE UPLOAD
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: "user_profiles" },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        ).end(req.file.buffer);
      });

      imageUrl = result.secure_url;
      publicId = result.public_id;
    }

    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || null;
    user.address = address || null;

    user.profile_image = imageUrl;
    user.profile_image_public_id = publicId;

    user.is_profile_set = true;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile set successfully",
      data: user
    });

  } catch (error) {
    console.error("SET PROFILE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to set profile",
      error: error.message
    });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const { name, email, phone, address } = req.body;

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    let imageUrl = null;
    let publicId = null;

    // 🖼️ IMAGE UPDATE
    if (req.file) {
      // delete old image
      if (user.profile_image_public_id) {
        await cloudinary.uploader.destroy(user.profile_image_public_id);
      }

      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: "user_profiles" },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        ).end(req.file.buffer);
      });

      imageUrl = result.secure_url;
      publicId = result.public_id;

      user.profile_image = imageUrl;
      user.profile_image_public_id = publicId;
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (address) user.address = address;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: user
    });

  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: error.message
    });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    // ✅ USER FETCH
    const user = await User.findByPk(userId, {
      attributes: { exclude: ["password"] }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // ✅ LAST PASSWORD CHANGE FETCH
    const lastPasswordReset = await PasswordReset.findOne({
      where: {
        user_id: userId,
        verified_at: {
          [Op.ne]: null // 🔥 IMPORTANT FIX
        }
      },
      order: [["verified_at", "DESC"]]
    });

    // ✅ FINAL RESPONSE
    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      data: {
        ...user.toJSON(),

        // 🔥 LAST PASSWORD CHANGE FIELD
        last_password_change: lastPasswordReset
          ? lastPasswordReset.verified_at
          : null
      }
    });

  } catch (error) {
    console.error("GET PROFILE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message
    });
  }
};