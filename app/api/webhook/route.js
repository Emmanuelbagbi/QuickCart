import connectDb from '@/config/db';
import Order from '@/models/Order';
import User from '@/models/User'; // Fixed import for User model
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(request) {
  try {
    // Connect to database FIRST
    await connectDb();
    console.log('Database connected');

    const body = await request.text();
    const sig = request.headers.get('stripe-signature') || '';

    // Verify webhook event
    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_KEY
    );

    console.log(`Received event: ${event.type}`);

    const handlePaymentIntent = async (paymentIntentId, isPaid) => {
      // Retrieve checkout session
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
        limit: 1
      });

      console.log(`Found ${sessions.data.length} sessions for PI: ${paymentIntentId}`);
      
      if (sessions.data.length === 0) {
        throw new Error(`No session found for payment intent: ${paymentIntentId}`);
      }

      const session = sessions.data[0];
      console.log('Session metadata:', session.metadata);
      
      const { orderId, userId } = session.metadata;
      
      if (!orderId) throw new Error('Missing orderId in metadata');
      if (!userId) throw new Error('Missing userId in metadata');

      // Verify Order model is defined
      if (!Order) throw new Error('Order model not initialized');
      if (!Order.findByIdAndUpdate) throw new Error('Order.findByIdAndUpdate is not a function');
      
      // Verify User model is defined
      if (!User) throw new Error('User model not initialized');
      if (!User.findByIdAndUpdate) throw new Error('User.findByIdAndUpdate is not a function');

      if (isPaid) {
        // Update order status
        const updatedOrder = await Order.findByIdAndUpdate(
          orderId,
          { isPaid: true },
          { new: true }
        );
        
        if (!updatedOrder) {
          throw new Error(`Order not found: ${orderId}`);
        }
        
        console.log(`✅ Order ${orderId} marked as paid`);
        
        // Clear user's cart
        const updatedUser = await User.findByIdAndUpdate(
          userId,
          { cartItems: [] },
          { new: true }
        );
        
        if (!updatedUser) {
          throw new Error(`User not found: ${userId}`);
        }
        
        console.log(`🛒 Cleared cart for user: ${userId}`);
      } else {
        // Delete unpaid order
        const deletedOrder = await Order.findByIdAndDelete(orderId);
        
        if (!deletedOrder) {
          throw new Error(`Order not found for deletion: ${orderId}`);
        }
        
        console.log(`🗑️ Deleted order: ${orderId}`);
      }
    };

    switch (event.type) {
      case 'payment_intent.succeeded': {
        console.log('Payment succeeded:', event.data.object.id);
        await handlePaymentIntent(event.data.object.id, true);
        break;
      }
      
      case 'payment_intent.canceled': {
        console.log('Payment canceled:', event.data.object.id);
        await handlePaymentIntent(event.data.object.id, false);
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('🔥 Webhook Error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }
}

// Correct configuration for Next.js
export const config = {
  api: {
    bodyParser: false,
  },
};