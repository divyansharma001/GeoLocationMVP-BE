import express from 'express';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';
import { PaymentStatus } from '@prisma/client';
import { createPayPalOrderForAmount, capturePayPalPayment } from '../lib/paypal';

const router = express.Router();

// Create a payment intent (MVP: PayPal only)
router.post('/intent', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { amount, currency = 'USD', description = 'Purchase', dealId, orderId } = req.body;

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }

    if (amount > 10000) {
      return res.status(400).json({ success: false, message: 'Amount exceeds limit' });
    }

    // TODO: Validate pricing against deal/menu/booking in backend.

    // Optionally ensure an Order exists or create a lightweight pending Order
    let relatedOrderId: number | undefined = undefined;
    if (orderId) {
      const existingOrder = await prisma.order.findUnique({ where: { id: Number(orderId) } });
      if (!existingOrder) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      relatedOrderId = existingOrder.id;
    }

    // Create PayPal order for the specified amount
    const pp = await createPayPalOrderForAmount({
      amount,
      currency,
      description,
      referenceId: dealId ? `deal_${dealId}` : 'deal_purchase',
    });

    if (!pp.success) {
      return res.status(502).json({ success: false, message: 'Failed to create PayPal order', error: pp.error });
    }

    // Record payment transaction
    const payment = await prisma.paymentTransaction.create({
      data: {
        userId,
        paypalOrderId: pp.orderId!,
        amount,
        coinsPurchased: 0,
        status: PaymentStatus.PENDING,
        paypalResponse: pp.order,
        // relatedOrderId, // enable after DB migration adds the column
      },
    });

    return res.json({
      success: true,
      data: {
        paymentId: payment.id,
        orderId: pp.orderId,
        approvalUrl: pp.approvalUrl,
        currency,
        amount,
      },
    });
  } catch (err) {
    console.error('Create payment intent error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create payment intent' });
  }
});

// Capture PayPal payment for a given PayPal order id
router.post('/capture', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    const tx = await prisma.paymentTransaction.findUnique({ where: { paypalOrderId: orderId } });

    if (!tx) {
      return res.status(404).json({ success: false, message: 'Payment transaction not found' });
    }

    if (tx.userId !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this transaction' });
    }

    if (tx.status === PaymentStatus.COMPLETED) {
      return res.json({ success: true, message: 'Payment already completed' });
    }

    const capture = await capturePayPalPayment(orderId);
    if (!capture.success) {
      await prisma.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: capture.error,
        },
      });

      return res.status(400).json({
        success: false,
        message: 'Failed to capture PayPal payment',
        error: capture.error,
        errorCode: (capture as any).errorCode,
      });
    }

    // Mark completed. If related order exists, you can update it here.
    await prisma.paymentTransaction.update({
      where: { id: tx.id },
      data: {
        status: PaymentStatus.COMPLETED,
        paypalPaymentId: capture.captureId,
        paypalResponse: capture.capture,
      },
    });

    // TODO: If relatedOrderId exists: mark Order CONFIRMED/COMPLETED, award loyalty, etc.

    return res.json({ success: true, message: 'Payment completed successfully' });
  } catch (err) {
    console.error('Capture payment error:', err);
    return res.status(500).json({ success: false, message: 'Failed to capture payment' });
  }
});

export default router;
