import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  sku: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  price: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  stockThreshold: {
    type: Number,
    required: true,
    default: 20
  },
  supplier: {
    name: String,
    contactInfo: String,
    email: String,
    phone: String
  },
  category: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'discontinued', 'out_of_stock'],
    default: 'active'
  },
  images: [{
    url: String,
    alt: String
  }]
}, {
  timestamps: true
});

// Index for search functionality
productSchema.index({ name: 'text', sku: 'text', description: 'text' });

// Method to check if stock is low
productSchema.methods.isLowStock = function() {
  return this.quantity <= this.stockThreshold;
};

// Virtual for stock status
productSchema.virtual('stockStatus').get(function() {
  if (this.quantity <= 0) return 'Out of Stock';
  if (this.quantity <= this.stockThreshold) return 'Low Stock';
  return 'In Stock';
});

const Product = mongoose.model('Product', productSchema);
export default Product; 