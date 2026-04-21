const { DataTypes } = require("sequelize");
const bcrypt = require("bcrypt");
const sequelize = require("../../config/sqlcon");

const User = sequelize.define(
  "User",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },

    password: {
      type: DataTypes.STRING,
      allowNull: false
    },

    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },

    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    profile_image: {
      type: DataTypes.STRING,
      allowNull: true
    },

    profile_image_public_id: {
      type: DataTypes.STRING,
      allowNull: true
    },

    is_profile_set: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    secure_password: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    role_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "branches",
        key: "id"
      }
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },

    last_login: {
      type: DataTypes.DATE,
      allowNull: true
    },

    password_changed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },

    recovery_email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      }
    },

    recovery_phone: {
      type: DataTypes.STRING,
      allowNull: true
    }
  },
  {
    tableName: "users",
    schema: "public",
    underscored: true,
    timestamps: true
  }
);

User.beforeCreate(async (user) => {
  if (user.password) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed("password")) {
    user.password = await bcrypt.hash(user.password, 10);
    user.password_changed_at = new Date();
  }
});

User.prototype.validatePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = User;