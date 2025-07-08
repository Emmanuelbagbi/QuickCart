import Order from '@/models/Order';
import { getAuth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import Product from '@/models/product';
import Stripe from 'stripe';
import connectDb from '@/config/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(request) {
  try {
    const { userId } = getAuth(request);
    const { address, items } = await request.json();
    const origin = request.headers.get('origin');

    if (!address || items.length === 0) {
      return NextResponse.json({ success: false, message: 'Invalid data' });
    }

    await connectDb();

    const productData = [];
    let amount = 0;

    for (const item of items) {
      const product = await Product.findById(item.product);
      productData.push({
        name: product.name,
        price: product.offerPrice,
        quantity: item.quantity,
      });
      amount += product.offerPrice * item.quantity;
    }

    amount += Math.floor(amount * 0.02); // Add 2% fee
    const finalAmount = amount + Math.floor(amount * 0.2); // Add 20% tax

    const order = await Order.create({
      userId,
      address,
      items,
      amount: finalAmount,
      date: Date.now(),
      paymentType: 'Stripe',
    });

    const line_items = productData.map((item) => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.name },
        unit_amount: item.price * 100,
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      line_items,
      mode: 'payment',
      success_url: `${origin}/order-placed`,
      cancel_url: `${origin}/cart`,
      metadata: {
        orderId: order._id.toString(),
        userId,
      },
    });

    return NextResponse.json({ success: true, url: session.url });
  } catch (error) {
    console.log('Checkout Error:', error.message);
    return NextResponse.json({ success: false, message: error.message });
  }
}
