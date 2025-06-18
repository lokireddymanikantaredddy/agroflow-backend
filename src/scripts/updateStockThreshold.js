import mongoose from 'mongoose';
import Product from '../models/Product.js';
import dotenv from 'dotenv';

dotenv.config();

const updateStockThreshold = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Update all products
    const result = await Product.updateMany(
      {}, // Match all documents
      { $set: { stockThreshold: 20 } } // Set stockThreshold to 20
    );

    console.log(`Updated ${result.modifiedCount} products`);
    
    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error updating stock threshold:', error);
    process.exit(1);
  }
};

updateStockThreshold(); 