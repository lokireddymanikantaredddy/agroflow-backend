import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentType: {
    type: String,
    enum: ['cash', 'credit', 'online'],
    required: true
  },
  creditDetails: {
    dueDate: {
      type: Date
    },
    interestRate: {
      type: Number,
      default: 0,
      min: 0
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    lastPaymentDate: {
      type: Date
    }
  },
  paymentDetails: {
    method: {
      type: String,
      enum: ['cash', 'qr', 'credit'],
    },
    reference: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending'
    },
    transactionId: String,
    recordedAt: Date
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending'
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
saleSchema.index({ 'customer.name': 'text', 'items.name': 'text' });

// Add index for date-based queries
saleSchema.index({ createdAt: -1 });

// Add index for status-based queries
saleSchema.index({ status: 1 });

// Virtual field for calculating remaining balance for credit sales
saleSchema.virtual('remainingBalance').get(function() {
  if (this.paymentType !== 'credit') return 0;
  return this.totalAmount - (this.creditDetails?.paidAmount || 0);
});

// Virtual field for calculating due amount with interest
saleSchema.virtual('dueAmount').get(function() {
  if (this.paymentType !== 'credit') return 0;
  const principal = this.remainingBalance;
  const interestRate = this.creditDetails?.interestRate || 0;
  return principal * (1 + interestRate / 100);
});

// Method to check if payment is overdue
saleSchema.methods.isOverdue = function() {
  if (this.paymentType !== 'credit' || this.status === 'completed') return false;
  return this.creditDetails?.dueDate && new Date() > this.creditDetails.dueDate;
};

// Method to process payment
saleSchema.methods.processPayment = async function(amount) {
  if (this.status === 'completed') {
    throw new Error('Sale is already completed');
  }

  if (amount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  const remainingBalance = this.remainingBalance;
  if (amount > remainingBalance) {
    throw new Error('Payment amount exceeds remaining balance');
  }

  this.creditDetails.paidAmount = (this.creditDetails.paidAmount || 0) + amount;
  this.creditDetails.lastPaymentDate = new Date();

  if (this.creditDetails.paidAmount >= this.totalAmount) {
    this.status = 'completed';
  }

  await this.save();
  return this;
};

const Sale = mongoose.model('Sale', saleSchema);

export default Sale; 