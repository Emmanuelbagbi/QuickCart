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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const { orderId, userId } = session.metadata;

      if (!orderId || !userId) {
        throw new Error('Missing metadata from Stripe session');
      }

      await connectDb();

      await Order.findByIdAndUpdate(orderId, { isPaid: true });
      await User.findByIdAndUpdate(userId, { cartItems: {} });

      console.log('✅ Order marked as paid and cart cleared');
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook Error:', error.message);
    return new NextResponse(
      JSON.stringify({ message: error.message }),
      { status: 400 }
    );
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
