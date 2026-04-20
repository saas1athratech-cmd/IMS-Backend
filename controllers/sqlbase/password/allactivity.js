const { Op } = require("sequelize");
const {
  User,
  Role,
  PasswordResetRequest,
  Notification,
  RecentActivity,
  Branch
} = require("../../model/SQL_Model");
const generateOTP = require("../../utils/generateOTP");

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    const user = await User.findOne({
      where: { email },
      include: [
        { model: Role, as: "role", attributes: ["id", "name"] },
        { model: Branch, as: "branch", attributes: ["id", "name"] }
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "User is inactive"
      });
    }

    if (user.role?.name === "super_admin") {
      return res.status(400).json({
        success: false,
        message: "Super admin can use different reset flow"
      });
    }

    const existingPending = await PasswordResetRequest.findOne({
      where: {
        user_id: user.id,
        status: "pending",
        expires_at: {
          [Op.gt]: new Date()
        }
      }
    });

    if (existingPending) {
      return res.status(400).json({
        success: false,
        message: "OTP already generated. Contact super admin."
      });
    }

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const resetRequest = await PasswordResetRequest.create({
      user_id: user.id,
      branch_id: user.branch_id,
      otp,
      expires_at: expiresAt
    });

    const superAdminRole = await Role.findOne({
      where: { name: "super_admin" }
    });

    const superAdmins = await User.findAll({
      where: {
        role_id: superAdminRole.id,
        is_active: true
      }
    });

    if (superAdmins.length) {
      await Notification.bulkCreate(
        superAdmins.map((admin) => ({
          user_id: admin.id,
          title: "Password Reset OTP Request",
          message: `${user.name} (${user.email}) | Role: ${user.role?.name} | Branch: ${user.branch?.name || "N/A"} | OTP: ${otp}`,
          type: "password_reset_request"
        }))
      );
    }

    await RecentActivity.create({
      user_id: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      details: `${user.name} (${user.email}) requested password reset. OTP sent to super admin.`,
      ref_id: resetRequest.id,
      ref_type: "password_reset_request"
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent to super admin. Please contact super admin for OTP."
    });
  } catch (error) {
    console.error("requestPasswordReset error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};

exports.verifyPasswordResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required"
      });
    }

    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const resetRequest = await PasswordResetRequest.findOne({
      where: {
        user_id: user.id,
        otp,
        status: "pending"
      },
      order: [["createdAt", "DESC"]]
    });

    if (!resetRequest) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    if (new Date(resetRequest.expires_at) < new Date()) {
      resetRequest.status = "expired";
      await resetRequest.save();

      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    resetRequest.status = "verified";
    resetRequest.verified_at = new Date();
    await resetRequest.save();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully"
    });
  } catch (error) {
    console.error("verifyPasswordResetOTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};


exports.resetPasswordWithOTP = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP and newPassword are required"
      });
    }

    const user = await User.findOne({
      where: { email },
      include: [
        { model: Role, as: "role", attributes: ["name"] },
        { model: Branch, as: "branch", attributes: ["name"] }
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const resetRequest = await PasswordResetRequest.findOne({
      where: {
        user_id: user.id,
        otp,
        status: "verified"
      },
      order: [["createdAt", "DESC"]]
    });

    if (!resetRequest) {
      return res.status(400).json({
        success: false,
        message: "OTP not verified or invalid"
      });
    }

    if (new Date(resetRequest.expires_at) < new Date()) {
      resetRequest.status = "expired";
      await resetRequest.save();

      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    user.password = newPassword;
    await user.save();

    resetRequest.status = "used";
    await resetRequest.save();

    const superAdminRole = await Role.findOne({
      where: { name: "super_admin" }
    });

    const superAdmins = await User.findAll({
      where: {
        role_id: superAdminRole.id,
        is_active: true
      }
    });

    if (superAdmins.length) {
      await Notification.bulkCreate(
        superAdmins.map((admin) => ({
          user_id: admin.id,
          title: "Password Reset Completed",
          message: `${user.name} (${user.email}) | Role: ${user.role?.name} | Branch: ${user.branch?.name || "N/A"} has successfully reset password.`,
          type: "password_reset_done"
        }))
      );
    }

    await RecentActivity.create({
      user_id: user.id,
      action: "PASSWORD_RESET_COMPLETED",
      details: `${user.name} (${user.email}) reset password successfully.`,
      ref_id: resetRequest.id,
      ref_type: "password_reset_request"
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successful"
    });
  } catch (error) {
    console.error("resetPasswordWithOTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};

exports.getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { user_id: req.user.id },
      order: [["createdAt", "DESC"]],
      limit: 20
    });

    return res.status(200).json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error("getMyNotifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications"
    });
  }
};

exports.getRecentActivities = async (req, res) => {
  try {
    const activities = await RecentActivity.findAll({
      order: [["createdAt", "DESC"]],
      limit: 20
    });

    return res.status(200).json({
      success: true,
      data: activities
    });
  } catch (error) {
    console.error("getRecentActivities error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch recent activities"
    });
  }
};