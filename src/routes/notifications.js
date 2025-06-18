import express from 'express';
import { authenticate } from '../middleware/auth';
import Customer from '../models/Customer';
import Sale from '../models/Sale';

const router = express.Router();

// Protect all notification routes
router.use(authenticate);

// Get notifications for a customer
router.get('/customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const customer = await Customer.findById(customerId);
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Get pending sales with upcoming or overdue payments
    const sales = await Sale.find({
      customer: customerId,
      status: 'pending',
      paymentType: 'credit'
    }).sort({ 'creditDetails.dueDate': 1 });

    const now = new Date();
    const notifications = [];

    // Process each sale for notifications
    sales.forEach(sale => {
      const dueDate = new Date(sale.creditDetails.dueDate);
      const daysUntilDue = Math.floor((dueDate - now) / (1000 * 60 * 60 * 24));

      if (daysUntilDue < 0) {
        notifications.push({
          type: 'overdue',
          message: `Payment overdue by ${Math.abs(daysUntilDue)} days`,
          amount: sale.totalAmount - sale.paidAmount,
          dueDate: sale.creditDetails.dueDate,
          saleId: sale._id
        });
      } else if (daysUntilDue <= 7) {
        notifications.push({
          type: 'upcoming',
          message: `Payment due in ${daysUntilDue} days`,
          amount: sale.totalAmount - sale.paidAmount,
          dueDate: sale.creditDetails.dueDate,
          saleId: sale._id
        });
      }
    });

    // Add credit limit warning if applicable
    const creditUtilization = (customer.creditBalance / customer.creditLimit) * 100;
    if (creditUtilization >= 70) {
      notifications.push({
        type: 'credit_warning',
        message: `Credit utilization at ${Math.round(creditUtilization)}%`,
        currentBalance: customer.creditBalance,
        creditLimit: customer.creditLimit
      });
    }

    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

export default router; 