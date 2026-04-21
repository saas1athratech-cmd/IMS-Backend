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
    }
  },
  {
    tableName: "users",
    underscored: true,
    timestamps: true
  }
);

// ========================
// 🔐 HASH PASSWORD
// ========================
User.beforeCreate(async (user) => {
  if (user.password) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed("password")) {
    user.password = await bcrypt.hash(user.password, 10);
  }
});

// ========================
// 🔑 VALIDATE PASSWORD
// ========================
User.prototype.validatePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = User;