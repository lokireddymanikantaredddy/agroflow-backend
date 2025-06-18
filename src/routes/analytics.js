import express from 'express';
import { startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import Sale from '../models/Sale';
import Customer from '../models/Customer';
import Payment from '../models/Payment';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// Protect all analytics routes
router.use(authenticate);

// Get credit analytics
router.get('/credit', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get total credit extended and outstanding
    const creditStats = await Sale.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          paymentType: 'credit'
        }
      },
      {
        $group: {
          _id: null,
          totalCreditExtended: { $sum: '$totalAmount' },
          outstandingCredit: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, '$totalAmount', 0]
            }
          }
        }
      }
    ]);

    // Calculate average collection period
    const completedSales = await Sale.find({
      createdAt: { $gte: start, $lte: end },
      paymentType: 'credit',
      status: 'completed'
    }).populate('payments');

    let totalCollectionDays = 0;
    let completedCount = 0;

    completedSales.forEach(sale => {
      if (sale.payments && sale.payments.length > 0) {
        const lastPayment = sale.payments[sale.payments.length - 1];
        const collectionDays = Math.floor(
          (lastPayment.date - sale.createdAt) / (1000 * 60 * 60 * 24)
        );
        totalCollectionDays += collectionDays;
        completedCount++;
      }
    });

    // Get monthly trends
    const months = eachMonthOfInterval({ start, end });
    const trends = await Promise.all(
      months.map(async (month) => {
        const monthStart = startOfMonth(month);
        const monthEnd = endOfMonth(month);

        const monthlyStats = await Sale.aggregate([
          {
            $match: {
              createdAt: { $gte: monthStart, $lte: monthEnd },
              paymentType: 'credit'
            }
          },
          {
            $group: {
              _id: null,
              extended: { $sum: '$totalAmount' },
              collected: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'completed'] }, '$totalAmount', 0]
                }
              }
            }
          }
        ]);

        return {
          month: month.toLocaleDateString('default', { month: 'short', year: 'numeric' }),
          extended: monthlyStats[0]?.extended || 0,
          collected: monthlyStats[0]?.collected || 0
        };
      })
    );

    // Calculate total credit utilization
    const totalCreditLimit = await Customer.aggregate([
      {
        $group: {
          _id: null,
          totalLimit: { $sum: '$creditLimit' },
          totalBalance: { $sum: '$creditBalance' }
        }
      }
    ]);

    const creditUtilization = totalCreditLimit[0]
      ? (totalCreditLimit[0].totalBalance / totalCreditLimit[0].totalLimit) * 100
      : 0;

    res.json({
      totalCreditExtended: creditStats[0]?.totalCreditExtended || 0,
      outstandingCredit: creditStats[0]?.outstandingCredit || 0,
      averageCollectionPeriod: completedCount
        ? Math.round(totalCollectionDays / completedCount)
        : 0,
      creditUtilization: Math.round(creditUtilization),
      trends
    });
  } catch (error) {
    console.error('Error fetching credit analytics:', error);
    res.status(500).json({ error: 'Failed to fetch credit analytics' });
  }
});

// Get payment analytics
router.get('/payments', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get payment status distribution
    const statusDistribution = await Sale.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          paymentType: 'credit'
        }
      },
      {
        $group: {
          _id: '$status',
          value: { $sum: 1 }
        }
      },
      {
        $project: {
          name: '$_id',
          value: 1,
          _id: 0
        }
      }
    ]);

    // Get monthly collections
    const months = eachMonthOfInterval({ start, end });
    const monthlyCollections = await Promise.all(
      months.map(async (month) => {
        const monthStart = startOfMonth(month);
        const monthEnd = endOfMonth(month);

        const collections = await Payment.aggregate([
          {
            $match: {
              date: { $gte: monthStart, $lte: monthEnd }
            }
          },
          {
            $group: {
              _id: null,
              amount: { $sum: '$amount' }
            }
          }
        ]);

        return {
          month: month.toLocaleDateString('default', { month: 'short', year: 'numeric' }),
          amount: collections[0]?.amount || 0
        };
      })
    );

    res.json({
      statusDistribution,
      monthlyCollections
    });
  } catch (error) {
    console.error('Error fetching payment analytics:', error);
    res.status(500).json({ error: 'Failed to fetch payment analytics' });
  }
});

// Get customer segments
router.get('/customer-segments', async (req, res) => {
  try {
    const customers = await Customer.find();
    
    // Define segments based on credit score
    const segments = [
      { name: 'Premium', minScore: 800, riskLevel: 'Low' },
      { name: 'Good', minScore: 700, riskLevel: 'Low' },
      { name: 'Average', minScore: 600, riskLevel: 'Medium' },
      { name: 'High Risk', minScore: 0, riskLevel: 'High' }
    ];

    const segmentData = segments.map(segment => {
      const segmentCustomers = customers.filter(
        customer => customer.creditScore >= segment.minScore &&
          (segment.name === 'Premium' ? customer.creditScore <= 1000 :
            customer.creditScore < (segments[segments.indexOf(segment) - 1]?.minScore || 1001))
      );

      return {
        name: segment.name,
        customerCount: segmentCustomers.length,
        totalCredit: segmentCustomers.reduce((sum, customer) => sum + customer.creditBalance, 0),
        averageCreditScore: Math.round(
          segmentCustomers.reduce((sum, customer) => sum + customer.creditScore, 0) /
          (segmentCustomers.length || 1)
        ),
        riskLevel: segment.riskLevel
      };
    });

    res.json(segmentData);
  } catch (error) {
    console.error('Error fetching customer segments:', error);
    res.status(500).json({ error: 'Failed to fetch customer segments' });
  }
});

export default router; 