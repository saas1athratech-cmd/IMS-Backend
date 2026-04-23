// const { Sequelize } = require("sequelize");
// require("dotenv").config();

// const sequelize = new Sequelize(
//   process.env.DB_NAME,
//   process.env.DB_USER,
//   process.env.DB_PASSWORD,
//   {
//     host: process.env.DB_HOST || "localhost",
//     dialect: "postgres",
//     logging: false,
//   }
// );

// module.exports = sequelize;

//ye deployment k liye h 
const { Sequelize } = require("sequelize");
require("dotenv").config();

let sequelize;

const commonConfig = {
  dialect: "postgres",
  logging: false,

  define: {
    schema: "public",          // ✅ public schema
    freezeTableName: true,     // ✅ exact table name
    underscored: true,         // ✅ snake_case columns

    timestamps: true,          // created_at / updated_at
    createdAt: "created_at",
    updatedAt: "updated_at",
  },

  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
};

if (process.env.DATABASE_URL) {
  // 🌍 Production / Render / Supabase
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    ...commonConfig,

    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  });
} else {
  // 💻 Local Development
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST || "localhost",
      port: process.env.DB_PORT || 5432,

      ...commonConfig,
    }
  );
}

module.exports = sequelize;




// const { Sequelize } = require("sequelize");
// require("dotenv").config();

// const sequelize = new Sequelize(process.env.DATABASE_URL, {
//   dialect: "postgres",
//   logging: false,
//   dialectOptions: {
//     ssl: {
//       require: true,
//       rejectUnauthorized: false,
//     },
//   },
//   pool: {
//     max: 5,
//     min: 0,
//     acquire: 30000,
//     idle: 10000,
//   },
// });

// module.exports = sequelize;