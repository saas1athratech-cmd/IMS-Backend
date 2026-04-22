require("dotenv").config();
require("./instrument");

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const Sentry = require("@sentry/node");

const app = express();

const { initDB } = require("./model/SQL_Model");

// CORS Policy
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://inventorysystem-opal.vercel.app",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

// Middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Test route for Sentry
app.get("/debug-sentry", (req, res) => {
  throw new Error("Sentry test error 🚀");
});

// Routes
app.use("/api", require("./routes/authroutes"));
app.use("/api/request", require("./routes/requests"));
app.use("/api/stock", require("./routes/stock"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/profile", require("./routes/userRoutes"));

// sql base route
app.use("/sql", require("./routes/sql/sqlauth"));
app.use("/sqlstock", require("./routes/sql/stock.sql"));
app.use("/hrrole", require("./routes/sql/sqlhr.route"));
app.use("/sqlbranch", require("./routes/sql/sql.admin"));
app.use("/stock-manager", require("./routes/sql/stock.manager"));
app.use("/ladger", require("./routes/sql/ladgerroute"));
app.use("/sales", require("./routes/sql/sales"));
app.use("/combine", require("./routes/sql/combineroute"));
app.use("/system-setting", require("./routes/sql/systemSettingRoutes"));
app.use("/getcsv", require("./routes/sql/csv"));
app.use("/profile", require("./routes/sql/profile"));

// Sentry error handler
Sentry.setupExpressErrorHandler(app);

// Custom error handling
app.use((err, req, res, next) => {
  console.error("Error Stack:", err.stack);

  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: err.message,
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  Sentry.captureException(reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  Sentry.captureException(error);
});

async function startServer() {
  try {
    // MongoDB Connection
    await mongoose.connect(process.env.MONGO_URL);
    console.log("✅ MongoDB connected");

    // PostgreSQL / Sequelize init
    await initDB();
    console.log("✅ SQL DB initialized");

    // Start server only after both DBs are ready
    const PORT = process.env.PORT || 8000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    Sentry.captureException(error);
    process.exit(1);
  }
}

startServer();