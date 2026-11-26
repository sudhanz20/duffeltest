// Weather for the places on a trip, from Open-Meteo (https://open-meteo.com).
// Open-Meteo is free, open data and needs no key for non-commercial use.
// Set OPEN_METEO_API_KEY to use its paid, commercial service instead.
//
// A trip date within the forecast range (16 days) gets the live forecast.
// A later date gets the typical weather: the average of the same dates in each of the last 5 years,
// from Open-Meteo's historical weather archive (ERA5 reanalysis).

const FORECAST_DAYS = 16;
const YEARS = 5;
const MAX_WINDOW = 14; // days of a stay that we average
const MAX_PLACES = 24;

const KEY = process.env.OPEN_METEO_API_KEY || '';
const HOST = {
  forecast: KEY ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast',
  archive: KEY ? 'https://customer-archive-api.open-meteo.com/v1/archive' : 'https://archive-api.open-meteo.com/v1/archive',
  geocode: 'https://geocoding-api.open-meteo.com/v1/search',
};

// Coordinates for common city and airport codes, so most lookups need no extra call.
// Anything else is looked up in Duffel's place data, then in Open-Meteo's geocoder.
const COORDS = {
  LON: [51.51, -0.13], LHR: [51.47, -0.45], LGW: [51.15, -0.19], STN: [51.89, 0.24], LCY: [51.5, 0.05], LTN: [51.87, -0.37],
  MAN: [53.48, -2.24], EDI: [55.95, -3.19], GLA: [55.86, -4.25], BHX: [52.48, -1.9], DUB: [53.35, -6.26],
  PAR: [48.86, 2.35], CDG: [49.01, 2.55], ORY: [48.73, 2.36], NCE: [43.7, 7.27], LYS: [45.76, 4.84],
  AMS: [52.37, 4.9], BRU: [50.85, 4.35], FRA: [50.11, 8.68], MUC: [48.14, 11.58], BER: [52.52, 13.4], HAM: [53.55, 9.99],
  ZRH: [47.38, 8.54], GVA: [46.2, 6.14], VIE: [48.21, 16.37], PRG: [50.08, 14.44], CPH: [55.68, 12.57], OSL: [59.91, 10.75],
  STO: [59.33, 18.07], ARN: [59.65, 17.92], HEL: [60.17, 24.94], REK: [64.15, -21.94], KEF: [63.98, -22.6],
  MAD: [40.42, -3.7], BCN: [41.39, 2.17], LIS: [38.72, -9.14], OPO: [41.15, -8.61], AGP: [36.72, -4.42], PMI: [39.57, 2.65],
  ROM: [41.9, 12.5], FCO: [41.8, 12.25], MIL: [45.46, 9.19], MXP: [45.63, 8.72], VCE: [45.44, 12.33], NAP: [40.85, 14.27],
  ATH: [37.98, 23.73], IST: [41.01, 28.98], JTR: [36.4, 25.48], JMK: [37.44, 25.33], TFS: [28.05, -16.57], LPA: [27.93, -15.39],
  NYC: [40.71, -74.01], JFK: [40.64, -73.78], EWR: [40.69, -74.17], LGA: [40.78, -73.87], BOS: [42.36, -71.06],
  WAS: [38.9, -77.04], CHI: [41.88, -87.63], ORD: [41.98, -87.9], MIA: [25.76, -80.19], ATL: [33.75, -84.39],
  LAX: [34.05, -118.24], SFO: [37.77, -122.42], SEA: [47.61, -122.33], LAS: [36.17, -115.14], DFW: [32.78, -96.8],
  YTO: [43.65, -79.38], YYZ: [43.68, -79.63], YVR: [49.28, -123.12], YMQ: [45.5, -73.57], MEX: [19.43, -99.13], CUN: [21.16, -86.85],
  HNL: [21.31, -157.86], RIO: [-22.91, -43.17], GIG: [-22.81, -43.25], SAO: [-23.55, -46.63], GRU: [-23.43, -46.47],
  BUE: [-34.6, -58.38], EZE: [-34.82, -58.54], LIM: [-12.05, -77.04], BOG: [4.71, -74.07], SCL: [-33.45, -70.67],
  DXB: [25.2, 55.27], DWC: [24.9, 55.16], AUH: [24.45, 54.38], DOH: [25.29, 51.53], TLV: [32.09, 34.78], CAI: [30.04, 31.24],
  RAK: [31.63, -8.01], CPT: [-33.92, 18.42], JNB: [-26.2, 28.05], NBO: [-1.29, 36.82], ZNZ: [-6.16, 39.2], MRU: [-20.16, 57.5],
  SEZ: [-4.62, 55.45], MLE: [4.18, 73.51], CMB: [6.93, 79.86], DEL: [28.61, 77.21], BOM: [19.08, 72.88], GOI: [15.38, 73.83],
  SIN: [1.35, 103.82], BKK: [13.76, 100.5], HKT: [7.88, 98.39], KUL: [3.14, 101.69], DPS: [-8.65, 115.22], HAN: [21.03, 105.85],
  SGN: [10.82, 106.63], HKG: [22.32, 114.17], TPE: [25.03, 121.57], MNL: [14.6, 120.98], SEL: [37.57, 126.98], ICN: [37.46, 126.44],
  TYO: [35.68, 139.69], HND: [35.55, 139.78], NRT: [35.77, 140.39], OSA: [34.69, 135.5], KIX: [34.43, 135.24], PEK: [39.9, 116.4],
  SHA: [31.23, 121.47], PVG: [31.14, 121.81], SYD: [-33.87, 151.21], MEL: [-37.81, 144.96], BNE: [-27.47, 153.03],
  PER: [-31.95, 115.86], AKL: [-36.85, 174.76], ZQN: [-45.03, 168.66], PPT: [-17.54, -149.57], NAN: [-17.76, 177.44],
};

