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

    const handlePaymentIntent = async (paymentIntentId, isPaid) => {
      // Use retrieve instead of list to get metadata
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
      });

      const sessionId = sessions.data[0]?.id;
      if (!sessionId) throw new Error('Session ID not found');

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const { orderId, userId } = session.metadata;

      await connectDb();

      if (isPaid) {
        await Order.findByIdAndUpdate(orderId, { isPaid: true });

        await User.findByIdAndUpdate(userId, { cartItems: {} });

        // Optional: bulk update older matching orders
        await Order.updateMany(
          { paymentType: 'Stripe', isPaid: false },
          { isPaid: true }
        );
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
        console.error(event.type);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: error.message });
  }
}

export const config = {
  api: { bodyParser: false },
};
