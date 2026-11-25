// Nomad: a flight search and booking app on top of the Duffel API.
// The server keeps the API key secret, shapes Duffel data for the page,
// receives Duffel webhooks, checks their signature, and streams them to the page (SSE).
// Runs locally (npm start) or on Vercel (the app is exported below).

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { registerAi } = require('./ai');

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.DUFFEL_API_KEY || '';
const DUFFEL = 'https://api.duffel.com';
let webhookSecret = process.env.DUFFEL_WEBHOOK_SECRET || '';

const app = express();

// ---------------------------------------------------------------------------
// Live feed (Server-Sent Events). API calls and webhooks are pushed here.
// ---------------------------------------------------------------------------
const clients = new Set();
const history = []; // recent events, replayed to new browser tabs
function broadcast(kind, payload) {
  const evt = { kind, at: new Date().toISOString(), ...payload };
  history.push(evt);
  if (history.length > 100) history.shift();
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of clients) res.write(line);
}

// Large responses (a search can return thousands of offers) are summarised in the feed.
function feedSafe(value) {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (text.length < 30000) return value;
  const offers = value && value.data && Array.isArray(value.data.offers) ? value.data.offers.length : undefined;
  return {
    note: `Response is ${(text.length / 1e6).toFixed(1)} MB, too large to show here.`,
    id: value && value.data && value.data.id,
    offers,
  };
}

// ---------------------------------------------------------------------------
// Optional password. Set PLAYGROUND_PASSWORD on a public URL (for example Vercel),
// or anyone with the link can book on your Duffel account. /webhook stays open for Duffel.
// ---------------------------------------------------------------------------
const PASSWORD = process.env.PLAYGROUND_PASSWORD || '';
app.use((req, res, next) => {
  if (!PASSWORD || req.path === '/webhook') return next();
  const [scheme, encoded] = (req.get('Authorization') || '').split(' ');
  const pass =
    scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  if (crypto.timingSafeEqual(a, b)) return next();
  res.set('WWW-Authenticate', 'Basic realm="Nomad"').status(401).send('Password required');
});

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
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
// Header: X-Duffel-Signature: t=<unix>,v1=<hex HMAC-SHA256("<t>.<raw body>")>
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
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.`).update(rawBody).digest('hex');
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
  broadcast('webhook', { type: body.type || '(no type)', verified: check.ok, reason: check.reason, duplicate, body });
  console.log(`[webhook] ${body.type} verified=${check.ok}${check.reason ? ` (${check.reason})` : ''}`);
  if (!check.ok) return res.status(401).json({ error: check.reason });
  res.status(200).json({ received: true });
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Duffel client
// ---------------------------------------------------------------------------
async function duffel(method, urlPath, data) {
  if (!API_KEY) {
    const err = new Error('DUFFEL_API_KEY is missing. Add it to .env (or Vercel settings) and restart.');
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
    response: feedSafe(json),
  });
  if (!res.ok) {
    const first = json.errors && json.errors[0];
    const msg = first ? first.message || first.title : json.raw ? json.raw : `Duffel returned ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.duffel = json;
    throw err;
  }
  return json;
}

const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, duffel: e.duffel });
  }
};

const fail = (status, message) => Object.assign(new Error(message), { status });

app.get('/api/status', (req, res) => {
  res.json({
    apiKeySet: Boolean(API_KEY),
    testMode: API_KEY.startsWith('duffel_test_'),
    webhookSecretSet: Boolean(webhookSecret),
  });
});

registerAi(app, { duffel, broadcast, route, fail });

// ---------------------------------------------------------------------------
// Places (airport and city lookup)
// ---------------------------------------------------------------------------
app.get(
  '/api/places',
  route(async (req) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return { places: [] };
    const out = await duffel('GET', `/places/suggestions?query=${encodeURIComponent(q)}`);
    return {
      places: (out.data || []).slice(0, 8).map((p) => ({
        type: p.type,
        code: p.iata_code,
        name: p.name,
        city: p.city_name || (p.type === 'city' ? p.name : ''),
        cityCode: p.iata_city_code || (p.type === 'city' ? p.iata_code : ''),
        country: p.iata_country_code,
        airports: (p.airports || []).slice(0, 6).map((a) => ({ code: a.iata_code, name: a.name })),
      })),
    };
  })
);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
const CABINS = ['economy', 'premium_economy', 'business', 'first'];
const CABIN_RANK = { economy: 1, premium_economy: 2, business: 3, first: 4 };

