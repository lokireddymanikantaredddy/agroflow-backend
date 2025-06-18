import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const createAdmin = async () => {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/agroflow');
    
    const password = 'admin123';
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Delete existing users
    await mongoose.connection.collection('users').deleteMany({});
    
    // Create new admin user
    const result = await mongoose.connection.collection('users').insertOne({
      name: 'Admin',
      email: 'admin@agroflow.com',
      password: hashedPassword,
      role: 'admin',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    console.log('Admin user created successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

createAdmin(); 