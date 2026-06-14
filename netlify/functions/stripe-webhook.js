const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  const sig    = event.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const raw    = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  // Verify Stripe signature
  try {
    const parts = Object.fromEntries(sig.split(',').map(p => p.split('=')));
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${parts.t}.${raw}`)
      .digest('hex');
    if (expected !== parts.v1) return { statusCode: 400, body: 'Invalid signature' };
  } catch {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  const stripeEvent = JSON.parse(raw);
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

  // On any successful payment, log it to api_usage so the dashboard Realtime fires
  if (stripeEvent.type === 'payment_intent.succeeded' || stripeEvent.type === 'invoice.paid') {
    const obj = stripeEvent.data.object;
    const amountDollars = ((obj.amount_received || obj.amount_paid || 0) / 100).toFixed(4);

    await fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        provider: 'stripe_payment',
        model: stripeEvent.type,
        agent: 'webhook',
        tokens: 0,
        cost_usd: parseFloat(amountDollars),
      }),
    });
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
