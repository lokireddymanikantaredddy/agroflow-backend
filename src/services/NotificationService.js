import nodemailer from 'nodemailer';
import twilio from 'twilio';
import { format } from 'date-fns';
import dotenv from 'dotenv';

dotenv.config();

class NotificationService {
  constructor() {
    // Email configuration
    if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
      try {
        this.emailTransporter = nodemailer.createTransport({
          host: process.env.EMAIL_HOST,
          port: process.env.EMAIL_PORT,
          secure: false,
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD
          }
        });
        console.log('Email service initialized successfully');
      } catch (error) {
        console.error('Failed to initialize email service:', error);
        this.emailTransporter = null;
      }
    } else {
      console.log('Email credentials not found in environment variables');
      this.emailTransporter = null;
    }

    // SMS configuration
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        this.twilioClient = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        console.log('SMS service (Twilio) initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Twilio:', error);
        this.twilioClient = null;
      }
    } else {
      console.log('Twilio credentials not found in environment variables');
      this.twilioClient = null;
    }
  }

  async sendPaymentReminder(customer, sale) {
    // TODO: Implement actual notification sending
    console.log(`Payment reminder sent to ${customer.name} for sale ${sale._id}`);
  }

  async sendPaymentConfirmation(customer, payment, sale) {
    // TODO: Implement actual notification sending
    console.log(`Payment confirmation sent to ${customer.name} for payment ${payment._id}`);
  }

  async sendOverdueNotification(customer, sale) {
    // TODO: Implement actual notification sending
    console.log(`Overdue notification sent to ${customer.name} for sale ${sale._id}`);
  }

  async sendCreditLimitWarning(customer) {
    // TODO: Implement actual notification sending
    console.log(`Credit limit warning sent to ${customer.name}`);
  }

  async sendEmail({ to, subject, html }) {
    if (!this.emailTransporter) {
      console.log('Email notification skipped: Email service not configured');
      return;
    }

    try {
      await this.emailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to,
        subject,
        html
      });
      console.log('Email sent successfully to:', to);
    } catch (error) {
      console.error('Email notification failed:', error);
      throw error;
    }
  }

  async sendSMS({ to, body }) {
    if (!this.twilioClient) {
      console.log('SMS notification skipped: Twilio not configured');
      return;
    }

    try {
      await this.twilioClient.messages.create({
        to,
        from: process.env.TWILIO_PHONE_NUMBER,
        body
      });
      console.log('SMS sent successfully to:', to);
    } catch (error) {
      console.error('SMS notification failed:', error);
      throw error;
    }
  }
}

export default new NotificationService(); 