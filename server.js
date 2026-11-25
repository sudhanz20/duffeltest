// Duffel flights playground: a small Express server. Runs locally or on Vercel.
// It keeps the API key on the server, proxies the calls the page needs,
// receives Duffel webhooks, checks their signature, and streams them to the page (SSE).

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.DUFFEL_API_KEY || '';
const DUFFEL = 'https://api.duffel.com';
let webhookSecret = process.env.DUFFEL_WEBHOOK_SECRET || '';

const app = express();

// ---------------------------------------------------------------------------
// Live feed (Server-Sent Events). Every API call and webhook is pushed here.
// ---------------------------------------------------------------------------
const clients = new Set();
const history = []; // last 200 events, replayed to new browser tabs
function broadcast(kind, payload) {
  const evt = { kind, at: new Date().toISOString(), ...payload };
  history.push(evt);
  if (history.length > 200) history.shift();
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of clients) res.write(line);
}

// Optional password. Set PLAYGROUND_PASSWORD when the app is on a public URL (e.g. Vercel),
// otherwise anyone with the link can book on your Duffel account. /webhook stays open for Duffel.
const PASSWORD = process.env.PLAYGROUND_PASSWORD || '';
app.use((req, res, next) => {
  if (!PASSWORD || req.path === '/webhook') return next();
  const [scheme, encoded] = (req.get('Authorization') || '').split(' ');
  const pass = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  if (crypto.timingSafeEqual(a, b)) return next();
  res.set('WWW-Authenticate', 'Basic realm="Duffel playground"').status(401).send('Password required');
});

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  for (const evt of history) res.write(`data: ${JSON.stringify(evt)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': keep-alive\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

// ---------------------------------------------------------------------------
// Webhook receiver. MUST read the raw body: the signature covers the exact bytes.
// Header format: X-Duffel-Signature: t=<unix>,v1=<hex HMAC-SHA256("<t>.<raw body>")>
// ---------------------------------------------------------------------------
function verifySignature(rawBody, header, secret) {
  if (!secret) return { ok: false, reason: 'DUFFEL_WEBHOOK_SECRET is not set' };
  if (!header) return { ok: false, reason: 'missing X-Duffel-Signature header' };
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  if (!parts.t || !parts.v1) return { ok: false, reason: 'malformed signature header' };
  const expected = crypto
    .createHmac('sha256', secret) // secret is used as-is, not base64-decoded
    .update(`${parts.t}.`)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts.v1, 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

const seenKeys = new Set(); // Duffel may redeliver; dedupe on idempotency_key
app.post('/webhook', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
  const check = verifySignature(raw, req.get('X-Duffel-Signature'), webhookSecret);
  let body;
  try {
    body = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    body = { unparsable: raw.toString('utf8') };
  }
  const duplicate = body.idempotency_key ? seenKeys.has(body.idempotency_key) : false;
  if (check.ok && body.idempotency_key) seenKeys.add(body.idempotency_key);

  broadcast('webhook', {
    type: body.type || '(no type)',
    verified: check.ok,
    reason: check.reason,
    duplicate,
    body,
  });
  console.log(`[webhook] ${body.type} verified=${check.ok}${check.reason ? ` (${check.reason})` : ''}`);

  // Reject bad signatures so Duffel shows a failure, but still show them on the page.
  if (!check.ok) return res.status(401).json({ error: check.reason });
  res.status(200).json({ received: true });
});

// Everything below takes JSON.
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Duffel client
// ---------------------------------------------------------------------------
async function duffel(method, urlPath, data) {
  if (!API_KEY) {
    const err = new Error('DUFFEL_API_KEY is missing. Add it to .env and restart.');
    err.status = 500;
    throw err;
  }
  const started = Date.now();
  const res = await fetch(DUFFEL + urlPath, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Duffel-Version': 'v2',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: data === undefined ? undefined : JSON.stringify({ data }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  broadcast('api', {
    method,
    path: urlPath,
    status: res.status,
    ms: Date.now() - started,
    request: data,
    response: json,
  });
  if (!res.ok) {
    const first = json.errors && json.errors[0];
    const msg = first ? `${first.title}: ${first.message}` : json.raw ? `${res.status}: ${json.raw}` : `Duffel returned ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.duffel = json;
    throw err;
  }
  return json;
}

// Wrap a handler so errors come back as JSON the page can show.
const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, duffel: e.duffel });
  }
};

app.get('/api/status', (req, res) => {
  res.json({
    apiKeySet: Boolean(API_KEY),
    testMode: API_KEY.startsWith('duffel_test_'),
    webhookSecretSet: Boolean(webhookSecret),
  });
});

