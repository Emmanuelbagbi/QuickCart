import connectDb from '@/config/db';
import Order from '@/models/Order';
import { User } from '@/models/User';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { buffer } from 'micro';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export async function POST(request) {
  try {
    const rawBody = await buffer(request);
    const sig = request.headers.get('stripe-signature');

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_KEY
    );

    // Connect to DB
    await connectDb();

    // Handle session completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      console.log('Session metadata:', session.metadata);

      const { orderId, userId } = session.metadata || {};

      if (!orderId || !userId) {
        throw new Error('Missing metadata in Stripe session');
      }

      const updatedOrder = await Order.findByIdAndUpdate(orderId, {
        isPaid: true,
      });

      if (!updatedOrder) {
        throw new Error('Order not found');
      }

      // Clear user cart
      await User.findByIdAndUpdate(userId, { cartItems: {} });

      console.log(`Order ${orderId} marked as paid`);
    }

    // Optional: handle session expiration
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const { orderId } = session.metadata || {};
      if (orderId) {
        await Order.findByIdAndDelete(orderId);
        console.log(`Expired order ${orderId} deleted`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe Webhook Error:', error.message);
    return new Response(`Webhook Error: ${error.message}`, {
      status: 400,
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
