import mongoose from 'mongoose';

const paymentHistorySchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  method: {
    type: String,
    enum: ['cash', 'bank_transfer', 'check'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  saleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale'
  },
  notes: String
});

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  phone: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  creditLimit: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  creditBalance: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  paymentHistory: [paymentHistorySchema],
  lastPurchaseDate: {
    type: Date
  },
  notes: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Add index for search performance
customerSchema.index({ name: 'text', code: 'text', email: 'text' });

// Virtual field for calculating available credit
customerSchema.virtual('availableCredit').get(function() {
  return this.creditLimit - this.creditBalance;
});

// Method to check if customer can make a credit purchase
customerSchema.methods.canMakeCreditPurchase = function(amount) {
  return this.status === 'active' && (this.creditBalance + amount) <= this.creditLimit;
};

// Method to process credit payment
customerSchema.methods.processCreditPayment = async function(amount, method, saleId) {
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  if (amount > this.creditBalance) {
    throw new Error('Payment amount exceeds credit balance');
  }

  this.creditBalance -= amount;
  this.paymentHistory.push({
    amount,
    method,
    status: 'completed',
    saleId,
    date: new Date()
  });

  await this.save();
  return this;
};

// Method to update credit balance
customerSchema.methods.updateCreditBalance = async function(amount, operation = 'add') {
  const newBalance = operation === 'add' 
    ? this.creditBalance + amount
    : this.creditBalance - amount;

  if (newBalance < 0) {
    throw new Error('Credit balance cannot be negative');
  }

  if (operation === 'add' && newBalance > this.creditLimit) {
    throw new Error('Credit limit exceeded');
  }

  this.creditBalance = newBalance;
  await this.save();
  return this;
};

// Pre-save hook to validate credit balance
customerSchema.pre('save', function(next) {
  if (this.creditBalance > this.creditLimit) {
    next(new Error('Credit balance cannot exceed credit limit'));
  }
  next();
});

const Customer = mongoose.model('Customer', customerSchema);

export default Customer; 