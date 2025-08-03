import connectDb from '@/config/db';
import Order from '@/models/Order';
import { User } from '@/models/User';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(request) {
  try {
    const body = await request.text();
    const sig = request.headers.get('stripe-signature');

    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_KEY
    );

    // Connect to DB
    await connectDb();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { orderId, userId } = session.metadata;

        if (!orderId || !userId) {
          throw new Error('Missing metadata in Stripe session');
        }

        // Mark order as paid
        await Order.findByIdAndUpdate(orderId, { isPaid: true });

        // Clear user's cart
        await User.findByIdAndUpdate(userId, { cartItems: {} });

        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        const { orderId } = session.metadata;

        if (orderId) {
          await Order.findByIdAndDelete(orderId);
        }

        break;
      }

      default:
        console.warn(`Unhandled event type: ${event.type}`);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook Error:', error.message);
    return NextResponse.json({ message: error.message });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
