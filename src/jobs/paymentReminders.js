import { CronJob } from 'cron';
import { differenceInDays } from 'date-fns';
import Sale from '../models/Sale';
import Customer from '../models/Customer';
import NotificationService from '../services/NotificationService';

// Schedule for reminder intervals (in days)
const REMINDER_INTERVALS = {
  FIRST: 7,    // First reminder 7 days before due
  SECOND: 3,   // Second reminder 3 days before due
  THIRD: 1     // Final reminder 1 day before due
};

// Schedule for overdue notifications (in days)
const OVERDUE_INTERVALS = {
  FIRST: 1,    // First notice 1 day after due
  SECOND: 7,   // Second notice 7 days after due
  THIRD: 30    // Final notice 30 days after due
};

// Credit limit warning thresholds
const CREDIT_WARNING_THRESHOLDS = [70, 85, 95]; // Percentage of credit limit used

class PaymentReminderJob {
  constructor() {
    // Run daily at 9:00 AM
    this.job = new CronJob('0 9 * * *', this.processReminders.bind(this));
  }

  start() {
    this.job.start();
    console.log('Payment reminder job scheduled');
  }

  stop() {
    this.job.stop();
    console.log('Payment reminder job stopped');
  }

  async processReminders() {
    try {
      await Promise.all([
        this.processUpcomingPayments(),
        this.processOverduePayments(),
        this.processCreditLimitWarnings()
      ]);
    } catch (error) {
      console.error('Error processing payment reminders:', error);
    }
  }

  async processUpcomingPayments() {
    const pendingSales = await Sale.find({
      'creditDetails.dueDate': { $exists: true },
      status: 'pending',
      paymentType: 'credit'
    }).populate('customer');

    for (const sale of pendingSales) {
      if (!sale.creditDetails?.dueDate) continue;

      const daysUntilDue = differenceInDays(
        new Date(sale.creditDetails.dueDate),
        new Date()
      );

      // Check if we need to send a reminder based on intervals
      if (
        daysUntilDue === REMINDER_INTERVALS.FIRST ||
        daysUntilDue === REMINDER_INTERVALS.SECOND ||
        daysUntilDue === REMINDER_INTERVALS.THIRD
      ) {
        await NotificationService.sendPaymentReminder(
          sale.customer,
          sale,
          daysUntilDue
        );
      }
    }
  }

  async processOverduePayments() {
    const overdueSales = await Sale.find({
      'creditDetails.dueDate': { $lt: new Date() },
      status: 'pending',
      paymentType: 'credit'
    }).populate('customer');

    for (const sale of overdueSales) {
      if (!sale.creditDetails?.dueDate) continue;

      const daysOverdue = differenceInDays(
        new Date(),
        new Date(sale.creditDetails.dueDate)
      );

      // Check if we need to send an overdue notice based on intervals
      if (
        daysOverdue === OVERDUE_INTERVALS.FIRST ||
        daysOverdue === OVERDUE_INTERVALS.SECOND ||
        daysOverdue === OVERDUE_INTERVALS.THIRD
      ) {
        await NotificationService.sendOverdueNotification(
          sale.customer,
          sale,
          daysOverdue
        );
      }
    }
  }

  async processCreditLimitWarnings() {
    const customers = await Customer.find({
      creditBalance: { $gt: 0 },
      status: 'active'
    });

    for (const customer of customers) {
      const percentageUsed = (customer.creditBalance / customer.creditLimit) * 100;
      const remainingCredit = customer.creditLimit - customer.creditBalance;

      // Check if credit usage hits any warning threshold
      for (const threshold of CREDIT_WARNING_THRESHOLDS) {
        if (percentageUsed >= threshold) {
          await NotificationService.sendCreditLimitWarning(
            customer,
            remainingCredit,
            Math.round(percentageUsed)
          );
          break; // Only send one warning per customer per day
        }
      }
    }
  }
}

export default new PaymentReminderJob(); 