function minutes(iso) {
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(iso || '');
  return m ? (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// Turn a Duffel offer into the small shape the page needs.
function slimOffer(o) {
  const slices = o.slices.map((s) => {
    const segments = s.segments.map((g) => {
      const p = (g.passengers && g.passengers[0]) || {};
      return {
        flight: `${g.marketing_carrier.iata_code}${g.marketing_carrier_flight_number}`,
        carrier: g.marketing_carrier.name,
        carrierCode: g.marketing_carrier.iata_code,
        operatedBy: g.operating_carrier && g.operating_carrier.name !== g.marketing_carrier.name ? g.operating_carrier.name : null,
        from: g.origin.iata_code,
        fromName: g.origin.name,
        to: g.destination.iata_code,
        toName: g.destination.name,
        departingAt: g.departing_at,
        arrivingAt: g.arriving_at,
        minutes: minutes(g.duration),
        aircraft: g.aircraft && g.aircraft.name,
        cabin: p.cabin_class || 'economy',
        cabinName: p.cabin_class_marketing_name || p.cabin_class,
        amenities: p.cabin && p.cabin.amenities,
        baggages: p.baggages || [],
      };
    });
    const segMinutes = segments.reduce((t, g) => t + (g.minutes || 1), 0);
    const comfort = segments.reduce((t, g) => t + CABIN_RANK[g.cabin] * (g.minutes || 1), 0) / segMinutes;
    const first = segments[0];
    const last = segments[segments.length - 1];
    return {
      origin: s.origin.iata_code,
      originCity: s.origin.city_name || s.origin.name,
      destination: s.destination.iata_code,
      destinationCity: s.destination.city_name || s.destination.name,
      destinationCityCode: s.destination.iata_city_code || s.destination.iata_code,
      departingAt: first.departingAt,
      arrivingAt: last.arrivingAt,
      minutes: minutes(s.duration) || segMinutes,
      stops: segments.length - 1,
      fareBrand: s.fare_brand_name,
      cabins: [...new Set(segments.map((g) => g.cabin))].sort((a, b) => CABIN_RANK[b] - CABIN_RANK[a]),
      comfort,
      segments,
    };
  });
  const cond = o.conditions || {};
  // Facts the filters use. "Main flight" means the longest flight in each direction,
  // so a short connecting hop without Wi-Fi does not hide an otherwise good trip.
  const mains = slices.map((sl) => sl.segments.reduce((a, b) => ((b.minutes || 0) > (a.minutes || 0) ? b : a)));
  const all = slices.flatMap((sl) => sl.segments);
  const am = (g) => g.amenities || {};
  const qty = (g, type) => (g.baggages || []).filter((b) => b.type === type).reduce((t, b) => t + b.quantity, 0);
  const rawCond = (key) => o.slices.every((sl) => sl.conditions && sl.conditions[key] === true);
  const FLAT = ['full_flat', 'full_flat_pod', 'private_suite'];
  const features = {
    checkedBags: all.length ? Math.min(...all.map((g) => qty(g, 'checked'))) : 0,
    cabinBag: all.every((g) => qty(g, 'carry_on') > 0),
    wifi: mains.every((g) => am(g).wifi && am(g).wifi.available),
    wifiFree: mains.every((g) => am(g).wifi && am(g).wifi.available && am(g).wifi.cost === 'free'),
    power: mains.every((g) => am(g).power && am(g).power.available),
    flatBed: mains.every((g) => am(g).seat && FLAT.includes(am(g).seat.type)),
    suite: mains.every((g) => am(g).seat && am(g).seat.type === 'private_suite'),
    legroom: mains.every((g) => am(g).seat && (am(g).seat.legroom === 'more' || FLAT.includes(am(g).seat.type))),
    priorityBoarding: rawCond('priority_boarding'),
    priorityCheckIn: rawCond('priority_check_in'),
    seatSelection: rawCond('advance_seat_selection'),
    loyalty: o.supported_loyalty_programmes || [],
  };
  return {
    features,
    id: o.id,
    owner: {
      name: o.owner.name,
      code: o.owner.iata_code,
      logo: o.owner.logo_symbol_url,
    },
    total: Number(o.total_amount),
    currency: o.total_currency,
    emissionsKg: o.total_emissions_kg ? Number(o.total_emissions_kg) : null,
    refundable: Boolean(cond.refund_before_departure && cond.refund_before_departure.allowed),
    changeable: Boolean(cond.change_before_departure && cond.change_before_departure.allowed),
    expiresAt: o.expires_at,
    requiresInstantPayment: Boolean(o.payment_requirements && o.payment_requirements.requires_instant_payment),
    paymentRequiredBy: o.payment_requirements && o.payment_requirements.payment_required_by,
    passengers: o.passengers.map((p) => ({ id: p.id, type: p.type, age: p.age })),
    slices,
    minutes: slices.reduce((t, s) => t + s.minutes, 0),
    stops: slices.reduce((t, s) => t + s.stops, 0),
    comfort: slices.reduce((t, s) => t + s.comfort, 0) / slices.length,
  };
}

// Recommended score: lower is better. Balances price, time in the air, stops and cabin.
function score(offers) {
  if (!offers.length) return offers;
  const prices = offers.map((o) => o.total);
  const times = offers.map((o) => o.minutes);
  const [pMin, pMax] = [Math.min(...prices), Math.max(...prices)];
  const [tMin, tMax] = [Math.min(...times), Math.max(...times)];
  const norm = (v, lo, hi) => (hi > lo ? (v - lo) / (hi - lo) : 0);
  for (const o of offers) {
    const price = norm(o.total, pMin, pMax);
    const time = norm(o.minutes, tMin, tMax);
    const stops = Math.min(o.stops / o.slices.length, 2) / 2;
    const cabin = (o.comfort - 1) / 3;
    o.recommendScore = 0.5 * price + 0.25 * time + 0.15 * stops - 0.1 * cabin;
  }
  return offers;
}

function buildPassengers(p) {
  const adults = Math.max(1, Math.min(9, Number(p.adults) || 1));
  const childAges = (Array.isArray(p.childAges) ? p.childAges : []).map(Number).filter((a) => a >= 2 && a <= 17);
  const infants = Math.max(0, Math.min(adults, Number(p.infants) || 0));
  if (adults + childAges.length + infants > 9) throw fail(400, 'Duffel allows up to 9 travellers per search.');
  const loyalty = Array.isArray(p.loyalty) ? p.loyalty : [];
  const list = [];
  for (let i = 0; i < adults; i++) {
    const pax = { type: 'adult' };
    const accounts = loyalty.filter((l) => Number(l.adult) === i && l.airline && l.number);
    if (accounts.length) {
      const named = accounts.find((l) => l.givenName && l.familyName);
      if (!named) throw fail(400, `Loyalty for adult ${i + 1} needs a given name and family name.`);
      pax.given_name = named.givenName;
      pax.family_name = named.familyName;
      pax.loyalty_programme_accounts = accounts.map((l) => ({
        airline_iata_code: String(l.airline).toUpperCase().trim(),
        account_number: String(l.number).trim(),
      }));
    }
    list.push(pax);
  }
  for (const age of childAges) list.push({ age });
  for (let i = 0; i < infants; i++) list.push({ type: 'infant_without_seat' });
  return list;
}

// Keep only the best offers for each sort order, so the response stays small.
function topOffers(offers, n = 150) {
  const pick = new Set();
  const by = (fn) => [...offers].sort(fn).slice(0, n).forEach((o) => pick.add(o));
  by((a, b) => a.recommendScore - b.recommendScore);
  by((a, b) => a.total - b.total);
  by((a, b) => b.comfort - a.comfort || a.total - b.total);
  by((a, b) => a.minutes - b.minutes);
  by((a, b) => (a.emissionsKg ?? 1e9) - (b.emissionsKg ?? 1e9) || a.total - b.total);
  return [...pick];
}

function dedupe(offers) {
  const best = new Map();
  for (const o of offers) {
    const key = o.slices.map((s) => s.segments.map((g) => g.flight + g.departingAt + g.cabin).join('|')).join('/');
    const cur = best.get(key);
    if (!cur || o.total < cur.total) best.set(key, o);
  }
  return [...best.values()];
}

// Two one-way offers sold together (used for mixed cabins). They become two bookings.
function combine(a, b) {
  const same = a.owner.code === b.owner.code;
  return {
    id: `${a.id}+${b.id}`,
    parts: [a.id, b.id],
    separateTickets: true,
    owner: same ? a.owner : { name: `${a.owner.name} + ${b.owner.name}`, code: `${a.owner.code}+${b.owner.code}`, logo: a.owner.logo, logo2: b.owner.logo },
    total: Math.round((a.total + b.total) * 100) / 100,
    currency: a.currency,
    emissionsKg: a.emissionsKg != null && b.emissionsKg != null ? a.emissionsKg + b.emissionsKg : null,
    refundable: a.refundable && b.refundable,
    requiresInstantPayment: true,
    changeable: a.changeable && b.changeable,
    expiresAt: a.expiresAt < b.expiresAt ? a.expiresAt : b.expiresAt,
    passengers: a.passengers,
    slices: [...a.slices, ...b.slices],
    minutes: a.minutes + b.minutes,
    stops: a.stops + b.stops,
    comfort: (a.comfort + b.comfort) / 2,
    features: Object.fromEntries(
      Object.keys(a.features).map((k) => [
        k,
        k === 'loyalty' ? a.features.loyalty.filter((x) => b.features.loyalty.includes(x)) : k === 'checkedBags' ? Math.min(a.features[k], b.features[k]) : a.features[k] && b.features[k],
      ])
    ),
  };
}

async function searchOnce(legs, passengers, cabin) {
  const data = {
    slices: legs.map((l) => ({ origin: l.origin, destination: l.destination, departure_date: l.date })),
    passengers,
  };
  if (CABINS.includes(cabin)) data.cabin_class = cabin;
  const out = await duffel('POST', '/air/offer_requests?return_offers=true&supplier_timeout=20000', data);
  return (out.data.offers || []).map(slimOffer);
}

app.post(
  '/api/search',
  route(async (req) => {
    const b = req.body || {};
    const legs = Array.isArray(b.legs) ? b.legs : [];
    if (!legs.length || legs.length > 2) throw fail(400, 'Search one way or return.');
    for (const l of legs) {
      if (!l.origin || !l.destination || !l.date) throw fail(400, 'Each flight needs a from, a to and a date.');
    }
    const passengers = buildPassengers(b.passengers || {});
    const legCabins = legs.map((l) => (CABINS.includes(l.cabin) ? l.cabin : 'any'));
    const mixed = legs.length === 2 && legCabins[0] !== legCabins[1];

    let offers;
    let note = null;
    if (!mixed) {
      // One search. "any" leaves the cabin open, so Duffel returns every cabin.
      offers = dedupe(await searchOnce(legs, passengers, legCabins[0]));
    } else {
      // Airlines almost never sell "business out, economy back" as one ticket.
      // So we search each leg on its own, in its own cabin, and pair the best of each.
      const [outbound, inbound] = await Promise.all([
        searchOnce([legs[0]], passengers, legCabins[0]),
        searchOnce([legs[1]], passengers, legCabins[1]),
      ]);
      const bestOut = topOffers(score(dedupe(outbound)), 25);
      const bestIn = topOffers(score(dedupe(inbound)), 25);
      offers = [];
      for (const a of bestOut) for (const c of bestIn) if (a.currency === c.currency) offers.push(combine(a, c));
      note = 'Mixed cabins are sold as two one-way tickets. Each has its own booking reference and rules.';
    }
    offers = score(offers);
    return { matching: offers.length, note, offers: topOffers(offers) };
  })
);

app.get(
  '/api/offers/:id',
  route(async (req) => {
    const out = await duffel('GET', `/air/offers/${encodeURIComponent(req.params.id)}`);
    return { offer: slimOffer(out.data) };
  })
);

// ---------------------------------------------------------------------------
// Orders: book, pay, view, change, cancel
// ---------------------------------------------------------------------------
function slimOrder(o) {
  const pay = o.payment_status || {};
  return {
    id: o.id,
    reference: o.booking_reference,
    createdAt: o.created_at,
    cancelledAt: o.cancelled_at,
    total: Number(o.total_amount),
    currency: o.total_currency,
    type: o.type,
    awaitingPayment: Boolean(pay.awaiting_payment),
    paymentRequiredBy: pay.payment_required_by,
    actions: o.available_actions || [],
    owner: { name: o.owner.name, code: o.owner.iata_code, logo: o.owner.logo_symbol_url },
    passengers: (o.passengers || []).map((p) => ({
      id: p.id,
      title: p.title,
      givenName: p.given_name,
      familyName: p.family_name,
      bornOn: p.born_on,
      type: p.type,
      email: p.email,
      phone: p.phone_number,
    })),
    conditions: o.conditions || {},
    changes: (o.changes || []).length,
    slices: (o.slices || []).map((s) => {
      const segs = s.segments || [];
      return {
        id: s.id,
        origin: s.origin.iata_code,
        originCity: s.origin.city_name || s.origin.name,
        destination: s.destination.iata_code,
        destinationCity: s.destination.city_name || s.destination.name,
        destinationCityCode: s.destination.iata_city_code || s.destination.iata_code,
        departingAt: segs[0] && segs[0].departing_at,
        arrivingAt: segs.length ? segs[segs.length - 1].arriving_at : null,
        minutes: minutes(s.duration),
        stops: Math.max(0, segs.length - 1),
        changeable: s.changeable !== false,
        cabins: [...new Set(segs.map((g) => (g.passengers && g.passengers[0] && g.passengers[0].cabin_class) || 'economy'))],
        segments: segs.map((g) => ({
          flight: `${g.marketing_carrier.iata_code}${g.marketing_carrier_flight_number}`,
          carrier: g.marketing_carrier.name,
          from: g.origin.iata_code,
          to: g.destination.iata_code,
          departingAt: g.departing_at,
          arrivingAt: g.arriving_at,
          aircraft: g.aircraft && g.aircraft.name,
          cabin: (g.passengers && g.passengers[0] && g.passengers[0].cabin_class) || 'economy',
        })),
      };
    }),
  };
}

async function bookOffer(offerId, travellers, payLater) {
  // Re-fetch the offer: this gives the current price and the passenger ids.
  const offer = (await duffel('GET', `/air/offers/${encodeURIComponent(offerId)}`)).data;
  if (travellers.length !== offer.passengers.length) throw fail(400, 'Traveller count does not match the offer.');
  const lead = travellers[0] || {};
  const passengers = offer.passengers.map((p, i) => {
    const t = travellers[i] || {};
    return {
      id: p.id,
      title: t.title,
      gender: t.gender,
      given_name: t.givenName,
      family_name: t.familyName,
      born_on: t.bornOn,
      email: t.email || lead.email,
      phone_number: t.phone || lead.phone,
    };
  });
  // Each infant travels on an adult's lap: link infant i to adult i.
  const adults = passengers.filter((_, i) => offer.passengers[i].type === 'adult');
  const infants = passengers.filter((_, i) => offer.passengers[i].type === 'infant_without_seat');
  infants.forEach((inf, i) => {
    if (adults[i]) adults[i].infant_passenger_id = inf.id;
  });
  const hold = Boolean(payLater) && !(offer.payment_requirements && offer.payment_requirements.requires_instant_payment);
  const data = { type: hold ? 'hold' : 'instant', selected_offers: [offer.id], passengers };
  // Whatever method the traveller picks on the page, the test booking is paid from the Duffel balance.
  if (!hold) data.payments = [{ type: 'balance', currency: offer.total_currency, amount: offer.total_amount }];
  const out = await duffel('POST', '/air/orders', data);
  return { order: slimOrder(out.data), held: hold };
}

app.post(
  '/api/orders',
  route(async (req) => {
    const { offerId, travellers, payLater } = req.body || {};
    if (!offerId || !Array.isArray(travellers)) throw fail(400, 'Missing offer or traveller details.');
    const parts = String(offerId).split('+');
    const results = [];
    for (const part of parts) {
      try {
        results.push(await bookOffer(part, travellers, payLater));
      } catch (e) {
        // Two-ticket trip: if the second ticket fails, cancel the first so nothing is left half-booked.
        for (const r of results) {
          try {
            const c = await duffel('POST', '/air/order_cancellations', { order_id: r.order.id });
            await duffel('POST', `/air/order_cancellations/${c.data.id}/actions/confirm`);
          } catch {
            /* reported below */
          }
        }
        if (results.length) e.message = `${e.message} The first ticket was cancelled, so nothing is booked.`;
        throw e;
      }
    }
    return { orders: results.map((r) => r.order), held: results.some((r) => r.held) };
  })
);

app.get(
  '/api/orders',
  route(async () => {
    const out = await duffel('GET', '/air/orders?limit=50');
    const orders = (out.data || []).map(slimOrder).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { orders };
  })
);

app.get(
  '/api/orders/:id',
  route(async (req) => ({ order: slimOrder((await duffel('GET', `/air/orders/${encodeURIComponent(req.params.id)}`)).data) }))
);

// Find a booking by reference + last name (like an airline's "Manage booking").
app.post(
  '/api/orders/lookup',
  route(async (req) => {
    const ref = String(req.body.reference || '').trim().toUpperCase();
    const last = String(req.body.lastName || '').trim().toLowerCase();
    const out = await duffel('GET', '/air/orders?limit=200');
    const hit = (out.data || []).find(
      (o) => o.booking_reference === ref && o.passengers.some((p) => (p.family_name || '').toLowerCase() === last)
    );
    if (!hit) throw fail(404, 'No booking matches that reference and last name.');
    return { order: slimOrder(hit) };
  })
);

// Pay for a held order.
app.post(
  '/api/orders/:id/pay',
  route(async (req) => {
    const o = (await duffel('GET', `/air/orders/${encodeURIComponent(req.params.id)}`)).data;
    await duffel('POST', '/air/payments', {
      order_id: o.id,
      payment: { type: 'balance', amount: o.total_amount, currency: o.total_currency },
    });
    return { order: slimOrder((await duffel('GET', `/air/orders/${encodeURIComponent(o.id)}`)).data) };
  })
);

// Change one flight of a booking to a new date and/or cabin. Returns the airline's options.
app.post(
  '/api/orders/:id/change-options',
  route(async (req) => {
    const { sliceId, date, cabin } = req.body || {};
    const o = (await duffel('GET', `/air/orders/${encodeURIComponent(req.params.id)}`)).data;
    const slice = o.slices.find((s) => s.id === sliceId);
    if (!slice) throw fail(400, 'That flight is not part of this booking.');
    const add = { origin: slice.origin.iata_code, destination: slice.destination.iata_code, departure_date: date };
    if (CABINS.includes(cabin)) add.cabin_class = cabin;
    const out = await duffel('POST', '/air/order_change_requests', {
      order_id: o.id,
      slices: { remove: [{ slice_id: sliceId }], add: [add] },
    });
    let options = (out.data.order_change_offers || []).map((c) => ({
      id: c.id,
      changeTotal: Number(c.change_total_amount),
      penalty: Number(c.penalty_total_amount || 0),
      newTotal: Number(c.new_total_amount),
      currency: c.change_total_currency,
      expiresAt: c.expires_at,
      refundTo: c.refund_to,
      slices: (c.slices.add || []).map((s) => {
        const segs = s.segments || [];
        return {
          origin: s.origin.iata_code,
          destination: s.destination.iata_code,
          departingAt: segs[0] && segs[0].departing_at,
          arrivingAt: segs.length ? segs[segs.length - 1].arriving_at : null,
          minutes: minutes(s.duration),
          stops: Math.max(0, segs.length - 1),
          cabins: [...new Set(segs.map((g) => (g.passengers && g.passengers[0] && g.passengers[0].cabin_class) || 'economy'))],
          flights: segs.map((g) => `${g.marketing_carrier.iata_code}${g.marketing_carrier_flight_number}`),
        };
      }),
    }));
    // Duffel may return every cabin. Put the cabin that was asked for first, then the cheapest.
    for (const c of options) c.matchesCabin = !CABINS.includes(cabin) || c.slices.every((s) => s.cabins.includes(cabin));
    options.sort((a, b) => b.matchesCabin - a.matchesCabin || a.changeTotal - b.changeTotal);
    return { options: options.slice(0, 40), anyMatch: options.some((c) => c.matchesCabin) };
  })
);

// Accept a change option: create the change, then confirm it (paying any difference from the balance).
app.post(
  '/api/order-changes',
  route(async (req) => {
    const created = (await duffel('POST', '/air/order_changes', { selected_order_change_offer: req.body.optionId })).data;
    const amount = Number(created.change_total_amount);
    const body = amount > 0 ? { payment: { type: 'balance', amount: created.change_total_amount, currency: created.change_total_currency } } : {};
    const done = (await duffel('POST', `/air/order_changes/${created.id}/actions/confirm`, body)).data;
    return { confirmedAt: done.confirmed_at, changeTotal: amount, currency: created.change_total_currency };
  })
);

app.post(
  '/api/orders/:id/cancellation',
  route(async (req) => {
    const c = (await duffel('POST', '/air/order_cancellations', { order_id: req.params.id })).data;
    return {
      id: c.id,
      refundAmount: c.refund_amount,
      refundCurrency: c.refund_currency,
      refundTo: c.refund_to,
      expiresAt: c.expires_at,
    };
  })
);

app.post(
  '/api/cancellations/:id/confirm',
  route(async (req) => {
    const c = (await duffel('POST', `/air/order_cancellations/${encodeURIComponent(req.params.id)}/actions/confirm`)).data;
    return { confirmedAt: c.confirmed_at, refundAmount: c.refund_amount, refundCurrency: c.refund_currency };
  })
);

// ---------------------------------------------------------------------------
// Webhook management
// ---------------------------------------------------------------------------
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

// Save a value into .env so it survives restarts. Returns false where the disk is read-only (Vercel).
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
    if (!/^https:\/\//.test(url)) throw fail(400, 'Webhook URL must be a public https URL.');
    if (!url.endsWith('/webhook')) url += '/webhook';
    const out = await duffel('POST', '/air/webhooks', { url, events: ALL_EVENTS });
    // Duffel shows the secret only once. Use it now and keep it in .env when possible.
    webhookSecret = out.data.secret;
    const saved = saveEnv('DUFFEL_WEBHOOK_SECRET', webhookSecret);
    return { ...out, savedToEnvFile: saved };
  })
);

app.post(
  '/api/webhooks/:id/ping',
  route(async (req) => duffel('POST', `/air/webhooks/id/${encodeURIComponent(req.params.id)}/actions/ping`, {}))
);

app.delete(
  '/api/webhooks/:id',
  route(async (req) => duffel('DELETE', `/air/webhooks/${encodeURIComponent(req.params.id)}`))
);

module.exports = app; // Vercel imports the app

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nNomad is running at http://localhost:${PORT}\n`);
    if (!API_KEY) console.warn('WARNING: DUFFEL_API_KEY is not set. Copy .env.example to .env and add it.');
    else if (!API_KEY.startsWith('duffel_test_')) console.warn('WARNING: this is NOT a test token. Real bookings happen.');
    if (!webhookSecret) console.warn('Note: DUFFEL_WEBHOOK_SECRET is not set. Webhooks will show as "unverified".');
  });
}
