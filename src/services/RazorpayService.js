import Razorpay from 'razorpay';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

class RazorpayService {
  constructor() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error('Razorpay credentials not found in environment variables');
      this.razorpay = null;
      return;
    }

    try {
      this.razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret
      });
      console.log('Razorpay initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Razorpay:', error);
      this.razorpay = null;
    }
  }

  async createOrder(amount, currency = 'INR') {
    if (!this.razorpay) {
      throw new Error('Razorpay is not properly initialized');
    }

    try {
      const options = {
        amount: amount * 100, // Razorpay expects amount in paise
        currency,
        receipt: `receipt_${Date.now()}`,
        payment_capture: 1
      };

      const order = await this.razorpay.orders.create(options);
      return order;
    } catch (error) {
      console.error('Razorpay order creation error:', error);
      throw new Error('Failed to create payment order');
    }
  }

  async verifyPayment(paymentId, orderId, signature) {
    if (!this.razorpay) {
      throw new Error('Razorpay is not properly initialized');
    }

    if (!process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay key secret not found in environment variables');
    }

    const body = orderId + "|" + paymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    return expectedSignature === signature;
  }

  isInitialized() {
    return this.razorpay !== null;
  }
}

export default new RazorpayService(); 