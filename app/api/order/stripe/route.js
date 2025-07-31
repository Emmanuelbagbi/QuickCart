import Order from '@/models/Order';
import { getAuth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import Product from '@/models/product';
import Stripe from 'stripe';
import { metadata } from '@/app/layout';


import connectDb from '@/config/db';



const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(request) {
  try {
    const { userId } = getAuth(request);
    const { address, items } = await request.json();
    const origin = request.headers.get('origin');

    if (!address || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Invalid data' },
        { status: 400 }
      );
    }

    await connectDb();  // Establish DB connection

    let amount = 0;
    const productData = [];

    // Calculate amount and get product data
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
        quantity: item.quantity,
      });
      
      amount += product.offerPrice * item.quantity;
    }

    // Calculate fees (2%) and tax (20%)
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
      paymentType: 'Stripe'
    });

    // Prepare line items for Stripe
    const line_items = productData.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.name },
        unit_amount: Math.round(item.price * 100), // in cents
      },
      quantity: item.quantity,
    }));

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: `${origin}/order-placed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
      metadata: {
        orderId: order._id.toString(),
        userId: userId,
      },
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