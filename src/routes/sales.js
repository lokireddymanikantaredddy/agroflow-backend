import express from 'express';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import { authenticate, authorize } from '../middleware/auth.js';
import mongoose from 'mongoose';
import RazorpayService from '../services/RazorpayService.js';
import NotificationService from '../services/NotificationService.js';
import qrcode from 'qrcode';

const router = express.Router();

// Create new sale
router.post('/', authenticate, async (req, res) => {
  try {
    const { customerId, items, paymentType, creditDetails, totalAmount } = req.body;

    if (!customerId || !items || !paymentType || !totalAmount) {
      throw new Error('Missing required fields');
    }

    // Validate customer for credit sale
    if (paymentType === 'credit') {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      if (!customer.canMakeCreditPurchase(totalAmount)) {
        throw new Error('Credit limit exceeded');
      }
    }

    // Check and update product stock
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        throw new Error(`Product ${item.product} not found`);
      }
      if (product.quantity < item.quantity) {
        throw new Error(`Insufficient stock for product ${product.name}`);
      }
      
      product.quantity -= item.quantity;
      await product.save();
    }

    // Create sale
    const sale = await Sale.create({
      customer: customerId,
      items,
      paymentType,
      totalAmount,
      creditDetails: paymentType === 'credit' ? creditDetails : undefined,
      createdBy: req.user.id,
      status: paymentType === 'credit' ? 'pending' : 'completed'
    });

    // Update customer credit if credit sale
    if (paymentType === 'credit') {
      const customer = await Customer.findById(customerId);
      customer.currentCredit += totalAmount;
      customer.paymentHistory.push({
        saleId: sale._id,
        amount: totalAmount,
        date: new Date(),
        status: 'pending'
      });
      await customer.save();

      // Send notification using NotificationService
      if (customer.phone || customer.email) {
        await NotificationService.sendPaymentReminder(
          customer,
          sale,
          Math.ceil((new Date(creditDetails.dueDate) - new Date()) / (1000 * 60 * 60 * 24))
        );
      }
    }

    res.status(201).json(sale);
  } catch (error) {
    // If there's an error, we should try to rollback the product quantity changes
    try {
      if (error.message !== 'Customer not found' && error.message !== 'Credit limit exceeded') {
        for (const item of req.body.items) {
          const product = await Product.findById(item.product);
          if (product) {
            product.quantity += item.quantity;
            await product.save();
          }
        }
      }
    } catch (rollbackError) {
      console.error('Error during rollback:', rollbackError);
    }
    res.status(400).json({ message: error.message });
  }
});

// Get all sales with pagination and filters
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const paymentType = req.query.paymentType;
    const status = req.query.status;

    const query = {};
    if (startDate && endDate) {
      query.createdAt = { $gte: startDate, $lte: endDate };
    }
    if (paymentType) {
      query.paymentType = paymentType;
    }
    if (status) {
      query.status = status;
    }

    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name sku price')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      sales,
      page,
      totalPages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Process credit payment
router.post('/:id/credit-payment', authenticate, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount } = req.body;
    const sale = await Sale.findById(req.params.id).session(session);
    
    if (!sale) {
      throw new Error('Sale not found');
    }

    if (sale.paymentType !== 'credit') {
      throw new Error('This is not a credit sale');
    }

    const customer = await Customer.findById(sale.customer).session(session);
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Process payment
    const payment = {
      amount,
      date: new Date(),
      status: 'paid'
    };

    // Update sale
    sale.creditDetails.remainingAmount -= amount;
    if (sale.creditDetails.remainingAmount <= 0) {
      sale.status = 'completed';
    }
    await sale.save({ session });

    // Update customer
    customer.currentCredit -= amount;
    const paymentHistoryIndex = customer.paymentHistory.findIndex(
      ph => ph.saleId.toString() === sale._id.toString()
    );
    if (paymentHistoryIndex !== -1) {
      customer.paymentHistory[paymentHistoryIndex].status = 
        sale.creditDetails.remainingAmount <= 0 ? 'paid' : 'partially_paid';
    }
    await customer.save({ session });

    await session.commitTransaction();
    res.json({ message: 'Payment processed successfully', sale });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
});

