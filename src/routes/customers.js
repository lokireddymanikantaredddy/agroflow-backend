import express from 'express';
import Customer from '../models/Customer.js';
import { authenticate, authorize } from '../middleware/auth.js';
import Sale from '../models/Sale.js';
import mongoose from 'mongoose';
import NotificationService from '../services/NotificationService.js';

const router = express.Router();

// Get all customers with pagination and search
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit),
      Customer.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    res.json({
      customers,
      currentPage: page,
      totalPages,
      hasMore
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new customer
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, code, email, phone, address, creditLimit, notes } = req.body;

    // Check if customer code already exists
    const existingCustomer = await Customer.findOne({ code });
    if (existingCustomer) {
      return res.status(400).json({ message: 'Customer code already exists' });
    }

    const customer = new Customer({
      name,
      code,
      email,
      phone,
      address,
      creditLimit,
      notes,
      creditBalance: 0,
      createdBy: req.user._id
    });

    await customer.save();
    res.status(201).json(customer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get customer by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update customer
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, code, email, phone, address, creditLimit, notes } = req.body;
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Check if new credit limit is less than current balance
    if (creditLimit < customer.creditBalance) {
      return res.status(400).json({
        message: 'New credit limit cannot be less than current credit balance'
      });
    }

    // Check if customer code already exists (excluding current customer)
    const existingCustomer = await Customer.findOne({
      code,
      _id: { $ne: req.params.id }
    });
    if (existingCustomer) {
      return res.status(400).json({ message: 'Customer code already exists' });
    }

    customer.name = name;
    customer.code = code;
    customer.email = email;
    customer.phone = phone;
    customer.address = address;
    customer.creditLimit = creditLimit;
    customer.notes = notes;

    await customer.save();
    res.json(customer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get customer's sales history
router.get('/:id/sales', authenticate, async (req, res) => {
  try {
    const sales = await Sale.find({ customer: req.params.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('items totalAmount paymentType status createdAt');

    const formattedSales = sales.map(sale => ({
      _id: sale._id,
      type: 'sale',
      amount: sale.totalAmount,
      date: sale.createdAt,
      items: sale.items,
      paymentType: sale.paymentType,
      status: sale.status
    }));

    res.json(formattedSales);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get customer's payment history
router.get('/:id/payments', authenticate, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const payments = customer.paymentHistory
      .sort((a, b) => b.date - a.date)
      .slice(0, 20)
      .map(payment => ({
        _id: payment._id,
        type: 'payment',
        amount: payment.amount,
        date: payment.date,
        paymentMethod: payment.method,
        status: payment.status
      }));

    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Process payment for customer's credit
router.post('/:id/payments', authenticate, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, method, saleId } = req.body;
    const customer = await Customer.findById(req.params.id).session(session);

    if (!customer) {
      throw new Error('Customer not found');
    }

    if (amount <= 0) {
      throw new Error('Payment amount must be greater than 0');
    }

    if (amount > customer.creditBalance) {
      throw new Error('Payment amount exceeds credit balance');
    }

    // Update customer's credit balance
    customer.creditBalance -= amount;
    
    // Add payment to history
    customer.paymentHistory.push({
      amount,
      method,
      date: new Date(),
      status: 'completed',
      saleId
    });

    // If payment is for a specific sale, update the sale status
    if (saleId) {
      const sale = await Sale.findById(saleId).session(session);
      if (sale) {
        const totalPaid = customer.paymentHistory
          .filter(p => p.saleId?.toString() === saleId && p.status === 'completed')
          .reduce((sum, p) => sum + p.amount, 0) + amount;

        if (totalPaid >= sale.totalAmount) {
          sale.status = 'completed';
          await sale.save({ session });
        }
      }
    }

    await customer.save({ session });
    await session.commitTransaction();

    res.json({
      message: 'Payment processed successfully',
      customer
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
});

// Get customer's credit summary
router.get('/:id/credit-summary', authenticate, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const pendingSales = await Sale.find({
      customer: req.params.id,
      paymentType: 'credit',
      status: 'pending'
    }).select('totalAmount createdAt creditDetails');

    res.json({
      creditLimit: customer.creditLimit,
      creditBalance: customer.creditBalance,
      availableCredit: customer.creditLimit - customer.creditBalance,
      pendingSales: pendingSales.map(sale => ({
        amount: sale.totalAmount,
        date: sale.createdAt,
        dueDate: sale.creditDetails?.dueDate
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router; 