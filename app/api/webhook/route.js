import { buffer } from 'micro';
import connectDb from '@/config/db';
import Order from '@/models/Order';
import { User } from '@/models/User';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(req) {
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
    console.error('❌ Webhook signature verification failed.', err.message);
    return new NextResponse(JSON.stringify({ error: `Webhook Error: ${err.message}` }), {
      status: 400,
    });
  }

  // ✅ Handle Stripe Checkout Success
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { orderId, userId } = session.metadata;

    if (!orderId || !userId) {
      return new NextResponse(
        JSON.stringify({ error: 'Missing orderId or userId in metadata' }),
        { status: 400 }
      );
    }

    try {
      await connectDb();

      await Order.findByIdAndUpdate(orderId, { isPaid: true });
      await User.findByIdAndUpdate(userId, { cartItems: {} });

      console.log('✅ Order marked as paid and cart cleared.');
    } catch (err) {
      console.error('❌ DB update failed', err.message);
      return new NextResponse(
        JSON.stringify({ error: 'Database update failed' }),
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ received: true });
}
