import express from 'express';
import { authenticate } from '../middleware/auth.js';
import RazorpayService from '../services/RazorpayService.js';
import Payment from '../models/Payment.js';
import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import NotificationService from '../services/NotificationService.js';

const router = express.Router();

// Protect all Razorpay routes
router.use(authenticate);

// Create Razorpay order
router.post('/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', saleId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    if (saleId) {
      const sale = await Sale.findById(saleId);
      if (!sale) {
        return res.status(404).json({ message: 'Sale not found' });
      }
      if (sale.status === 'completed') {
        return res.status(400).json({ message: 'Sale is already paid in full' });
      }
    }

    const order = await RazorpayService.createOrder(amount, currency);
    res.json(order);
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Verify and process Razorpay payment
router.post('/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      saleId,
      customerId,
      amount
    } = req.body;

    // Verify payment signature
    const isValid = await RazorpayService.verifyPayment(
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    );

    if (!isValid) {
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    // Create payment record
    const payment = new Payment({
      sale: saleId,
      customer: customerId,
      amount,
      date: new Date(),
      method: 'razorpay',
      reference: razorpay_payment_id,
      status: 'completed'
    });

    await payment.save();

    // Update sale if provided
    if (saleId) {
      const sale = await Sale.findById(saleId);
      if (sale) {
        sale.payments.push(payment._id);
        sale.paidAmount = (sale.paidAmount || 0) + amount;
        if (sale.paidAmount >= sale.totalAmount) {
          sale.status = 'completed';
        }
        await sale.save();
      }
    }

    // Update customer credit balance if applicable
    if (customerId) {
      const customer = await Customer.findById(customerId);
      if (customer) {
        customer.creditBalance = Math.max(0, customer.creditBalance - amount);
        await customer.save();

        // Send payment confirmation
        await NotificationService.sendPaymentConfirmation(customer, payment, sale);
      }
    }

    res.json({
      success: true,
      payment
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get Razorpay key for frontend
router.get('/key', (req, res) => {
  if (!process.env.RAZORPAY_KEY_ID) {
    return res.status(500).json({ message: 'Razorpay key not configured' });
  }
  res.json({ key: process.env.RAZORPAY_KEY_ID });
});

export default router; 