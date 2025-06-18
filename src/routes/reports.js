import express from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { authenticate } from '../middleware/auth';
import Customer from '../models/Customer';
import Sale from '../models/Sale';
import Payment from '../models/Payment';

const router = express.Router();

// Protect all report routes
router.use(authenticate);

// Generate reports
router.post('/generate', async (req, res) => {
  try {
    const { type, startDate, endDate, customers, format } = req.body;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Build query filter
    const filter = customers?.length > 0 ? { customer: { $in: customers } } : {};
    if (startDate && endDate) {
      filter.createdAt = { $gte: start, $lte: end };
    }

    let data;
    switch (type) {
      case 'customer_statements':
        data = await generateCustomerStatements(filter);
        break;
      case 'payment_history':
        data = await generatePaymentHistory(filter);
        break;
      case 'credit_analysis':
        data = await generateCreditAnalysis(filter);
        break;
      case 'aging_report':
        data = await generateAgingReport(filter);
        break;
      case 'collection_performance':
        data = await generateCollectionPerformance(filter);
        break;
      default:
        throw new Error('Invalid report type');
    }

    // Generate report in requested format
    if (format === 'pdf') {
      await generatePDF(res, type, data);
    } else if (format === 'excel' || format === 'csv') {
      await generateExcel(res, type, data, format === 'csv');
    } else {
      throw new Error('Invalid export format');
    }
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({
      error: 'Failed to generate report',
      details: error.message
    });
  }
});

// Generate customer statements
async function generateCustomerStatements(filter) {
  const customers = await Customer.find(filter);
  const statements = [];

  for (const customer of customers) {
    const sales = await Sale.find({
      customer: customer._id,
      paymentType: 'credit'
    }).populate('payments');

    const statement = {
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        creditLimit: customer.creditLimit,
        creditBalance: customer.creditBalance
      },
      transactions: sales.map(sale => ({
        date: sale.createdAt,
        type: 'Sale',
        amount: sale.totalAmount,
        balance: sale.totalAmount - sale.paidAmount,
        status: sale.status,
        payments: sale.payments.map(payment => ({
          date: payment.date,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference
        }))
      }))
    };

    statements.push(statement);
  }

  return statements;
}

// Generate payment history
async function generatePaymentHistory(filter) {
  const payments = await Payment.find(filter)
    .populate('customer')
    .populate('sale')
    .sort({ date: -1 });

  return payments.map(payment => ({
    date: payment.date,
    customer: payment.customer.name,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    saleId: payment.sale._id,
    saleAmount: payment.sale.totalAmount
  }));
}

// Generate credit analysis
async function generateCreditAnalysis(filter) {
  const customers = await Customer.find(filter);
  const analysis = [];

  for (const customer of customers) {
    const sales = await Sale.find({
      customer: customer._id,
      paymentType: 'credit'
    }).populate('payments');

    const totalCredit = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const totalPaid = sales.reduce((sum, sale) => sum + sale.paidAmount, 0);
    const averagePaymentTime = calculateAveragePaymentTime(sales);

    analysis.push({
      customer: customer.name,
      creditScore: customer.creditScore,
      creditLimit: customer.creditLimit,
      creditBalance: customer.creditBalance,
      totalCredit,
      totalPaid,
      averagePaymentTime,
      utilizationRate: (customer.creditBalance / customer.creditLimit) * 100
    });
  }

  return analysis;
}

// Generate aging report
async function generateAgingReport(filter) {
  const sales = await Sale.find({
    ...filter,
    status: 'pending',
    paymentType: 'credit'
  }).populate('customer');

  const aging = {
    current: [],
    '30days': [],
    '60days': [],
    '90days': [],
    'over90days': []
  };

  const now = new Date();
  for (const sale of sales) {
    const daysOverdue = Math.floor(
      (now - new Date(sale.creditDetails.dueDate)) / (1000 * 60 * 60 * 24)
    );

    const entry = {
      customer: sale.customer.name,
      saleId: sale._id,
      amount: sale.totalAmount - sale.paidAmount,
      dueDate: sale.creditDetails.dueDate,
      daysOverdue
    };

    if (daysOverdue <= 0) aging.current.push(entry);
    else if (daysOverdue <= 30) aging['30days'].push(entry);
    else if (daysOverdue <= 60) aging['60days'].push(entry);
    else if (daysOverdue <= 90) aging['90days'].push(entry);
    else aging['over90days'].push(entry);
  }

  return aging;
}