// Process cash payment
router.post('/:id/cash-payment', authenticate, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    
    if (!sale) {
      throw new Error('Sale not found');
    }

    // Update sale with cash payment details
    sale.paymentDetails = {
      method: 'cash',
      status: 'completed',
      recordedAt: new Date()
    };
    sale.status = 'completed';
    await sale.save();

    res.json({ message: 'Cash payment recorded successfully', sale });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Verify Razorpay payment
router.post('/:id/verify-payment', authenticate, async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const sale = await Sale.findById(req.params.id);

    if (!sale) {
      throw new Error('Sale not found');
    }

    // Verify payment signature
    const isValid = await RazorpayService.verifyPayment(
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    );

    if (!isValid) {
      throw new Error('Invalid payment signature');
    }

    // Update sale with payment details
    sale.paymentDetails = {
      method: 'razorpay',
      orderId: razorpay_order_id,
      transactionId: razorpay_payment_id,
      signature: razorpay_signature,
      status: 'completed'
    };
    sale.status = 'completed';
    await sale.save();

    res.json({ message: 'Payment verified successfully', sale });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get sale by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name sku price')
      .populate('createdBy', 'name email');

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    res.json(sale);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get all sales with pagination and search
router.get('/search', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const query = {
      $or: [
        { 'customer.name': { $regex: search, $options: 'i' } },
        { 'items.name': { $regex: search, $options: 'i' } }
      ]
    };

    const [sales, total] = await Promise.all([
      Sale.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('customer', 'name email phone'),
      Sale.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    res.json({
      sales,
      currentPage: page,
      totalPages,
      hasMore
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update sale status (e.g., mark credit sale as paid)
router.patch('/:id/status', authenticate, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { status } = req.body;
    const sale = await Sale.findById(req.params.id).populate('customer');

    if (!sale) {
      throw new Error('Sale not found');
    }

    if (sale.status === status) {
      throw new Error('Sale is already in this status');
    }

    // If marking a credit sale as completed (paid)
    if (status === 'completed' && sale.paymentType === 'credit') {
      await Customer.findByIdAndUpdate(
        sale.customer._id,
        { $inc: { creditBalance: -sale.totalAmount } },
        { session }
      );
    }

    sale.status = status;
    await sale.save({ session });
    await session.commitTransaction();

    res.json(sale);
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
});

// Get sales statistics
router.get('/stats/summary', authenticate, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todaySales, pendingCredit, topProducts] = await Promise.all([
      // Get today's total sales
      Sale.aggregate([
        {
          $match: {
            createdAt: { $gte: today },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' },
            count: { $sum: 1 }
          }
        }
      ]),

      // Get total pending credit
      Sale.aggregate([
        {
          $match: {
            paymentType: 'credit',
            status: 'pending'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' }
          }
        }
      ]),

      // Get top selling products
      Sale.aggregate([
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            totalQuantity: { $sum: '$items.quantity' },
            totalAmount: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        },
        { $sort: { totalQuantity: -1 } },
        { $limit: 5 }
      ])
    ]);

    res.json({
      todaySales: todaySales[0]?.total || 0,
      salesCount: todaySales[0]?.count || 0,
      pendingCredit: pendingCredit[0]?.total || 0,
      topProducts
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Generate QR code for payment
router.post('/:id/generate-qr', authenticate, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    
    if (!sale) {
      throw new Error('Sale not found');
    }

    // Generate a unique payment reference
    const paymentRef = `PAY-${sale._id}-${Date.now()}`;

    // Update sale with payment reference
    sale.paymentDetails = {
      method: 'qr',
      reference: paymentRef,
      status: 'pending'
    };
    await sale.save();

    // Get UPI details from environment variables
    const upiId = process.env.UPI_ID || '9876543210@ybl'; // Your UPI ID
    const merchantName = process.env.MERCHANT_NAME || 'AgroFlow';

    // Format the amount properly (remove any currency symbols, commas and ensure 2 decimal places)
    const formattedAmount = Number(sale.totalAmount).toFixed(2);

    // Create UPI payment string
    const upiString = `upi://pay?pa=${encodeURIComponent(upiId)}`
      + `&pn=${encodeURIComponent(merchantName)}`
      + `&am=${formattedAmount}`
      + `&tr=${encodeURIComponent(paymentRef)}`
      + `&tn=${encodeURIComponent(`Payment for sale #${sale._id}`)}`
      + `&cu=INR`; // Currency

    // Generate QR code
    const qrCodeData = await qrcode.toDataURL(upiString, {
      width: 300,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.json({ 
      qrData: qrCodeData,
      upiString, // Sending the UPI string for direct UPI app opening
      paymentDetails: {
        amount: formattedAmount,
        reference: paymentRef,
        merchantName,
        upiId
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Verify QR payment status
router.get('/:id/verify-payment', authenticate, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    
    if (!sale) {
      throw new Error('Sale not found');
    }

    // Here you would typically check with your payment provider
    // For now, we'll just return the current status
    res.json({ status: sale.paymentDetails?.status || 'pending' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router; 