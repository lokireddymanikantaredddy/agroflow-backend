import express from 'express';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';

const router = express.Router();

// Get dashboard summary
router.get('/summary', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [todaySales, totalProducts, lowStockProducts, creditSales] = await Promise.all([
      Sale.aggregate([
        { $match: { createdAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Product.countDocuments(),
      Product.countDocuments({
        $expr: { $lte: ['$quantity', '$stockThreshold'] }
      }),
      Sale.aggregate([
        { $match: { paymentType: 'credit', status: { $ne: 'completed' } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ])
    ]);

    res.json({
      todayRevenue: todaySales[0]?.total || 0,
      totalProducts,
      lowStockProducts,
      pendingCredit: creditSales[0]?.total || 0
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get sales trends
router.get('/sales-trends', async (req, res) => {
  try {
    const { period } = req.query; // daily, weekly, monthly
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case 'weekly':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      default: // daily
        startDate.setDate(startDate.getDate() - 1);
    }

    const sales = await Sale.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          total: { $sum: '$totalAmount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(sales);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get top selling products
router.get('/top-products', async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    const topProducts = await Sale.aggregate([
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          name: '$product.name',
          sku: '$product.sku',
          totalQuantity: 1,
          totalRevenue: 1
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json(topProducts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get credit status summary
router.get('/credit-summary', async (req, res) => {
  try {
    const creditSummary = await Customer.aggregate([
      {
        $group: {
          _id: null,
          totalCredit: { $sum: '$currentCredit' },
          averageCredit: { $avg: '$currentCredit' },
          customersWithCredit: {
            $sum: { $cond: [{ $gt: ['$currentCredit', 0] }, 1, 0] }
          }
        }
      }
    ]);

    const overdueSales = await Sale.aggregate([
      {
        $match: {
          paymentType: 'credit',
          'creditDetails.dueDate': { $lt: new Date() },
          status: { $ne: 'completed' }
        }
      },
      {
        $group: {
          _id: null,
          totalOverdue: { $sum: '$creditDetails.remainingAmount' },
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      creditSummary: creditSummary[0] || {
        totalCredit: 0,
        averageCredit: 0,
        customersWithCredit: 0
      },
      overdueSummary: overdueSales[0] || {
        totalOverdue: 0,
        count: 0
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get inventory status
router.get('/inventory-status', async (req, res) => {
  try {
    const inventoryStatus = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalValue: {
            $sum: { $multiply: ['$quantity', '$price'] }
          },
          averageValue: {
            $avg: { $multiply: ['$quantity', '$price'] }
          },
          lowStock: {
            $sum: {
              $cond: [
                { $lte: ['$quantity', '$stockThreshold'] },
                1,
                0
              ]
            }
          },
          outOfStock: {
            $sum: {
              $cond: [{ $eq: ['$quantity', 0] }, 1, 0]
            }
          }
        }
      }
    ]);

    const categoryBreakdown = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalValue: {
            $sum: { $multiply: ['$quantity', '$price'] }
          }
        }
      }
    ]);

    res.json({
      summary: inventoryStatus[0] || {
        totalValue: 0,
        averageValue: 0,
        lowStock: 0,
        outOfStock: 0
      },
      categoryBreakdown
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router; 