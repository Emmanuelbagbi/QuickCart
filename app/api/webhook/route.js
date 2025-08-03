import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import connectDb from '@/config/db';
import Order from '@/models/Order';
import { User } from '@/models/User';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-04-10',
});

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(req) {
  try {
    const rawBody = await req.text();
    const sig = req.headers.get('stripe-signature');

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_KEY
    );

    const handlePaymentIntent = async (paymentIntentId, isPaid) => {
      const session = await stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
      });

      const { orderId, userId } = session.data[0].metadata;

      await connectDb();

      if (isPaid) {
        await Order.findByIdAndUpdate(orderId, { isPaid: true });
        await User.findByIdAndUpdate(userId, { cartItems: {} });
      } else {
        await Order.findByIdAndDelete(orderId);
      }
    };

    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntent(event.data.object.id, true);
        break;
      case 'payment_intent.canceled':
        await handlePaymentIntent(event.data.object.id, false);
        break;
      default:
        console.warn(`Unhandled event type: ${event.type}`);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }
}
