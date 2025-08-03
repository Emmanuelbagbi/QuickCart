import connectDb from '@/config/db';
import Order from '@/models/Order';
import { User } from '@/models/User';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAuth } from '@clerk/nextjs/server';
import Product from '@/models/product'; // Use lowercase 'product' for consistency // Added database connection

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(request) {
  try {
    // Connect to database first
    await connectDb();
    
    const { userId } = getAuth(request);
    const { address, items } = await request.json();
    const origin = request.headers.get('origin');

    if (!address || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Invalid data' }, 
        { status: 400 }
      );
    }

    let amount = 0;
    const productData = [];

    // Calculate amount properly (avoid reduce with async)
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return NextResponse.json(
          { success: false, message: `Product not found: ${item.product}` },
          { status: 404 }
        );
      }
      
      productData.push({
        name: product.name,
        price: product.offerPrice,
        quantity: item.quantity
      });
      
      amount += product.offerPrice * item.quantity;
    }

    // Calculate fees (2%) and tax (20%) separately
    const processingFee = Math.floor(amount * 0.02);
    const tax = Math.floor(amount * 0.2);
    const totalAmount = amount + processingFee + tax;

    // Create order record
    const order = await Order.create({
      userId,
      address,
      items,
      amount: totalAmount,
      date: Date.now(),
      paymentType: 'Stripe',
      isPaid: false  // Explicitly set to false initially
    });

    // Create line items for products
    const line_items = productData.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.name },
        unit_amount: Math.round(item.price * 100), // in cents
      },
      quantity: item.quantity,
    }));

    // Add tax and fee as separate line items
    line_items.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Tax (20%)' },
        unit_amount: Math.round(tax * 100),
      },
      quantity: 1,
    });

    line_items.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Processing Fee (2%)' },
        unit_amount: Math.round(processingFee * 100),
      },
      quantity: 1,
    });

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${origin}/order-placed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart?canceled=true`,
      metadata: {
        orderId: order._id.toString(),
        userId: userId,
      },
      // CRITICAL: Enable automatic tax calculation
      automatic_tax: { enabled: true },
      // Important for webhook reliability
      payment_intent_data: {
        metadata: {
          orderId: order._id.toString(),
          userId: userId,
        }
      }
    });

    // Log for debugging
    console.log('Created order:', order._id);
    console.log('Stripe session:', session.id);
    console.log('Metadata:', {
      orderId: order._id.toString(),
      userId
    });

    return NextResponse.json({ success: true, url: session.url });
    
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}