// ---------------- Flights ----------------
app.post(
  '/api/flights/search',
  route(async (req) => {
    const { origin, destination, departure_date, return_date, adults = 1, cabin_class = 'economy' } = req.body;
    const slices = [{ origin, destination, departure_date }];
    if (return_date) slices.push({ origin: destination, destination: origin, departure_date: return_date });
    const passengers = Array.from({ length: Number(adults) || 1 }, () => ({ type: 'adult' }));
    const out = await duffel('POST', '/air/offer_requests?return_offers=true&supplier_timeout=20000', {
      slices,
      passengers,
      cabin_class,
    });
    // Trim offers for the page; the full response is in the live log.
    // Duffel Airways (ZZ) test offers go first because they book and cancel reliably.
    const all = (out.data.offers || []).sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
    const offers = [...all.filter((o) => o.owner.iata_code === 'ZZ'), ...all.filter((o) => o.owner.iata_code !== 'ZZ')].slice(0, 30);
    return { offer_request_id: out.data.id, offers };
  })
);

app.get('/api/flights/offers/:id', route(async (req) => duffel('GET', `/air/offers/${encodeURIComponent(req.params.id)}`)));

app.post(
  '/api/flights/orders',
  route(async (req) => {
    const { offer_id, passengers, hold } = req.body;
    // Re-fetch the offer so the price and passenger ids are current.
    const offer = (await duffel('GET', `/air/offers/${encodeURIComponent(offer_id)}`)).data;
    const data = {
      type: hold ? 'hold' : 'instant',
      selected_offers: [offer.id],
      passengers: offer.passengers.map((p, i) => ({ id: p.id, ...(passengers[i] || passengers[0]) })),
    };
    if (!hold) data.payments = [{ type: 'balance', currency: offer.total_currency, amount: offer.total_amount }];
    return duffel('POST', '/air/orders', data);
  })
);

app.get('/api/flights/orders/:id', route(async (req) => duffel('GET', `/air/orders/${encodeURIComponent(req.params.id)}`)));

app.post(
  '/api/flights/orders/:id/cancel',
  route(async (req) => {
    // Step 1: create a cancellation quote. Step 2: confirm it.
    const quote = await duffel('POST', '/air/order_cancellations', { order_id: req.params.id });
    if (req.body && req.body.quoteOnly) return quote;
    return duffel('POST', `/air/order_cancellations/${quote.data.id}/actions/confirm`);
  })
);

// ---------------- Webhook management ----------------
const ALL_EVENTS = [
  'order.created',
  'order.creation_failed',
  'order.airline_initiated_change_detected',
  'air.order.changed',
  'order_cancellation.created',
  'order_cancellation.confirmed',
  'air.payment.succeeded',
  'air.payment.failed',
  'air.payment.pending',
  'air.payment.cancelled',
  'air.airline_credit.created',
  'air.airline_credit.spent',
  'air.airline_credit.invalidated',
  'ping.triggered',
];

// Save a value into .env so it survives restarts.
// On Vercel the filesystem is read-only, so this returns false there.
function saveEnv(key, value) {
  if (process.env.VERCEL) return false;
  const file = path.join(__dirname, '.env');
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  try {
    fs.writeFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}

app.get('/api/webhooks', route(async () => duffel('GET', '/air/webhooks')));

app.post(
  '/api/webhooks',
  route(async (req) => {
    let url = String(req.body.url || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(url)) {
      const err = new Error('Webhook URL must be a public https URL (your tunnel URL).');
      err.status = 400;
      throw err;
    }
    if (!url.endsWith('/webhook')) url += '/webhook';
    const out = await duffel('POST', '/air/webhooks', { url, events: ALL_EVENTS });
    // Duffel shows the secret only once. Use it now and keep it in .env.
    webhookSecret = out.data.secret;
    const saved = saveEnv('DUFFEL_WEBHOOK_SECRET', webhookSecret);
    return { ...out, savedToEnvFile: saved };
  })
);

app.post(
  '/api/webhooks/:id/ping',
  route(async (req) => duffel('POST', `/air/webhooks/id/${encodeURIComponent(req.params.id)}/actions/ping`, {}))
);

app.delete('/api/webhooks/:id', route(async (req) => duffel('DELETE', `/air/webhooks/${encodeURIComponent(req.params.id)}`)));

module.exports = app; // Vercel imports the app

if (require.main === module) app.listen(PORT, () => {
  console.log(`\nDuffel playground running at http://localhost:${PORT}\n`);
  if (!API_KEY) console.warn('WARNING: DUFFEL_API_KEY is not set. Copy .env.example to .env and add it.');
  else if (!API_KEY.startsWith('duffel_test_')) console.warn('WARNING: this is NOT a test token. Real bookings and charges can happen.');
  if (!webhookSecret) console.warn('Note: DUFFEL_WEBHOOK_SECRET is not set. Webhooks will show as "unverified".');
});