// Generate collection performance
async function generateCollectionPerformance(filter) {
  const sales = await Sale.find({
    ...filter,
    paymentType: 'credit',
    status: 'completed'
  }).populate('payments');

  const performance = {
    totalCollected: 0,
    averageCollectionTime: 0,
    collectionsByMethod: {},
    monthlyCollections: {}
  };

  let totalCollectionDays = 0;
  let completedCount = 0;

  for (const sale of sales) {
    if (sale.payments.length > 0) {
      const lastPayment = sale.payments[sale.payments.length - 1];
      
      // Update total collected
      performance.totalCollected += sale.totalAmount;

      // Update collection time
      const collectionDays = Math.floor(
        (lastPayment.date - sale.createdAt) / (1000 * 60 * 60 * 24)
      );
      totalCollectionDays += collectionDays;
      completedCount++;

      // Update collections by method
      for (const payment of sale.payments) {
        performance.collectionsByMethod[payment.method] = 
          (performance.collectionsByMethod[payment.method] || 0) + payment.amount;
      }

      // Update monthly collections
      const monthKey = format(lastPayment.date, 'yyyy-MM');
      performance.monthlyCollections[monthKey] = 
        (performance.monthlyCollections[monthKey] || 0) + sale.totalAmount;
    }
  }

  performance.averageCollectionTime = completedCount
    ? Math.round(totalCollectionDays / completedCount)
    : 0;

  return performance;
}

// Helper function to calculate average payment time
function calculateAveragePaymentTime(sales) {
  let totalDays = 0;
  let count = 0;

  for (const sale of sales) {
    if (sale.status === 'completed' && sale.payments.length > 0) {
      const lastPayment = sale.payments[sale.payments.length - 1];
      const days = Math.floor(
        (lastPayment.date - sale.createdAt) / (1000 * 60 * 60 * 24)
      );
      totalDays += days;
      count++;
    }
  }

  return count > 0 ? Math.round(totalDays / count) : 0;
}

// Generate PDF report
async function generatePDF(res, type, data) {
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${type}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  doc.pipe(res);

  // Add report title
  doc.fontSize(20).text(formatReportTitle(type), { align: 'center' });
  doc.moveDown();

  // Add report content based on type
  switch (type) {
    case 'customer_statements':
      generateCustomerStatementsPDF(doc, data);
      break;
    case 'payment_history':
      generatePaymentHistoryPDF(doc, data);
      break;
    case 'credit_analysis':
      generateCreditAnalysisPDF(doc, data);
      break;
    case 'aging_report':
      generateAgingReportPDF(doc, data);
      break;
    case 'collection_performance':
      generateCollectionPerformancePDF(doc, data);
      break;
  }

  doc.end();
}

