const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();
const app = express();

// 🔥 ADD THIS
const { initDB } = require("./model/SQL_Model");
// CORS Policy
const corsOptions = {
  origin: [
    "http://localhost:3000", // React local
    "http://localhost:5173", // Vite local
    "https://inventorysystem-opal.vercel.app" // production frontend
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};
// Middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔥 START SEQUELIZE (Postgres)
initDB();

// Routes
app.use("/api", require("./routes/authroutes"));
app.use("/api/request", require("./routes/requests"));
app.use("/api/stock", require("./routes/stock"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/profile", require("./routes/userRoutes"));

// sql base route 
app.use("/sql", require("./routes/sql/sqlauth"));
app.use("/sqlstock", require("./routes/sql/stock.sql"));
app.use('/hrrole',require('./routes/sql/sqlhr.route'));
app.use("/sqlbranch", require("./routes/sql/sql.admin"));
app.use('/stock-manager',require('./routes/sql/stock.manager'))
app.use('/ladger',require('./routes/sql/ladgerroute'))
 
app.use('/sales',require('./routes/sql/sales'))
app.use('/combine',require('./routes/sql/combineroute'))
app.use("/system-setting", require("./routes/sql/systemSettingRoutes"));
app.use('/getcsv',require('./routes/sql/csv'))
app.use('/profile',require('./routes/sql/profile'))
// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB connection error:", err));

// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!", error: err.message });
});
