import connectDb from '@/config/db';
import Order from '@/models/Order';
import { User } from '@/models/User';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { buffer } from 'micro'; // Install: npm install micro

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(request) {
  try {
    // Get raw body as buffer
    const reqBuffer = await request.arrayBuffer();
    const payload = Buffer.from(reqBuffer).toString('utf-8');
    const sig = request.headers.get('stripe-signature');

    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_KEY
    );

    const handlePaymentIntent = async (paymentIntentId, isPaid) => {
      // Retrieve checkout session
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
        limit: 1,
        expand: ['data.payment_intent'] // Include payment intent details
      });

      if (!sessions.data.length) {
        throw new Error(`No session found for payment intent: ${paymentIntentId}`);
      }

      const session = sessions.data[0];
      const { orderId, userId } = session.metadata;

      await connectDb();

      if (isPaid) {
        // Update order status
        await Order.findByIdAndUpdate(orderId, { 
          isPaid: true,
          paymentDetails: session.payment_intent // Save payment details
        });
        
        // Clear user's cart
        await User.findByIdAndUpdate(userId, { cartItems: [] });
      } else {
        // Delete unpaid order
        await Order.findByIdAndDelete(orderId);
      }
    };

    // Handle specific event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntent(event.data.object.id, true);
        break;
        
      case 'payment_intent.canceled':
        await handlePaymentIntent(event.data.object.id, false);
        break;
        
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('🔥 Webhook error:', error);
    return NextResponse.json(
      { error: `Webhook Error: ${error.message}` },
      { status: 400 }
    );
  }
}

// Corrected configuration
export const config = {
  api: {
    bodyParser: false,  // Essential for raw body handling
  },
};