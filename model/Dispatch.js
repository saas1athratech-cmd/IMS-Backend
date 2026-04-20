const mongoose = require('mongoose');

const dispatchSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Request', required: true },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity: { type: Number, required: true },
  rate: { type: Number, required: true },
  branch: { type: String },
  dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dispatchedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dispatchedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Dispatch', dispatchSchema);
