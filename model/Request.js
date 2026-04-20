const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
  itemName: { type: String, required: true },
  Decofitem: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  requiredDate: { type: Date },
  priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  deliveryAddress: { type: String },

 
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  status: {
    type: String,
    enum: ['requested', 'approved', 'invoice_uploaded', 'dispatched', 'rejected'],
    default: 'requested'
  },

  token: { type: String, unique: true, sparse: true },

  timestamps: {
    requested: { type: Date, default: Date.now },
    approved: { type: Date },
    invoiceUploaded: { type: Date },
    dispatched: { type: Date }
  },

  invoice: {
    filePath: { type: String },
    fileType: { type: String, enum: ['pdf', 'image'], default: 'pdf' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },

  rejectionReason: { type: String },

  dispatchHistory: [
    {
      quantity: Number,
      rate: Number,
      branch: String,
      dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      dispatchedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      dispatchedAt: Date
    }
  ]

}, { timestamps: true });

module.exports = mongoose.model('Request', requestSchema);
