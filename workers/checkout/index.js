/**
 * Horizon Tours — Stripe Checkout Worker
 *
 * Required Worker Secrets (set via `wrangler secret put`):
 *   STRIPE_SECRET_KEY  — your Stripe secret key (sk_test_... or sk_live_...)
 *   STRIPE_PRICE_ID    — the Price ID for the tour (price_...)
 *
 * Receives: POST { date, adults, youth, infants }
 * Returns:  { url } — the Stripe Checkout session URL
 */

const ALLOWED_ORIGIN = 'https://gowithhorizon.com';

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Invalid JSON body', 400, request);
    }

    const { date, adults = 0, youth = 0, infants = 0 } = body;

    // Validate inputs
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonError('A valid tour date (YYYY-MM-DD) is required', 400, request);
    }

    const payingGuests = Number(adults) + Number(youth);
    if (payingGuests < 1) {
      return jsonError('At least one adult or youth guest is required', 400, request);
    }

    // Build the Stripe Checkout Session via the REST API (no npm dependency needed)
    const params = new URLSearchParams({
      mode: 'payment',
      success_url: `${ALLOWED_ORIGIN}/booking-confirmed/`,
      cancel_url: `${ALLOWED_ORIGIN}/tours/Banff-Hidden-Gem-Canoe-Tour/`,
      'payment_method_types[0]': 'card',
      'line_items[0][price]': env.STRIPE_PRICE_ID,
      'line_items[0][quantity]': String(payingGuests),
      // Store booking details in metadata so they appear in the Stripe dashboard
      'metadata[tour_date]': date,
      'metadata[adults]': String(adults),
      'metadata[youth]': String(youth),
      'metadata[infants]': String(infants),
      'metadata[tour]': 'banff-hidden-gem-canoe-tour',
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error('Stripe error:', session.error);
      return jsonError(session.error?.message || 'Could not create checkout session', 500, request);
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(request),
      },
    });
  },
};

function corsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  // Allow gowithhorizon.com and localhost for local testing
  const allowed =
    origin === ALLOWED_ORIGIN || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonError(message, status, request) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request),
    },
  });
}
