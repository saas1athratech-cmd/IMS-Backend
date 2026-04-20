const bcrypt = require("bcrypt");
const sgMail = require("@sendgrid/mail");
const UAParser = require("ua-parser-js");
const {
  SystemSetting,
  User,
  Role,
  SecurityActivity,
  PasswordReset
} = require("../../../model/SQL_Model");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const SUPER_ROLES = [
  "super_admin",
  "super_sales_manager",
  "super_inventory_manager",
  "super_stock_manager",
  "super_purchase_manager"
];

function getRoleName(req) {
  return String(
    req.user?.role?.name ||
      req.user?.role_name ||
      req.user?.role ||
      ""
  )
    .toLowerCase()
    .trim();
}

function cleanValue(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return value;
}
function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    null
  );
}

function getDeviceInfo(req) {
  const ua = req.headers["user-agent"] || "";
  const parser = new UAParser(ua);
  const result = parser.getResult();

  return {
    device:
      result.device.vendor && result.device.model
        ? `${result.device.vendor} ${result.device.model}`
        : result.device.type || "Desktop",
    browser: result.browser.name
      ? `${result.browser.name} ${result.browser.version || ""}`.trim()
      : "Unknown Browser",
    os: result.os.name
      ? `${result.os.name} ${result.os.version || ""}`.trim()
      : "Unknown OS",
    user_agent: ua
  };
}

function getLoggedInTarget(req) {
  const roleName = getRoleName(req);
  const userBranchId = req.user?.branch_id ?? null;

  if (SUPER_ROLES.includes(roleName)) {
    return {
      roleName,
      branch_id: null
    };
  }

  if (roleName === "admin") {
    if (!userBranchId) {
      return {
        roleName,
        error: "Admin user branch not found"
      };
    }

    return {
      roleName,
      branch_id: userBranchId
    };
  }

  return {
    roleName,
    branch_id: userBranchId
  };
}

function getRequestMeta(req) {
  return {
    device_name: req.headers["user-agent"] || "Unknown Device",
    ip_address:
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      null,
    location: "India"
  };
}

// ================= GET SETTINGS =================
exports.getSystemSettings = async (req, res) => {
  try {
    const target = getLoggedInTarget(req);

    if (target.error) {
      return res.status(400).json({
        success: false,
        message: target.error
      });
    }

    let settings = await SystemSetting.findOne({
      where: { branch_id: target.branch_id },
      order: [["id", "DESC"]]
    });

    if (!settings && target.branch_id !== null) {
      settings = await SystemSetting.findOne({
        where: { branch_id: null },
        order: [["id", "DESC"]]
      });
    }

    return res.status(200).json({
      success: true,
      message: "System settings fetched successfully",
      data: settings || null
    });
  } catch (error) {
    console.error("getSystemSettings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch system settings",
      error: error.message
    });
  }
};

// ================= CREATE / UPDATE SETTINGS =================
exports.upsertSystemSettings = async (req, res) => {
  try {
    const target = getLoggedInTarget(req);

    if (target.error) {
      return res.status(400).json({
        success: false,
        message: target.error
      });
    }

    if (
      target.roleName !== "admin" &&
      !SUPER_ROLES.includes(target.roleName)
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to update system settings"
      });
    }

    const company_name = cleanValue(req.body.company_name);
    const time_zone = cleanValue(req.body.time_zone);
    const date_format = cleanValue(req.body.date_format);
    const currency = cleanValue(req.body.currency);

    let settings = await SystemSetting.findOne({
      where: { branch_id: target.branch_id }
    });

    if (!settings) {
      if (!company_name) {
        return res.status(400).json({
          success: false,
          message: "company_name is required"
        });
      }

      settings = await SystemSetting.create({
        branch_id: target.branch_id,
        company_name,
        time_zone: time_zone || "Asia/Kolkata",
        date_format: date_format || "DD/MM/YYYY",
        currency: currency || "INR",
        created_by: req.user?.id || null,
        updated_by: req.user?.id || null
      });

      return res.status(201).json({
        success: true,
        message: "System settings created successfully",
        data: settings
      });
    }

    await settings.update({
      company_name: company_name ?? settings.company_name,
      time_zone: time_zone ?? settings.time_zone,
      date_format: date_format ?? settings.date_format,
      currency: currency ?? settings.currency,
      updated_by: req.user?.id || null
    });

    return res.status(200).json({
      success: true,
      message: "System settings updated successfully",
      data: settings
    });
  } catch (error) {
    console.error("upsertSystemSettings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save system settings",
      error: error.message
    });
  }
};

