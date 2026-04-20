const sequelize = require("../../config/sqlcon");

const User = require("./user");
const Role = require("./role");
const Stock = require("./stock.record");
const Branch = require("./branch");
const StockMovement = require("./stockmovement");
const Ledger = require("./ladger");

const Client = require("./client");
const ClientLedger = require("./client.ladger");

const {
  Quotation,
  QuotationItem
} = require("./Quotation");

const Invoice = require("./invoice");
const InvoiceItem = require("./InvoiceItem");

const Notification = require("./notification");
const PasswordReset = require("./passwordreset");
const RecentActivity = require("./recentactivity");
const SystemSetting = require("./systemSetting");
const SecurityActivity = require("./securityactivity");
// ================= USER =================

User.belongsTo(Role, { foreignKey: "role_id", as: "role" });
Role.hasMany(User, { foreignKey: "role_id", as: "users" });

Branch.hasMany(User, { foreignKey: "branch_id", as: "users" });
User.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

// ================= STOCK MOVEMENT =================

Stock.hasMany(StockMovement, { foreignKey: "stock_id", as: "movements" });
StockMovement.belongsTo(Stock, { foreignKey: "stock_id", as: "stock" });

// ================= STOCK =================

Branch.hasMany(Stock, { foreignKey: "branch_id", as: "stocks" });
Stock.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

User.hasMany(Stock, { foreignKey: "owner_id", as: "stocks" });
Stock.belongsTo(User, { foreignKey: "owner_id", as: "owner" });

// ================= LEDGER =================

Branch.hasMany(Ledger, { foreignKey: "branch_id", as: "ledgerEntries" });
Ledger.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

Stock.hasMany(Ledger, { foreignKey: "stock_id", as: "ledgerEntries" });
Ledger.belongsTo(Stock, { foreignKey: "stock_id", as: "stock" });

User.hasMany(Ledger, { foreignKey: "created_by", as: "ledgerCreated" });
Ledger.belongsTo(User, { foreignKey: "created_by", as: "creator" });

// ================= CLIENT =================

Branch.hasMany(Client, { foreignKey: "branch_id", as: "clients" });
Client.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

Client.hasMany(ClientLedger, { foreignKey: "client_id", as: "ledger" });
ClientLedger.belongsTo(Client, { foreignKey: "client_id", as: "client" });

Branch.hasMany(ClientLedger, { foreignKey: "branch_id", as: "clientLedger" });
ClientLedger.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

// ================= QUOTATION =================

Client.hasMany(Quotation, { foreignKey: "client_id", as: "quotations" });
Quotation.belongsTo(Client, { foreignKey: "client_id", as: "client" });

Branch.hasMany(Quotation, { foreignKey: "branch_id", as: "quotations" });
Quotation.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

Quotation.hasMany(QuotationItem, {
  foreignKey: "quotation_id",
  as: "quotationItems"
});

QuotationItem.belongsTo(Quotation, {
  foreignKey: "quotation_id",
  as: "quotation"
});

// ================= INVOICE =================

Client.hasMany(Invoice, { foreignKey: "client_id", as: "invoices" });
Invoice.belongsTo(Client, { foreignKey: "client_id", as: "client" });

Branch.hasMany(Invoice, { foreignKey: "branch_id", as: "invoices" });
Invoice.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

Invoice.hasMany(InvoiceItem, {
  foreignKey: "invoice_id",
  as: "invoiceItems"
});

InvoiceItem.belongsTo(Invoice, {
  foreignKey: "invoice_id",
  as: "invoice"
});

// ================= PASSWORD RESET =================

User.hasMany(PasswordReset, { foreignKey: "user_id", as: "passwordResets" });
PasswordReset.belongsTo(User, { foreignKey: "user_id", as: "user" });

Branch.hasMany(PasswordReset, { foreignKey: "branch_id", as: "passwordResets" });
PasswordReset.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

// ================= NOTIFICATION =================

User.hasMany(Notification, { foreignKey: "user_id", as: "notifications" });
Notification.belongsTo(User, { foreignKey: "user_id", as: "user" });

// ================= RECENT ACTIVITY =================

// ================= RECENT ACTIVITY =================

User.hasMany(RecentActivity, { foreignKey: "user_id", as: "activities" });
RecentActivity.belongsTo(User, { foreignKey: "user_id", as: "user" });

Branch.hasMany(RecentActivity, { foreignKey: "branch_id", as: "recentActivities" });
RecentActivity.belongsTo(Branch, { foreignKey: "branch_id", as: "branch" });

// ================= SYSTEM SETTINGS =================

User.hasMany(SystemSetting, { foreignKey: "created_by", as: "createdSettings" });
User.hasMany(SystemSetting, { foreignKey: "updated_by", as: "updatedSettings" });

SystemSetting.belongsTo(User, { foreignKey: "created_by", as: "creator" });
SystemSetting.belongsTo(User, { foreignKey: "updated_by", as: "updater" });

User.hasMany(SecurityActivity, { foreignKey: "user_id", as: "security_activities" });
SecurityActivity.belongsTo(User, { foreignKey: "user_id", as: "user" });
// ================= INIT DB =================

const initDB = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    console.log("✅ DB connected");

    const roles = [
      "super_admin",
      "admin",
      "hr_admin",
      "stock_manager",
      "sales_manager",
      "super_sales_manager",
      "super_stock_manager",
      "inventory_manager",
      "super_inventory_manager",
      "purchase_manager",
      "sales_person",
      "inventory_person",
      "finance"
    ];

    for (const name of roles) {
      await Role.findOrCreate({
        where: { name },
        defaults: { name }
      });
    }

    console.log("✅ Roles initialized");
  } catch (error) {
    console.error("❌ DB init error:", error);
  }
};

module.exports = {
  sequelize,
  initDB,

  User,
  Role,
  Stock,
  Branch,
  Ledger,

  Client,
  ClientLedger,
  StockMovement,

  Quotation,
  QuotationItem,

  Invoice,
  InvoiceItem,

  Notification,
  PasswordReset,
  RecentActivity,
  SystemSetting,
  SecurityActivity
};