// AI search: Claude turns a plain-language request into Nomad search fields.
// The traveller reviews the result, corrects it in words or in the form, then searches.
const Anthropic = require('@anthropic-ai/sdk').default;

// Haiku is the cheapest current Claude model. Set ANTHROPIC_MODEL to use another one.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const CABINS = ['economy', 'premium_economy', 'business', 'first', 'any'];
const SORTS = ['recommended', 'comfort', 'price', 'fastest'];

const str = { type: 'string' };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const PLAN_SCHEMA = obj({
  summary: str,
  trip: { type: 'string', enum: ['return', 'oneway'] },
  origin: obj({ query: nullable(str), iata: nullable(str) }),
  destination: obj({ query: nullable(str), iata: nullable(str) }),
  depart: nullable(str),
  ret: nullable(str),
  adults: { type: 'integer' },
  childAges: { type: 'array', items: { type: 'integer' } },
  infants: { type: 'integer' },
  cabin: { type: 'string', enum: CABINS },
  mixed: { type: 'boolean' },
  cabinOut: { type: 'string', enum: CABINS.slice(0, 4) },
  cabinBack: { type: 'string', enum: CABINS.slice(0, 4) },
  prefs: obj({
    sort: { type: 'string', enum: SORTS },
    directOnly: { type: 'boolean' },
    refundable: { type: 'boolean' },
    maxPrice: nullable({ type: 'number' }),
    currency: nullable(str),
  }),
  assumptions: { type: 'array', items: obj({ field: str, text: str }) },
  questions: { type: 'array', items: str },
  alternatives: { type: 'array', items: str },
});

const SYSTEM = `You are the search assistant inside Nomad, a flight booking app.
You turn a traveller's plain-language request into the fields of one flight search. You never book anything.

How to fill the fields:
- origin and destination: put the city or airport the traveller means in "query" (for example "London" or "Heathrow"). Put the 3-letter IATA city or airport code in "iata" when you are confident, else null. Prefer city codes (LON, NYC, PAR, TYO) unless the traveller names an airport.
- If the traveller gives no origin, set origin to null and ask where they are flying from.
- If the destination is vague ("somewhere warm", "a beach in Europe"), pick the single best match, record that choice in assumptions, and list 3 to 5 other cities in "alternatives".
- Dates use YYYY-MM-DD and must be after today. Resolve words like "next Friday" or "mid-March" from today's date. "A week" means 7 nights. If the traveller gives no dates, choose sensible ones about a month ahead and record that in assumptions.
- trip is "oneway" only when the traveller says one way or gives no return. Then ret is null.
- adults is at least 1. Children are aged 2 to 17; infants are under 2. "Family of four" with no ages means 2 adults and 2 children: guess ages 8 and 10 and record that in assumptions.
- cabin is "any" unless the traveller names a class. Set mixed true only when they want a different class each way, and then fill cabinOut and cabinBack. Otherwise set cabinOut "business" and cabinBack "economy".
- prefs.sort: "price" for cheap or budget, "comfort" for comfortable, flat bed or luxury, "fastest" for quickest, else "recommended". directOnly is true for nonstop or direct. refundable is true only when asked. maxPrice is a total budget for everyone if given, with its 3-letter currency.

Every guess you make goes in assumptions, as one short plain sentence naming the field. Put a question in "questions" only when a search cannot run without the answer. Keep questions short.
summary is one plain sentence that describes the search, for example "Return flights from London to Lisbon, 12 to 19 April, 2 adults, economy."

The traveller may send corrections after your first answer. Apply each correction to your previous answer and keep everything else the same. Remove an assumption once the traveller confirms or replaces it.`;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

