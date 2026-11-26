// Nomad Lux: the same flights, for travellers who put comfort and time before price.
// - Searches only Premium economy, Business and First.
// - Ranks by journey time, stops, cabin, flat beds and sensible hours. Price only breaks ties.
// - Explains each pick in plain words, using only data Duffel returns.
// - The concierge (Claude) suggests trip ideas and turns each one into a Lux search.
const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const LUX_CABINS = ['premium_economy', 'business', 'first'];
const RANK = { economy: 1, premium_economy: 2, business: 3, first: 4 };
const LABEL = { premium_economy: 'Premium economy', business: 'Business', first: 'First' };
const LONG_HAUL = 6 * 60; // minutes; a flight this long is where a flat bed matters

const hourOf = (iso) => (iso ? Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60 : 12);
const hm = (min) => `${Math.floor(min / 60)}h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}m` : ''}`;
const norm = (v, lo, hi) => (hi > lo ? (v - lo) / (hi - lo) : 0);

// Facts about one slice that the ranking and the reasons share.
function sliceFacts(sl) {
  const main = sl.segments.reduce((a, b) => ((b.minutes || 0) > (a.minutes || 0) ? b : a));
  const seat = (main.amenities && main.amenities.seat) || {};
  const flat = ['full_flat', 'full_flat_pod', 'private_suite'].includes(seat.type);
  const longHaul = (main.minutes || 0) >= LONG_HAUL;
  const dep = hourOf(sl.departingAt);
  const arr = hourOf(sl.arrivingAt);
  // An early start or a middle-of-the-night arrival costs sleep. An overnight flight in a flat bed does not.
  const earlyStart = dep < 6.5;
  const nightArrival = arr >= 0.5 && arr < 5.5 && !(flat && longHaul);
  const layovers = sl.segments.slice(1).map((g, i) => ({
    at: sl.segments[i].toName || sl.segments[i].to,
    minutes: Math.round((new Date(g.departingAt) - new Date(sl.segments[i].arrivingAt)) / 60000),
  }));
  return { main, flat, suite: seat.type === 'private_suite', longHaul, earlyStart, nightArrival, dep, arr, layovers };
}

// Lux score: lower is better.
function luxRank(offers) {
  if (!offers.length) return offers;
  const times = offers.map((o) => o.minutes);
  const prices = offers.map((o) => o.total);
  const [tMin, tMax] = [Math.min(...times), Math.max(...times)];
  const [pMin, pMax] = [Math.min(...prices), Math.max(...prices)];
  const sortedTimes = [...times].sort((a, b) => a - b);
  const medianTime = sortedTimes[Math.floor(sortedTimes.length / 2)];

  for (const o of offers) {
    const facts = o.slices.map(sliceFacts);
    const n = o.slices.length;
    const stops = o.slices.reduce((t, sl) => t + Math.min(sl.stops, 2) / 2, 0) / n;
    const cabin = 1 - (Math.max(2, o.comfort) - 2) / 2; // First 0, Business 0.5, Premium 1
    const needBed = facts.filter((f) => f.longHaul);
    const bed = needBed.length ? needBed.filter((f) => !f.flat).length / needBed.length : 0;
    const hours = facts.filter((f) => f.earlyStart || f.nightArrival).length / n;
    const allLays = facts.flatMap((f) => f.layovers);
    const badLay = allLays.some((l) => l.minutes > 180 || l.minutes < 55) ? 1 : 0;
    const flex = o.changeable ? (o.refundable ? 0 : 0.4) : 1;
    o.luxScore =
      0.28 * norm(o.minutes, tMin, tMax) +
      0.22 * stops +
      0.16 * cabin +
      0.1 * bed +
      0.08 * hours +
      0.06 * badLay +
      0.05 * flex +
      0.05 * norm(o.total, pMin, pMax);

    // Plain reasons, best first. Only things the airline data shows.
    const good = [];
    const warn = [];
    if (o.stops === 0) good.push(n > 1 ? 'Nonstop every flight' : 'Nonstop');
    if (o.minutes === tMin) good.push('Fastest here');
    else if (medianTime - o.minutes >= 90) good.push(`${hm(medianTime - o.minutes)} quicker than most`);
    const top = Math.max(...o.slices.flatMap((sl) => sl.cabins.map((c) => RANK[c] || 1)));
    const topCabin = Object.keys(RANK).find((k) => RANK[k] === top);
    if (topCabin === 'first') good.push('First class');
    if (facts.some((f) => f.suite)) good.push('Private suite');
    else if (needBed.length && !bed) good.push('Flat bed on the long flights');
    if (!hours) good.push('Sensible hours');
    if (o.features && o.features.wifiFree) good.push('Free Wi‑Fi');
    if (o.features && o.features.priorityBoarding) good.push('Priority boarding');
    if (o.refundable) good.push('Refundable');
    else if (o.changeable) good.push('Changeable');

    const isReturn = n === 2 && o.slices[1].destination === o.slices[0].origin;
    facts.forEach((f, i) => {
      const label = n === 1 ? 'It' : isReturn ? (i ? 'Return' : 'Outbound') : `Flight ${i + 1}`;
      if (f.earlyStart) warn.push(`${label} leaves at ${o.slices[i].departingAt.slice(11, 16)}`);
      if (f.nightArrival) warn.push(`${label} lands at ${o.slices[i].arrivingAt.slice(11, 16)}`);
      for (const l of f.layovers) {
        if (l.minutes > 180) warn.push(`${hm(l.minutes)} wait in ${l.at}`);
        if (l.minutes < 55) warn.push(`Tight ${l.minutes} min connection in ${l.at}`);
      }
      if (f.longHaul && !f.flat) warn.push(`No flat bed on the ${hm(f.main.minutes)} flight`);
    });
    if (o.slices.some((sl) => sl.cabins.includes('economy'))) warn.push('Part of the trip is in Economy');
    o.lux = { good: good.slice(0, 5), warn: warn.slice(0, 3), topCabin };
  }
  return offers;
}

// ---------------------------------------------------------------------------
// Concierge: trip ideas from Claude
// ---------------------------------------------------------------------------
const str = { type: 'string' };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const IDEAS_SCHEMA = obj({
  intro: str,
  origin: obj({ query: nullable(str), iata: nullable(str) }),
  adults: { type: 'integer' },
  questions: { type: 'array', items: str },
  ideas: {
    type: 'array',
    items: obj({
      city: str,
      country: str,
      iata: str,
      headline: str,
      why: str,
      highlights: { type: 'array', items: str },
      depart: str,
      ret: nullable(str),
      cabin: { type: 'string', enum: ['best', 'premium_economy', 'business', 'first'] },
    }),
  },
});

const IDEAS_SYSTEM = `You are the concierge inside Nomad Lux, a flight booking service for travellers who value comfort and their time over saving money.
The traveller describes the trip they want. You suggest 3 or 4 destinations that fit, each with dates, so Nomad can search real premium-cabin flights for it.