// ================= DELETE SETTINGS =================
exports.deleteSystemSettings = async (req, res) => {
  try {
    const target = getLoggedInTarget(req);

    if (target.error) {
      return res.status(400).json({
        success: false,
        message: target.error
      });
    }

    if (
      target.roleName !== "admin" &&
      !SUPER_ROLES.includes(target.roleName)
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to delete system settings"
      });
    }

    const settings = await SystemSetting.findOne({
      where: { branch_id: target.branch_id }
    });

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: "System settings not found"
      });
    }

    await settings.destroy();

    return res.status(200).json({
      success: true,
      message: "System settings deleted successfully"
    });
  } catch (error) {
    console.error("deleteSystemSettings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete system settings",
      error: error.message
    });
  }
};

// ================= SECURITY OVERVIEW =================
exports.getSecurityOverview = async (req, res) => {
  try {
    const userId = req.user?.id;
    const currentToken = req.headers.authorization?.split(" ")[1] || null;

    const user = await User.findByPk(userId, {
      attributes: ["id", "email", "last_login"]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const activeDevicesRows = await SecurityActivity.findAll({
      where: {
        user_id: userId,
        activity_type: "login",
        is_active: true
      },
      attributes: [
        "id",
        "device_name",
        "ip_address",
        "location",
        "logged_in_at",
        "logout_at",
        "session_token",
        "is_active",
        "created_at",
        "updated_at"
      ],
      order: [["logged_in_at", "DESC"]]
    });

    const recentActivitiesRows = await SecurityActivity.findAll({
      where: {
        user_id: userId,
        activity_type: "login"
      },
      attributes: [
        "id",
        "device_name",
        "ip_address",
        "location",
        "logged_in_at",
        "logout_at",
        "is_active",
        "created_at",
        "updated_at"
      ],
      order: [["logged_in_at", "DESC"]],
      limit: 10
    });

    const activeDevices = activeDevicesRows.map((item) => ({
      id: item.id,
      device_name: item.device_name || "Unknown Device",
      ip_address: item.ip_address || null,
      location: item.location || null,
      logged_in_at: item.logged_in_at || null,
      is_active: item.is_active,
      current_device: currentToken
        ? item.session_token === currentToken
        : false
    }));

    const recentActivities = recentActivitiesRows.map((item) => ({
      id: item.id,
      device_name: item.device_name || "Unknown Device",
      ip_address: item.ip_address || null,
      location: item.location || null,
      logged_in_at: item.logged_in_at || null,
      logout_at: item.logout_at || null,
      is_active: item.is_active
    }));

    return res.status(200).json({
      success: true,
      message: "Security details fetched successfully",
      data: {
        email: user.email,
        last_login: user.last_login || null,
        active_device_count: activeDevices.length,
        active_devices: activeDevices,
        recent_login_history: recentActivities
      }
    });
  } catch (error) {
    console.error("getSecurityOverview error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch security details",
      error: error.message
    });
  }
};

// ================= CHANGE PASSWORD =================
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: "current_password and new_password are required"
      });
    }

    if (String(new_password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters"
      });
    }

    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const isValid = await user.validatePassword(current_password);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect"
      });
    }

    const ipAddress = getClientIp(req);
    const deviceInfo = getDeviceInfo(req);
    const changedAt = new Date();

    user.password = new_password;
    await user.save();

    await SecurityActivity.create({
      user_id: userId,
      activity_type: "password_change",
      password_changed_at: changedAt,
      ip_address: ipAddress,
      device: deviceInfo.device,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      user_agent: deviceInfo.user_agent
    });

    let emailSent = false;

    try {
      if (
        process.env.SENDGRID_API_KEY &&
        process.env.SENDGRID_FROM_EMAIL &&
        user.email
      ) {
        await sgMail.send({
          to: user.email,
          from: {
            email: process.env.SENDGRID_FROM_EMAIL,
            name: "Your App Name"
          },
          subject: "Your password has been changed",
          html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
              <h2 style="margin-bottom: 10px;">Password Changed Successfully</h2>
              <p>Hello ${user.name || "User"},</p>
              <p>Your account password has been changed successfully.</p>

              <div style="margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 8px;">
                <h3 style="margin-top: 0;">Change Details</h3>
                <p><strong>Time:</strong> ${changedAt.toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata"
                })}</p>
                <p><strong>IP Address:</strong> ${ipAddress || "Unknown"}</p>
                <p><strong>Device:</strong> ${deviceInfo.device}</p>
                <p><strong>Browser:</strong> ${deviceInfo.browser}</p>
                <p><strong>OS:</strong> ${deviceInfo.os}</p>
              </div>

              <p>If you made this change, no further action is required.</p>
              <p>If you did not change your password, please reset it immediately and contact support.</p>

              <br />
              <p>Regards,<br />Your App Team</p>
            </div>
          `
        });

        emailSent = true;
      }
    } catch (mailError) {
      console.error(
        "Password changed but email failed:",
        JSON.stringify(mailError.response?.body || mailError.message, null, 2)
      );
    }

    return res.status(200).json({
      success: true,
      message: emailSent
        ? "Password changed successfully and confirmation email sent"
        : "Password changed successfully, but confirmation email could not be sent"
    });
  } catch (error) {
    console.error("changePassword error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to change password",
      error: error.message
    });
  }
};

// ================= SUPER ADMIN SEND OTP =================
exports.sendSuperAdminResetOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
      return res.status(500).json({
        success: false,
        message: "SendGrid configuration missing"
      });
    }

    const user = await User.findOne({
      where: { email },
      include: [
        {
          model: Role,
          as: "role",
          attributes: ["name"]
        }
      ]
    });

    // Security: same response for invalid/non-super-admin email
    if (!user || user.role?.name !== "super_admin") {
      return res.status(200).json({
        success: true,
        message: "If account exists, OTP sent"
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // old pending OTPs expire/use
    await PasswordReset.update(
      { status: "used" },
      {
        where: {
          user_id: user.id,
          status: "pending"
        }
      }
    );

    await PasswordReset.create({
      user_id: user.id,
      branch_id: null,
      otp,
      status: "pending",
      expires_at: expiresAt
    });

    const msg = {
      to: email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL,
        name: "Your App Name"
      },
      subject: "Super Admin Password Reset OTP",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
          <h2 style="margin-bottom: 10px;">Super Admin Password Reset</h2>
          <p>Hello,</p>
          <p>Your OTP for password reset is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; margin: 20px 0; color: #111;">
            ${otp}
          </div>
          <p>This OTP will expire in <b>10 minutes</b>.</p>
          <p>If you did not request this, please ignore this email.</p>
          <br/>
          <p>Regards,<br/>Your App Team</p>
        </div>
      `
    };

    await sgMail.send(msg);

    return res.status(200).json({
      success: true,
      message: "OTP sent to super admin email"
    });
  } catch (error) {
    console.error(
      "sendSuperAdminResetOtp error:",
      JSON.stringify(error.response?.body || error.message, null, 2)
    );

    const sgError =
      error.response?.body?.errors?.[0]?.message ||
      error.response?.body?.message ||
      error.message;

    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: sgError
    });
  }
};

