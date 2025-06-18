import express from 'express';
import { authenticate } from '../middleware/auth';
import Customer from '../models/Customer';
import Sale from '../models/Sale';
import Payment from '../models/Payment';
import NotificationService from '../services/NotificationService';

const router = express.Router();

// Protect all payment routes
router.use(authenticate);

// Process bulk payments
router.post('/bulk', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payments = req.body;
    if (!Array.isArray(payments)) {
      throw new Error('Invalid payment data format');
    }

    const results = {
      successful: [],
      failed: []
    };

    for (const paymentData of payments) {
      try {
        const { customerId, amount, date, method, reference, notes } = paymentData;

        // Validate payment data
        if (!customerId || !amount || !date || !method) {
          throw new Error('Missing required payment fields');
        }

        // Find customer and validate
        const customer = await Customer.findById(customerId).session(session);
        if (!customer) {
          throw new Error(`Customer not found: ${customerId}`);
        }

        // Find pending sales for this customer
        const pendingSales = await Sale.find({
          customer: customerId,
          status: 'pending',
          paymentType: 'credit'
        }).sort({ createdAt: 1 }).session(session);

        if (pendingSales.length === 0) {
          throw new Error(`No pending sales found for customer: ${customerId}`);
        }

        let remainingAmount = amount;
        const updatedSales = [];

        // Allocate payment to sales
        for (const sale of pendingSales) {
          if (remainingAmount <= 0) break;

          const saleBalance = sale.totalAmount - sale.paidAmount;
          const paymentForSale = Math.min(remainingAmount, saleBalance);

          // Create payment record
          const payment = new Payment({
            sale: sale._id,
            customer: customerId,
            amount: paymentForSale,
            date: new Date(date),
            method,
            reference,
            notes
          });
          await payment.save({ session });

          // Update sale
          sale.payments.push(payment._id);
          sale.paidAmount += paymentForSale;
          if (sale.paidAmount >= sale.totalAmount) {
            sale.status = 'completed';
          }
          await sale.save({ session });

          remainingAmount -= paymentForSale;
          updatedSales.push(sale);
        }

        // Update customer credit balance
        customer.creditBalance -= amount;
        await customer.save({ session });

        // Send payment confirmation
        await NotificationService.sendPaymentConfirmation(
          customer,
          { amount, date: new Date(date), method },
          updatedSales[0]
        );

        results.successful.push({
          customerId,
          amount,
          salesUpdated: updatedSales.map(sale => sale._id)
        });
      } catch (error) {
        results.failed.push({
          customerId: paymentData.customerId,
          error: error.message
        });
      }
    }

    await session.commitTransaction();
    res.json(results);
  } catch (error) {
    await session.abortTransaction();
    console.error('Bulk payment processing error:', error);
    res.status(500).json({
      error: 'Failed to process bulk payments',
      details: error.message
    });
  } finally {
    session.endSession();
  }
});

// Process single payment
router.post('/', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { customerId, saleId, amount, date, method, reference, notes } = req.body;

    // Validate request
    if (!customerId || !saleId || !amount || !date || !method) {
      throw new Error('Missing required payment fields');
    }

    // Find and validate customer
    const customer = await Customer.findById(customerId).session(session);
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Find and validate sale
    const sale = await Sale.findById(saleId).session(session);
    if (!sale) {
      throw new Error('Sale not found');
    }

    if (sale.status === 'completed') {
      throw new Error('Sale is already paid in full');
    }

    const remainingBalance = sale.totalAmount - sale.paidAmount;
    if (amount > remainingBalance) {
      throw new Error('Payment amount exceeds remaining balance');
    }

    // Create payment record
    const payment = new Payment({
      sale: saleId,
      customer: customerId,
      amount,
      date: new Date(date),
      method,
      reference,
      notes
    });
    await payment.save({ session });

    // Update sale
    sale.payments.push(payment._id);
    sale.paidAmount += amount;
    if (sale.paidAmount >= sale.totalAmount) {
      sale.status = 'completed';
    }
    await sale.save({ session });

    // Update customer credit balance
    customer.creditBalance -= amount;
    await customer.save({ session });

    // Send payment confirmation
    await NotificationService.sendPaymentConfirmation(customer, payment, sale);

    await session.commitTransaction();
    res.json({ payment, sale });
  } catch (error) {
    await session.abortTransaction();
    console.error('Payment processing error:', error);
    res.status(500).json({
      error: 'Failed to process payment',
      details: error.message
    });
  } finally {
    session.endSession();
  }
});

// Get payment history for a customer
router.get('/customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { startDate, endDate } = req.query;

    const query = { customer: customerId };
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const payments = await Payment.find(query)
      .populate('sale')
      .sort({ date: -1 });

    res.json(payments);
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({
      error: 'Failed to fetch payment history',
      details: error.message
    });
  }
});

// Get payment details
router.get('/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await Payment.findById(paymentId)
      .populate('sale')
      .populate('customer');

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json(payment);
  } catch (error) {
    console.error('Error fetching payment details:', error);
    res.status(500).json({
      error: 'Failed to fetch payment details',
      details: error.message
    });
  }
});

export default router; 