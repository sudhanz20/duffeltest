// Supplier KPIs: Nomad records how Duffel performs as daily totals in Redis.
// It uses the Upstash Redis REST API, so it needs no extra driver.
// It is off until UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set
// (Vercel's Upstash integration sets KV_REST_API_URL and KV_REST_API_TOKEN, which also work).
// Recording never blocks or breaks a booking: every write is fire-and-forget.

let waitUntil = null;
try {
  ({ waitUntil } = require('@vercel/functions'));
} catch {
  /* running without the package: writes still run, Vercel may just cut a few short */
}

const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const enabled = Boolean(REDIS_URL && REDIS_TOKEN);
const KEEP_SECONDS = 400 * 24 * 3600; // a little over a year of daily totals
const MAX_SAMPLES = 5000; // search times kept per day, for the median and slowest 5%

// Test and live traffic are stored apart, so test data never pollutes real trends.
const MODE = (process.env.DUFFEL_API_KEY || '').startsWith('duffel_live_') ? 'live' : 'test';

const today = () => new Date().toISOString().slice(0, 10);
const dayKey = (d, mode = MODE) => `kpi:${mode}:${d}`;

async function redis(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis returned ${res.status}`);
  const out = await res.json();
  const bad = out.find((r) => r && r.error);
  if (bad) throw new Error(bad.error);
  return out.map((r) => r.result);
}

function send(commands) {
  if (!enabled || !commands.length) return;
  const p = redis(commands).catch((e) => console.warn(`[metrics] not recorded: ${e.message}`));
  if (waitUntil) {
    try {
      waitUntil(p);
    } catch {
      /* outside a Vercel request */
    }
  }
}

// Add numbers to today's totals. Counts use HINCRBY, money uses HINCRBYFLOAT.
function add(fields, extra = []) {
  const key = dayKey(today());
  const cmds = [];
  for (const [field, n] of Object.entries(fields)) {
    if (!n) continue;
    const isMoney = field.startsWith('booked_value:') || field.startsWith('refunded:');
    cmds.push(isMoney ? ['HINCRBYFLOAT', key, field, String(n)] : ['HINCRBY', key, field, n]);
  }
  if (!cmds.length && !extra.length) return;
  cmds.push(['EXPIRE', key, KEEP_SECONDS], ...extra);
  send(cmds);
}

// Which booking step a Duffel call belongs to.
function stepOf(method, urlPath) {
  const p = urlPath.split('?')[0];
  if (p.startsWith('/air/offer_requests')) return 'search';
  if (p.startsWith('/air/offers')) return 'offer';
  if (p === '/air/orders' && method === 'POST') return 'book';
  if (p.startsWith('/air/orders')) return 'order_read';
  if (p.startsWith('/air/payments')) return 'pay';
  if (p.startsWith('/air/order_cancellations')) return 'cancel';
  if (p.startsWith('/air/order_change')) return 'change';
  if (p.startsWith('/places')) return 'places';
  if (p.startsWith('/air/webhooks')) return 'webhooks';
  return 'other';
}

// Every Duffel call: count, errors and, for searches, how long it took.
function duffelCall(method, urlPath, status, ms) {
  const step = stepOf(method, urlPath);
  const failed = !status || status >= 400;
  const fields = { [`calls:${step}`]: 1, [`errors:${step}`]: failed ? 1 : 0, [`errors5xx:${step}`]: !status || status >= 500 ? 1 : 0 };
  const extra = [];
  if (step === 'search' && !failed) {
    const list = `${dayKey(today())}:search_ms`;
    extra.push(['RPUSH', list, Math.round(ms)], ['LTRIM', list, -MAX_SAMPLES, -1], ['EXPIRE', list, KEEP_SECONDS]);
  }
  add(fields, extra);
}

// One shopper search (a mixed-cabin trip sends two Duffel searches but counts once here).
function search({ route, offers, airlines }) {
  const routes = `${dayKey(today())}:routes`;
  add(
    { searches: 1, search_offers: offers, search_airlines: airlines, searches_empty: offers ? 0 : 1 },
    [
      ['HINCRBY', routes, `${route}|searches`, 1],
      ['HINCRBY', routes, `${route}|offers`, offers],
      ['HINCRBY', routes, `${route}|airlines`, airlines],
      ['EXPIRE', routes, KEEP_SECONDS],
    ]
  );
}

function booking({ ok, expired, priceChanged, held, value, currency }) {
  add({
    book_attempts: 1,
    book_ok: ok ? 1 : 0,
    book_failed: ok ? 0 : 1,
    book_expired: expired ? 1 : 0,
    book_price_changed: priceChanged ? 1 : 0,
    book_held: ok && held ? 1 : 0,
    [`booked_value:${currency || 'XXX'}`]: ok && value ? value : 0,
  });
}

const heldPaid = () => add({ held_paid: 1 });

function cancellation({ refund, currency }) {
  add({ cancellations: 1, [`refunded:${currency || 'XXX'}`]: refund || 0 });
}

function webhook({ type, verified, duplicate }) {
  add({
    webhooks: 1,
    webhooks_verified: verified ? 1 : 0,
    webhooks_duplicate: duplicate ? 1 : 0,
    schedule_changes: type === 'order.airline_initiated_change_detected' && verified && !duplicate ? 1 : 0,
    [`webhook:${type || 'unknown'}`]: 1,
  });
}

// ---------------------------------------------------------------------------
// Reading the trends back
// ---------------------------------------------------------------------------
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}
const ratio = (a, b) => (b ? a / b : null);

function summarise(date, h, ms) {
  const n = (f) => Number(h[f] || 0);
  const steps = new Set(Object.keys(h).filter((f) => f.startsWith('calls:')).map((f) => f.slice(6)));
  let calls = 0;
  let errors = 0;
  const errorRateByStep = {};
  for (const s of steps) {
    calls += n(`calls:${s}`);
    errors += n(`errors:${s}`);
    errorRateByStep[s] = ratio(n(`errors:${s}`), n(`calls:${s}`));
  }
  const sorted = ms.map(Number).sort((a, b) => a - b);
  const money = (prefix) =>
    Object.fromEntries(Object.keys(h).filter((f) => f.startsWith(prefix)).map((f) => [f.slice(prefix.length), Number(h[f])]));
  return {
    date,
    searches: n('searches'),
    duffelSearches: n('calls:search'),
    searchMsP50: quantile(sorted, 0.5),
    searchMsP95: quantile(sorted, 0.95),
    offersPerSearch: ratio(n('search_offers'), n('searches')),
    airlinesPerSearch: ratio(n('search_airlines'), n('searches')),
    emptySearchRate: ratio(n('searches_empty'), n('searches')),
    duffelCalls: calls,
    errorRate: ratio(errors, calls),
    errorRateByStep,
    bookAttempts: n('book_attempts'),
    bookings: n('book_ok'),
    orderSuccessRate: ratio(n('book_ok'), n('book_attempts')),
    offerExpiredRate: ratio(n('book_expired'), n('book_attempts')),
    priceChangeRate: ratio(n('book_price_changed'), n('book_ok')),
    searchesPerBooking: ratio(n('calls:search'), n('book_ok')),
    held: n('book_held'),
    heldPaid: n('held_paid'),
    bookedValue: money('booked_value:'),
    cancellations: n('cancellations'),
    refunded: money('refunded:'),
    webhooks: n('webhooks'),
    webhookVerifiedRate: ratio(n('webhooks_verified'), n('webhooks')),
    scheduleChanges: n('schedule_changes'),
    scheduleChangesPer100Bookings: n('book_ok') ? (100 * n('schedule_changes')) / n('book_ok') : null,
  };
}

async function trends(days = 30, mode = MODE) {
  if (!enabled) return { enabled: false, mode, days: [], routes: [] };
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const cmds = [];
  for (const d of dates) {
    const k = dayKey(d, mode);
    cmds.push(['HGETALL', k], ['LRANGE', `${k}:search_ms`, 0, -1], ['HGETALL', `${k}:routes`]);
  }
  const out = await redis(cmds);
  const toObj = (r) => {
    if (!r) return {};
    if (!Array.isArray(r)) return r;
    const o = {};
    for (let i = 0; i < r.length; i += 2) o[r[i]] = r[i + 1];
    return o;
  };
  const routeTotals = {};
  const result = dates.map((d, i) => {
    const routes = toObj(out[i * 3 + 2]);
    for (const [f, v] of Object.entries(routes)) {
      const [route, what] = f.split('|');
      routeTotals[route] = routeTotals[route] || { route, searches: 0, offers: 0, airlines: 0 };
      routeTotals[route][what] = (routeTotals[route][what] || 0) + Number(v);
    }
    return summarise(d, toObj(out[i * 3]), out[i * 3 + 1] || []);
  });
  const routes = Object.values(routeTotals)
    .map((r) => ({ route: r.route, searches: r.searches, offersPerSearch: ratio(r.offers, r.searches), airlinesPerSearch: ratio(r.airlines, r.searches) }))
    .sort((a, b) => b.searches - a.searches)
    .slice(0, 25);
  return { enabled: true, mode, days: result, routes };
}

module.exports = { enabled, MODE, duffelCall, search, booking, heldPaid, cancellation, webhook, trends, summarise, stepOf };
