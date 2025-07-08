// app/api/order/stripe/route.js

import { buffer } from 'micro';
import Stripe from 'stripe';
import { NextResponse } from 'next/server';
import Order from '@/models/Order';
import User from '@/models/User'; // MongoDB model
import connectDb from '@/config/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(req) {
  try {
    const rawBody = await buffer(req.body);
    const sig = req.headers.get('stripe-signature');

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_KEY
      );
    } catch (err) {
      console.error('🔴 Webhook signature verification failed:', err.message);
      return new NextResponse(JSON.stringify({ error: err.message }), {
        status: 400,
      });
    }

    const handlePaymentIntent = async (paymentIntentId, isPaid) => {
      const sessionList = await stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
      });

      const session = sessionList.data[0];
      if (!session || !session.metadata) {
        console.error('🔴 Missing session or metadata');
        return;
      }

      const { orderId, userId } = session.metadata;

      await connectDb();

      if (isPaid) {
        await Order.findByIdAndUpdate(orderId, { isPaid: true });

        // Clear the user's cart
        await User.findByIdAndUpdate(userId, { cartItems: {} }); // or {} if cartItems is an object
      } else {
        await Order.findByIdAndDelete(orderId);
      }
    };

    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntent(event.data.object.id, true);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntent(event.data.object.id, false);
        break;

      default:
        console.warn(`⚠️ Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('🔴 Webhook error:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
}