// ---------- Small in-memory cache (per server instance) ----------
const cache = new Map();
function cached(key, ttlMs, make) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = Promise.resolve()
    .then(make)
    .catch((e) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, { value, until: Date.now() + ttlMs });
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
  return value;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.reason || `Open-Meteo answered ${res.status}`);
  return json;
}
const withKey = (url) => (KEY ? `${url}&apikey=${encodeURIComponent(KEY)}` : url);

// ---------- Dates (UTC, YYYY-MM-DD) ----------
const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const ymd = (d) => d.toISOString().slice(0, 10);
const plusDays = (s, n) => ymd(new Date(toDate(s).getTime() + n * 864e5));
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const shiftYear = (s, years) => {
  const d = toDate(s);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return ymd(d);
};

// ---------- Where is a place? ----------
function registerWeather(app, { duffel, fail }) {
  function coordsOf(code, name) {
    const c = String(code || '').toUpperCase();
    if (COORDS[c]) return Promise.resolve(COORDS[c]);
    return cached(`geo:${c}:${name || ''}`, 30 * 864e5, async () => {
      if (/^[A-Z]{3}$/.test(c)) {
        const out = await duffel('GET', `/places/suggestions?query=${encodeURIComponent(c)}`).catch(() => null);
        const hit = ((out && out.data) || []).find((p) => p.iata_code === c);
        if (hit) {
          if (hit.latitude != null && hit.longitude != null) return [Number(hit.latitude), Number(hit.longitude)];
          const ap = (hit.airports || []).filter((a) => a.latitude != null && a.longitude != null);
          if (ap.length) return [ap.reduce((t, a) => t + Number(a.latitude), 0) / ap.length, ap.reduce((t, a) => t + Number(a.longitude), 0) / ap.length];
          if (!name) name = hit.city_name || hit.name;
        }
      }
      if (!name) return null;
      const g = await getJson(`${HOST.geocode}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`).catch(() => null);
      const r = g && g.results && g.results[0];
      return r ? [r.latitude, r.longitude] : null;
    });
  }

  // Open-Meteo takes many places in one call and then answers with a list.
  const asList = (json) => (Array.isArray(json) ? json : [json]);
  const coordParams = (pts) => `latitude=${pts.map((p) => p[0].toFixed(2)).join(',')}&longitude=${pts.map((p) => p[1].toFixed(2)).join(',')}`;
  const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum';

  function summarise(days) {
    const ok = days.filter((d) => d.hi != null && d.lo != null);
    if (!ok.length) return null;
    const avg = (k) => ok.reduce((t, d) => t + d[k], 0) / ok.length;
    const wet = ok.filter((d) => d.rain != null);
    return {
      highC: Math.round(avg('hi') * 10) / 10,
      lowC: Math.round(avg('lo') * 10) / 10,
      // Share of days with at least 1 mm of rain or snow.
      wetDays: wet.length ? Math.round((wet.filter((d) => d.rain >= 1).length / wet.length) * 100) : null,
    };
  }
  const daysOf = (daily, keep = () => true) =>
    (daily && daily.time ? daily.time : [])
      .map((t, i) => ({ t, hi: daily.temperature_2m_max[i], lo: daily.temperature_2m_min[i], rain: daily.precipitation_sum ? daily.precipitation_sum[i] : null }))
      .filter((d) => keep(d.t));

  async function forecast(pts, from, to) {
    const json = await getJson(withKey(`${HOST.forecast}?${coordParams(pts)}&daily=${DAILY}&timezone=auto&start_date=${from}&end_date=${to}`));
    return asList(json).map((r) => summarise(daysOf(r.daily)));
  }

  // The same dates in each of the last YEARS years that the archive covers (it runs about 5 days behind).
  async function typical(pts, from, to) {
    const latest = plusDays(ymd(new Date()), -6);
    const years = [];
    for (let k = 1; years.length < YEARS && k < YEARS + 3; k++) if (shiftYear(to, k) <= latest) years.push(k);
    const runs = await Promise.all(
      years.map((k) =>
        getJson(withKey(`${HOST.archive}?${coordParams(pts)}&daily=${DAILY}&timezone=auto&start_date=${shiftYear(from, k)}&end_date=${shiftYear(to, k)}`)).then(asList)
      )
    );
    return pts.map((_, i) => {
      const s = summarise(runs.flatMap((run) => daysOf(run[i] && run[i].daily)));
      return s && { ...s, years: years.length, sinceYear: toDate(shiftYear(from, years[years.length - 1])).getUTCFullYear() };
    });
  }

  // Weather for several places over one date window.
  async function weatherFor(places, from, to) {
    const today = ymd(new Date());
    if (to < from) [from, to] = [to, from];
    if (daysBetween(from, to) >= MAX_WINDOW) to = plusDays(from, MAX_WINDOW - 1);
    const lastForecast = plusDays(today, FORECAST_DAYS - 1);
    // Dates that the forecast fully covers get the forecast. Anything reaching past it gets typical weather,
    // so a long stay is never described by its first few days alone.
    const kind = to <= lastForecast && to >= today ? 'forecast' : 'typical';
    let wFrom = from;
    let wTo = to;
    if (kind === 'forecast') {
      if (wFrom < today) wFrom = today;
      if (wTo > lastForecast) wTo = lastForecast;
    } else {
      // Typical weather is snapped to whole weeks so that nearby searches share the cache.
      const start = toDate(from);
      const doy = Math.floor((start - Date.UTC(start.getUTCFullYear(), 0, 1)) / 864e5);
      wFrom = plusDays(ymd(new Date(Date.UTC(start.getUTCFullYear(), 0, 1))), Math.floor(doy / 7) * 7);
      const weeks = Math.max(1, Math.ceil((daysBetween(wFrom, to) + 1) / 7));
      wTo = plusDays(wFrom, Math.min(weeks * 7, MAX_WINDOW) - 1);
    }

    const pts = await Promise.all(places.map((p) => coordsOf(p.code, p.name).catch(() => null)));
    const known = places.map((p, i) => ({ ...p, pt: pts[i] })).filter((p) => p.pt);
    const out = new Map();
    // One cache entry per place and window, fetched together when several are missing.
    const missing = [];
    const ttl = kind === 'forecast' ? 3 * 36e5 : 7 * 864e5;
    for (const p of known) {
      const key = `${kind}:${p.pt[0].toFixed(2)},${p.pt[1].toFixed(2)}:${wFrom}:${wTo}`;
      const hit = cache.get(key);
      if (hit && hit.until > Date.now()) out.set(p.code, hit.value);
      else missing.push({ p, key });
    }
    if (missing.length) {
      const batch = (kind === 'forecast' ? forecast : typical)(missing.map((m) => m.p.pt), wFrom, wTo);
      missing.forEach((m, i) => {
        const v = batch.then((list) => list[i]);
        v.catch(() => cache.delete(m.key));
        cache.set(m.key, { value: v, until: Date.now() + ttl });
        out.set(m.p.code, v);
      });
    }
    const results = await Promise.all(
      places.map(async (p) => {
        const v = out.has(p.code) ? await out.get(p.code).catch(() => null) : null;
        if (!v) return { code: p.code, error: 'No weather data for this place.' };
        return { code: p.code, kind, from: wFrom, to: wTo, ...v };
      })
    );
    if (cache.size > 3000) for (const k of [...cache.keys()].slice(0, 500)) cache.delete(k);
    return results;
  }

  // GET /api/weather?codes=LON,NYC&from=2027-01-10&to=2027-01-17
  // -> { places: [{ code, kind: 'forecast'|'typical', from, to, highC, lowC, wetDays, years? }] }
  app.get('/api/weather', async (req, res) => {
    try {
      const codes = [...new Set(String(req.query.codes || '').toUpperCase().split(',').map((c) => c.trim()).filter((c) => /^[A-Z0-9]{3}$/.test(c)))].slice(0, MAX_PLACES);
      const from = String(req.query.from || '');
      const to = String(req.query.to || from);
      if (!codes.length) throw fail(400, 'Give one or more 3-letter place codes.');
      if (!isDay(from) || !isDay(to)) throw fail(400, 'Give dates as YYYY-MM-DD.');
      const places = await weatherFor(codes.map((code) => ({ code })), from, to);
      res.set('Cache-Control', 'private, max-age=1800');
      res.json({ source: 'Open-Meteo', places });
    } catch (e) {
      res.status(e.status || 502).json({ error: e.message });
    }
  });

  return { weatherFor };
}

// Shared words for a temperature, used by Ask Nomad and the Lux concierge.
// Based on the average daytime high.
function feelOf(highC) {
  if (highC == null) return null;
  if (highC >= 28) return 'hot';
  if (highC >= 22) return 'warm';
  if (highC >= 15) return 'mild';
  if (highC >= 8) return 'cool';
  return 'cold';
}
const fits = (climate, highC) => {
  const f = feelOf(highC);
  if (!climate || !f) return true;
  if (climate === 'warm') return f === 'warm' || f === 'hot';
  if (climate === 'cool') return f === 'cool' || f === 'cold';
  if (climate === 'mild') return f === 'mild';
  return true;
};

module.exports = { registerWeather, feelOf, fits, COORDS };
