import { buffer } from 'micro';
import connectDb from '@/config/db';
import Order from '@/models/Order';
import { User } from '@/models/User';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-04-10',
});

export async function POST(request) {
  try {
    // Get the raw body as a buffer
    const body = await request.text();
    const sig = request.headers.get('stripe-signature');

    // Verify the event came from Stripe
    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_KEY
    );

    // Only handle checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const { orderId, userId } = session.metadata || {};

      if (!orderId || !userId) {
        throw new Error('Missing metadata in Stripe session');
      }

      await connectDb();

      // Mark order as paid
      await Order.findByIdAndUpdate(orderId, { isPaid: true });

      // Clear user's cart
      await User.findByIdAndUpdate(userId, { cartItems: {} });

      console.log(`✅ Order ${orderId} marked as paid & cart cleared`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('❌ Webhook Error:', err.message);
    return new NextResponse(JSON.stringify({ message: err.message }), {
      status: 400,
    });
  }
}

// Disable default body parsing in Next.js API route
export const config = {
  api: {
    bodyParser: false,
  },
};
