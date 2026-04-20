const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },

  customerName: { type: String, required: true },
  customerEmail: { type: String },
  customerAddress: { type: String },

  item: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Item', 
    required: true 
  },

  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  totalAmount: { type: Number },

  // ✅ Invoice Upload Info
  invoice: {
    filePath: { type: String }, // ex: /uploads/invoices/invoice_123.pdf
    fileType: { type: String, enum: ['pdf', 'image'], default: 'pdf' },
    uploadedAt: { type: Date }
  },

  // ✅ For tracking & record
  saleDate: { type: Date, default: Date.now }
});

// ✅ Automatically calculate total amount before saving
saleSchema.pre('save', function (next) {
  this.totalAmount = this.quantity * this.price;
  next();
});

module.exports = mongoose.model('Sale', saleSchema);