function registerAi(app, { duffel, broadcast, route, fail }) {
  app.get('/api/ai/status', (req, res) => res.json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL }));

  // Find the place Nomad should search for. Returns the same shape the search form uses.
  async function resolvePlace(p) {
    if (!p || (!p.iata && !p.query)) return null;
    for (const q of [p.iata, p.query].filter(Boolean)) {
      const out = await duffel('GET', `/places/suggestions?query=${encodeURIComponent(q)}`).catch(() => null);
      const list = (out && out.data) || [];
      const hit = list.find((x) => p.iata && x.iata_code === p.iata.toUpperCase()) || list[0];
      if (hit && hit.iata_code) {
        return hit.type === 'city'
          ? { code: hit.iata_code, name: hit.name, sub: `All airports · ${hit.iata_country_code || ''}`, type: 'city' }
          : { code: hit.iata_code, name: hit.name, sub: [hit.city_name, hit.iata_country_code].filter(Boolean).join(', '), type: 'airport' };
      }
    }
    return null;
  }

  // body: { turns: [{ text, plan? }] } - the first text is the request, later texts are corrections.
  app.post(
    '/api/ai/plan',
    route(async (req) => {
      const ai = getClient();
      if (!ai) throw fail(503, 'AI search is off. Add ANTHROPIC_API_KEY to the server settings to turn it on.');
      const turns = Array.isArray(req.body && req.body.turns) ? req.body.turns.slice(-8) : [];
      if (!turns.length || !String(turns[turns.length - 1].text || '').trim()) throw fail(400, 'Tell Nomad what trip you want.');

      const today = new Date().toISOString().slice(0, 10);
      const weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
      const messages = [];
      turns.forEach((t, i) => {
        const text = String(t.text || '').slice(0, 1500);
        messages.push({ role: 'user', content: i === 0 ? `Today is ${weekday} ${today}.\n\n${text}` : text });
        if (i < turns.length - 1 && t.plan) messages.push({ role: 'assistant', content: JSON.stringify(t.plan.raw || t.plan) });
      });

      const started = Date.now();
      let response;
      try {
        response = await ai.messages.create({
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
          messages,
        });
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw fail(502, 'The ANTHROPIC_API_KEY was rejected. Check the key in the server settings.');
        if (e instanceof Anthropic.RateLimitError) throw fail(429, 'AI search is busy. Try again in a moment.');
        if (e instanceof Anthropic.APIError) throw fail(502, `AI search failed (${e.status || 'network'}). Try again, or use the classic search.`);
        throw e;
      }
      broadcast('api', { method: 'AI', path: `claude ${MODEL}`, status: 200, ms: Date.now() - started, request: { turns: turns.map((t) => t.text) }, response: { stop_reason: response.stop_reason, usage: response.usage } });

      if (response.stop_reason === 'refusal') throw fail(422, 'Nomad could not help with that request. Try describing the trip differently.');
      const block = response.content.find((b) => b.type === 'text');
      let raw;
      try {
        raw = JSON.parse(block.text);
      } catch {
        throw fail(502, 'AI search returned an unreadable answer. Try again.');
      }

      // Check the answer and turn it into the search form's shape.
      raw.origin = raw.origin || {};
      raw.destination = raw.destination || {};
      const questions = [...(raw.questions || [])];
      const [from, to] = await Promise.all([resolvePlace(raw.origin), resolvePlace(raw.destination)]);
      if (!from && !questions.length && (raw.origin.query || raw.origin.iata)) questions.push(`Nomad could not find “${raw.origin.query || raw.origin.iata}”. Which city or airport do you mean?`);
      if (!from && !raw.origin.query && !raw.origin.iata && !questions.some((q) => /from/i.test(q))) questions.push('Where are you flying from?');
      if (!to && (raw.destination.query || raw.destination.iata)) questions.push(`Nomad could not find “${raw.destination.query || raw.destination.iata}”. Which city or airport do you mean?`);
      if (!to && !raw.destination.query && !raw.destination.iata && !questions.some((q) => /where|destination|to\b/i.test(q))) questions.push('Where do you want to go?');

      const trip = raw.trip === 'oneway' ? 'oneway' : 'return';
      let depart = isDate(raw.depart) && raw.depart > today ? raw.depart : null;
      let ret = trip === 'return' && isDate(raw.ret) ? raw.ret : null;
      if (!depart) questions.push('When do you want to leave?');
      if (depart && ret && ret < depart) ret = null;
      if (trip === 'return' && depart && !ret) questions.push('When do you want to come back?');

      const adults = clampInt(raw.adults, 1, 9);
      const childAges = (raw.childAges || []).map((a) => clampInt(a, 2, 17));
      const infants = Math.min(clampInt(raw.infants, 0, 9), adults);
      if (adults + childAges.length + infants > 9) questions.push('Nomad can book up to 9 travellers at once. How many people are travelling?');

      const search = {
        trip,
        from,
        to,
        depart,
        ret: trip === 'return' ? ret : null,
        adults,
        childAges,
        infants,
        cabin: CABINS.includes(raw.cabin) ? raw.cabin : 'any',
        mixed: trip === 'return' && Boolean(raw.mixed),
        cabinOut: raw.cabinOut || 'business',
        cabinBack: raw.cabinBack || 'economy',
        loyalty: [],
        prefs: {
          sort: SORTS.includes(raw.prefs && raw.prefs.sort) ? raw.prefs.sort : 'recommended',
          directOnly: Boolean(raw.prefs && raw.prefs.directOnly),
          refundable: Boolean(raw.prefs && raw.prefs.refundable),
          maxPrice: raw.prefs && raw.prefs.maxPrice > 0 ? raw.prefs.maxPrice : null,
          currency: (raw.prefs && raw.prefs.currency) || null,
        },
      };
      if (from && to && from.code === to.code) questions.push('From and To are the same place. Where are you flying from?');

      return {
        summary: raw.summary,
        search,
        assumptions: raw.assumptions || [],
        questions: [...new Set(questions)],
        alternatives: (raw.alternatives || []).slice(0, 5),
        ready: Boolean(from && to && depart && (trip === 'oneway' || ret) && !(from.code === to.code)),
        raw,
      };
    })
  );
}

module.exports = { registerAi };