// Generate Excel report
async function generateExcel(res, type, data, isCsv) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(formatReportTitle(type));

  // Add headers and data based on report type
  switch (type) {
    case 'customer_statements':
      generateCustomerStatementsExcel(worksheet, data);
      break;
    case 'payment_history':
      generatePaymentHistoryExcel(worksheet, data);
      break;
    case 'credit_analysis':
      generateCreditAnalysisExcel(worksheet, data);
      break;
    case 'aging_report':
      generateAgingReportExcel(worksheet, data);
      break;
    case 'collection_performance':
      generateCollectionPerformanceExcel(worksheet, data);
      break;
  }

  // Set response headers
  const extension = isCsv ? 'csv' : 'xlsx';
  res.setHeader(
    'Content-Type',
    isCsv ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${type}_${format(new Date(), 'yyyy-MM-dd')}.${extension}`
  );

  // Write to response
  if (isCsv) {
    await workbook.csv.write(res);
  } else {
    await workbook.xlsx.write(res);
  }
}

// Helper function to format report title
function formatReportTitle(type) {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// PDF generation helpers
function generateCustomerStatementsPDF(doc, data) {
  for (const statement of data) {
    doc.fontSize(16).text(`Statement for ${statement.customer.name}`);
    doc.fontSize(12).text(`Credit Limit: $${statement.customer.creditLimit}`);
    doc.text(`Current Balance: $${statement.customer.creditBalance}`);
    doc.moveDown();

    doc.fontSize(14).text('Transactions');
    for (const transaction of statement.transactions) {
      doc.fontSize(12)
        .text(`Date: ${format(new Date(transaction.date), 'yyyy-MM-dd')}`)
        .text(`Amount: $${transaction.amount}`)
        .text(`Balance: $${transaction.balance}`)
        .text(`Status: ${transaction.status}`);
      
      if (transaction.payments.length > 0) {
        doc.text('Payments:');
        transaction.payments.forEach(payment => {
          doc.text(`  - $${payment.amount} (${payment.method}) on ${format(new Date(payment.date), 'yyyy-MM-dd')}`);
        });
      }
      doc.moveDown();
    }
    doc.addPage();
  }
}

function generatePaymentHistoryPDF(doc, data) {
  data.forEach(payment => {
    doc.fontSize(12)
      .text(`Date: ${format(new Date(payment.date), 'yyyy-MM-dd')}`)
      .text(`Customer: ${payment.customer}`)
      .text(`Amount: $${payment.amount}`)
      .text(`Method: ${payment.method}`)
      .text(`Reference: ${payment.reference || 'N/A'}`)
      .text(`Sale ID: ${payment.saleId}`)
      .text(`Sale Amount: $${payment.saleAmount}`)
      .moveDown();
  });
}

function generateCreditAnalysisPDF(doc, data) {
  data.forEach(analysis => {
    doc.fontSize(14).text(analysis.customer);
    doc.fontSize(12)
      .text(`Credit Score: ${analysis.creditScore}`)
      .text(`Credit Limit: $${analysis.creditLimit}`)
      .text(`Current Balance: $${analysis.creditBalance}`)
      .text(`Total Credit Extended: $${analysis.totalCredit}`)
      .text(`Total Paid: $${analysis.totalPaid}`)
      .text(`Average Payment Time: ${analysis.averagePaymentTime} days`)
      .text(`Utilization Rate: ${analysis.utilizationRate.toFixed(2)}%`)
      .moveDown();
  });
}

function generateAgingReportPDF(doc, data) {
  const categories = ['current', '30days', '60days', '90days', 'over90days'];
  
  categories.forEach(category => {
    doc.fontSize(14).text(formatReportTitle(category));
    doc.moveDown();

    data[category].forEach(entry => {
      doc.fontSize(12)
        .text(`Customer: ${entry.customer}`)
        .text(`Amount: $${entry.amount}`)
        .text(`Due Date: ${format(new Date(entry.dueDate), 'yyyy-MM-dd')}`)
        .text(`Days Overdue: ${entry.daysOverdue}`)
        .moveDown();
    });
  });
}

function generateCollectionPerformancePDF(doc, data) {
  doc.fontSize(14).text('Collection Performance Summary');
  doc.fontSize(12)
    .text(`Total Collected: $${data.totalCollected}`)
    .text(`Average Collection Time: ${data.averageCollectionTime} days`)
    .moveDown();

  doc.fontSize(14).text('Collections by Method');
  Object.entries(data.collectionsByMethod).forEach(([method, amount]) => {
    doc.fontSize(12).text(`${method}: $${amount}`);
  });
  doc.moveDown();

  doc.fontSize(14).text('Monthly Collections');
  Object.entries(data.monthlyCollections).forEach(([month, amount]) => {
    doc.fontSize(12).text(`${month}: $${amount}`);
  });
}

// Excel generation helpers
function generateCustomerStatementsExcel(worksheet, data) {
  worksheet.columns = [
    { header: 'Customer', key: 'customer', width: 20 },
    { header: 'Transaction Date', key: 'date', width: 15 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Balance', key: 'balance', width: 15 },
    { header: 'Status', key: 'status', width: 15 }
  ];

  data.forEach(statement => {
    statement.transactions.forEach(transaction => {
      worksheet.addRow({
        customer: statement.customer.name,
        date: format(new Date(transaction.date), 'yyyy-MM-dd'),
        type: transaction.type,
        amount: transaction.amount,
        balance: transaction.balance,
        status: transaction.status
      });
    });
  });
}

function generatePaymentHistoryExcel(worksheet, data) {
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Customer', key: 'customer', width: 20 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Method', key: 'method', width: 15 },
    { header: 'Reference', key: 'reference', width: 20 },
    { header: 'Sale ID', key: 'saleId', width: 20 },
    { header: 'Sale Amount', key: 'saleAmount', width: 15 }
  ];

  data.forEach(payment => {
    worksheet.addRow({
      date: format(new Date(payment.date), 'yyyy-MM-dd'),
      customer: payment.customer,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference || 'N/A',
      saleId: payment.saleId,
      saleAmount: payment.saleAmount
    });
  });
}

function generateCreditAnalysisExcel(worksheet, data) {
  worksheet.columns = [
    { header: 'Customer', key: 'customer', width: 20 },
    { header: 'Credit Score', key: 'creditScore', width: 15 },
    { header: 'Credit Limit', key: 'creditLimit', width: 15 },
    { header: 'Current Balance', key: 'creditBalance', width: 15 },
    { header: 'Total Credit', key: 'totalCredit', width: 15 },
    { header: 'Total Paid', key: 'totalPaid', width: 15 },
    { header: 'Avg Payment Time', key: 'averagePaymentTime', width: 20 },
    { header: 'Utilization Rate', key: 'utilizationRate', width: 15 }
  ];

  data.forEach(analysis => {
    worksheet.addRow({
      customer: analysis.customer,
      creditScore: analysis.creditScore,
      creditLimit: analysis.creditLimit,
      creditBalance: analysis.creditBalance,
      totalCredit: analysis.totalCredit,
      totalPaid: analysis.totalPaid,
      averagePaymentTime: `${analysis.averagePaymentTime} days`,
      utilizationRate: `${analysis.utilizationRate.toFixed(2)}%`
    });
  });
}

function generateAgingReportExcel(worksheet, data) {
  worksheet.columns = [
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Customer', key: 'customer', width: 20 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Due Date', key: 'dueDate', width: 15 },
    { header: 'Days Overdue', key: 'daysOverdue', width: 15 }
  ];

  Object.entries(data).forEach(([category, entries]) => {
    entries.forEach(entry => {
      worksheet.addRow({
        category: formatReportTitle(category),
        customer: entry.customer,
        amount: entry.amount,
        dueDate: format(new Date(entry.dueDate), 'yyyy-MM-dd'),
        daysOverdue: entry.daysOverdue
      });
    });
  });
}

function generateCollectionPerformanceExcel(worksheet, data) {
  // Summary sheet
  worksheet.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'Value', key: 'value', width: 20 }
  ];

  worksheet.addRow({
    metric: 'Total Collected',
    value: `$${data.totalCollected}`
  });

  worksheet.addRow({
    metric: 'Average Collection Time',
    value: `${data.averageCollectionTime} days`
  });

  worksheet.addRow({ metric: '', value: '' });
  worksheet.addRow({ metric: 'Collections by Method', value: '' });

  Object.entries(data.collectionsByMethod).forEach(([method, amount]) => {
    worksheet.addRow({
      metric: method,
      value: `$${amount}`
    });
  });

  worksheet.addRow({ metric: '', value: '' });
  worksheet.addRow({ metric: 'Monthly Collections', value: '' });

  Object.entries(data.monthlyCollections).forEach(([month, amount]) => {
    worksheet.addRow({
      metric: month,
      value: `$${amount}`
    });
  });
}

export default router; 