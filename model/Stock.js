const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
  branch: String,
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item' },
  quantity: Number,
  rate: Number,   
  value: Number,  
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ownerType: { type: String, enum: ['admin', 'user'], default: 'user' }
});


stockSchema.pre('save', function (next) {
  this.value = this.quantity * this.rate;
  next();
});

module.exports = mongoose.model('Stock', stockSchema);