// ================= SUPER ADMIN VERIFY OTP + RESET PASSWORD =================
exports.verifySuperAdminOtpAndResetPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const otp = String(req.body.otp || "").trim();
    const new_password = String(req.body.new_password || "").trim();

    if (!email || !otp || !new_password) {
      return res.status(400).json({
        success: false,
        message: "email, otp and new_password are required"
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters"
      });
    }

    const user = await User.findOne({
      where: { email },
      include: [
        {
          model: Role,
          as: "role",
          attributes: ["name"]
        }
      ]
    });

    if (!user || user.role?.name !== "super_admin") {
      return res.status(400).json({
        success: false,
        message: "Invalid request"
      });
    }

    const resetRecord = await PasswordReset.findOne({
      where: {
        user_id: user.id,
        otp,
        status: "pending"
      },
      order: [["created_at", "DESC"]]
    });

    if (!resetRecord) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    if (new Date() > new Date(resetRecord.expires_at)) {
      await resetRecord.update({
        status: "expired"
      });

      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    user.password = new_password;
    await user.save();

    await resetRecord.update({
      status: "used",
      verified_at: new Date()
    });

    await SecurityActivity.create({
      user_id: user.id,
      activity_type: "password_change",
      password_changed_at: new Date(),
      ...getRequestMeta(req)
    });

    return res.status(200).json({
      success: true,
      message: "Super admin password reset successfully"
    });
  } catch (error) {
    console.error("verifySuperAdminOtpAndResetPassword error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset password",
      error: error.message
    });
  }
};

// ================= UPDATE RECOVERY DETAILS =================
exports.updateRecoveryDetails = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { recovery_phone, recovery_email } = req.body;

    if (recovery_phone === undefined && recovery_email === undefined) {
      return res.status(400).json({
        success: false,
        message: "recovery_phone or recovery_email is required"
      });
    }

    const previousRecovery = await SecurityActivity.findOne({
      where: {
        user_id: userId,
        activity_type: "recovery_update"
      },
      order: [["created_at", "DESC"]]
    });

    await SecurityActivity.create({
      user_id: userId,
      activity_type: "recovery_update",
      recovery_phone:
        recovery_phone !== undefined
          ? recovery_phone
          : previousRecovery?.recovery_phone || null,
      recovery_email:
        recovery_email !== undefined
          ? recovery_email
          : previousRecovery?.recovery_email || null,
      ...getRequestMeta(req)
    });

    const latestRecovery = await SecurityActivity.findOne({
      where: {
        user_id: userId,
        activity_type: "recovery_update"
      },
      order: [["created_at", "DESC"]]
    });

    return res.status(200).json({
      success: true,
      message: "Recovery details updated successfully",
      data: {
        recovery_phone: latestRecovery?.recovery_phone || null,
        recovery_email: latestRecovery?.recovery_email || null
      }
    });
  } catch (error) {
    console.error("updateRecoveryDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update recovery details",
      error: error.message
    });
  }
};