Rules:
- Nomad books flights only. It cannot book hotels, restaurants, transfers or experiences. Never name a hotel, restaurant or company, and never quote a price.
- Prefer places that are easy to reach from the traveller's origin: nonstop or one short connection, sensible flight times. Respecting their time matters more than novelty.
- Match the season. Do not suggest a beach in its rainy season or a city in its worst heat.
- "headline" is 3 to 6 words. "why" is one or two short plain sentences on why it suits this traveller now. "highlights" is 2 or 3 short items about well-known, long-standing things to do there (a landscape, a museum, a neighbourhood, a cuisine). No opening hours, prices or claims that could be out of date.
- iata is the 3-letter IATA code of the city (for example LON, NYC, TYO, MLE for the Maldives) or of its main airport.
- Dates use YYYY-MM-DD, after today. Use the traveller's dates if given. Otherwise pick dates about 6 weeks ahead that suit the place, with a sensible length (a long weekend for a short flight, at least 7 nights for a long-haul beach). ret is null only for a one-way trip.
- cabin is "best" unless the traveller asks for a specific class.
- origin: the city they fly from. If they do not say, set both fields null and add a question asking where they fly from. adults defaults to 2 for "we" or "us", else 1.
- intro is one short sentence. Plain words, no exclamation marks, no flattery.
- Put a question in "questions" only when you cannot suggest anything without the answer.`;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}
const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

function registerLux(app, { duffel, broadcast, route, fail, searchOnce, dedupe, buildPassengers }) {
  // body: { legs: [{ origin, destination, date }], passengers, cabin: 'best'|'premium_economy'|'business'|'first' }
  app.post(
    '/api/lux/search',
    route(async (req) => {
      const b = req.body || {};
      const legs = Array.isArray(b.legs) ? b.legs : [];
      if (!legs.length || legs.length > 6) throw fail(400, 'Search between 1 and 6 flights.');
      for (const l of legs) if (!l.origin || !l.destination || !l.date) throw fail(400, 'Each flight needs a from, a to and a date.');
      const passengers = buildPassengers(b.passengers || {});
      const cabins = LUX_CABINS.includes(b.cabin) ? [b.cabin] : LUX_CABINS;

      // Duffel takes one cabin per search, so we ask for each premium cabin at once.
      const settled = await Promise.allSettled(cabins.map((c) => searchOnce(legs, passengers, c)));
      const ok = settled.filter((r) => r.status === 'fulfilled');
      if (!ok.length) throw settled[0].reason;
      const all = dedupe(ok.flatMap((r) => r.value));
      // Duffel may fill a premium search with an Economy connection. Lux hides those.
      const offers = all.filter((o) => o.slices.every((sl) => sl.segments.every((g) => cabins.includes(g.cabin))));
      luxRank(offers);
      offers.sort((a, b2) => a.luxScore - b2.luxScore);
      return {
        matching: offers.length,
        hiddenEconomy: all.length - offers.length,
        cabins,
        offers: offers.slice(0, 120),
      };
    })
  );

  app.get('/api/lux/status', (req, res) => res.json({ concierge: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL }));

  async function resolvePlace(query) {
    if (!query) return null;
    const out = await duffel('GET', `/places/suggestions?query=${encodeURIComponent(query)}`).catch(() => null);
    const list = (out && out.data) || [];
    const hit = list.find((x) => x.iata_code === String(query).toUpperCase()) || list[0];
    if (!hit || !hit.iata_code) return null;
    return hit.type === 'city'
      ? { code: hit.iata_code, name: hit.name, sub: `All airports · ${hit.iata_country_code || ''}`, type: 'city' }
      : { code: hit.iata_code, name: hit.name, sub: [hit.city_name, hit.iata_country_code].filter(Boolean).join(', '), type: 'airport' };
  }

  // body: { text, from?: place } -> { intro, from, adults, questions, ideas: [{ ..., to: place }] }
  app.post(
    '/api/lux/ideas',
    route(async (req) => {
      const ai = getClient();
      if (!ai) throw fail(503, 'The concierge is off. Add ANTHROPIC_API_KEY to the server settings to turn it on.');
      const text = String((req.body && req.body.text) || '').trim().slice(0, 1500);
      if (!text) throw fail(400, 'Tell the concierge what kind of trip you want.');
      const from = req.body && req.body.from && req.body.from.code ? req.body.from : null;
      const today = new Date().toISOString().slice(0, 10);
      const content = `Today is ${today}.${from ? ` The traveller usually flies from ${from.name} (${from.code}) unless they say otherwise.` : ''}\n\n${text}`;

      const started = Date.now();
      let response;
      try {
        response = await ai.messages.create({
          model: MODEL,
          max_tokens: 4000,
          system: IDEAS_SYSTEM,
          output_config: { format: { type: 'json_schema', schema: IDEAS_SCHEMA } },
          messages: [{ role: 'user', content }],
        });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw fail(502, 'The ANTHROPIC_API_KEY was rejected. Check the key in the server settings.');
        if (e instanceof Anthropic.RateLimitError) throw fail(429, 'The concierge is busy. Try again in a moment.');
        if (e instanceof Anthropic.APIError) throw fail(502, `The concierge failed (${e.status || 'network'}). Try again, or search directly.`);
        throw e;
      }
      broadcast('api', { method: 'AI', path: `claude ${MODEL} (Lux ideas)`, status: 200, ms: Date.now() - started, request: { text }, response: { stop_reason: response.stop_reason, usage: response.usage } });
      if (response.stop_reason === 'refusal') throw fail(422, 'The concierge could not help with that. Try describing the trip differently.');
      const block = response.content.find((x) => x.type === 'text');
      let raw;
      try {
        raw = JSON.parse(block.text);
      } catch {
        throw fail(502, 'The concierge returned an unreadable answer. Try again.');
      }

      const origin = raw.origin && (raw.origin.iata || raw.origin.query);
      const [fromPlace, ...toPlaces] = await Promise.all([
        origin ? resolvePlace(raw.origin.iata || raw.origin.query) : Promise.resolve(from),
        ...(raw.ideas || []).slice(0, 4).map((i) => resolvePlace(i.iata || i.city)),
      ]);
      const questions = [...(raw.questions || [])];
      if (!fromPlace && !questions.length) questions.push('Where do you fly from?');
      const ideas = (raw.ideas || [])
        .slice(0, 4)
        .map((i, k) => {
          const depart = isDate(i.depart) && i.depart > today ? i.depart : null;
          const ret = isDate(i.ret) && depart && i.ret > depart ? i.ret : null;
          return {
            city: i.city,
            country: i.country,
            headline: i.headline,
            why: i.why,
            highlights: (i.highlights || []).slice(0, 3),
            depart,
            ret,
            cabin: LUX_CABINS.includes(i.cabin) ? i.cabin : 'best',
            to: toPlaces[k],
          };
        })
        .filter((i) => i.to && i.depart && (!fromPlace || i.to.code !== fromPlace.code));
      return {
        intro: raw.intro,
        from: fromPlace,
        adults: Math.max(1, Math.min(9, Math.round(Number(raw.adults) || 1))),
        questions,
        ideas,
      };
    })
  );
}

module.exports = { registerLux, luxRank, LABEL };
