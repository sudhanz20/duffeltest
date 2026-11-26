// Shared helpers for Nomad.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export function toast(msg, kind) {
  let box = $('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind || ''}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 4000);
}

// localStorage that never throws (private windows, blocked storage).
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

// ---------- Dates ----------
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
export const fmtDay = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  s ? parseYmd(s.slice(0, 10)).toLocaleDateString('en-GB', opts) : '';
// Duffel gives local airport times without a zone, e.g. "2027-01-15T08:30:00".
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : '');
export const dayDiff = (a, b) => Math.round((parseYmd(b.slice(0, 10)) - parseYmd(a.slice(0, 10))) / 864e5);
export const dur = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
};
export const ageOn = (bornOn, onDate) => {
  const b = parseYmd(bornOn);
  const d = parseYmd(onDate.slice(0, 10));
  let age = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age--;
  return age;
};

// ---------- Money ----------
export const money = (amount, currency, digits = 0) => {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${Number(amount).toFixed(digits)} ${currency}`;
  }
};

// ---------- Labels ----------
export const CABIN_LABEL = {
  economy: 'Economy',
  premium_economy: 'Premium',
  business: 'Business',
  first: 'First',
  any: 'Any cabin',
};

// ---------- Imagery (Unsplash) ----------
const U = (id, w = 1200) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;
export const IMG = {
  hero: '1436491865332-7a61a109cc05',
  clouds: '1500835556837-99ac94a94552',
  window: '1488085061387-422e29b40080',
  beach: '1507525428034-b723cf961d3e',
};
const CITY_IMG = {
  LON: '1529655683826-aba9b3e77383',
  PAR: '1499856871958-5b9627545d1a',
  NYC: '1496442226666-8d4d0e62e6e9',
  TYO: '1540959733332-eab4deabeeaf',
  DXB: '1512453979798-5ea266f8880c',
  ROM: '1552832230-c0197dd311b5',
  SIN: '1525625293386-3f8f99389edd',
  SYD: '1506973035872-a4ec16b8e8d9',
  DPS: '1537996194471-e657df975ab4',
  AMS: '1534351590666-13e3e96b5017',
  SFO: '1501594907352-04cda38ebc29',
  MAD: '1539037116277-4db20889f2d4',
  VCE: '1523906834658-6e24ef2386f9',
  RIO: '1483729558449-99ef09a8c325',
  NBO: '1516026672322-bc52d61a55d5',
  HKT: '1520250497591-112f2f40a3f4',
};
// Airport code to city code, for common airports Duffel may return without a city code.
const AIRPORT_CITY = {
  LHR: 'LON', LGW: 'LON', STN: 'LON', LCY: 'LON', LTN: 'LON', SEN: 'LON',
  JFK: 'NYC', EWR: 'NYC', LGA: 'NYC',
  CDG: 'PAR', ORY: 'PAR',
  HND: 'TYO', NRT: 'TYO',
  FCO: 'ROM', CIA: 'ROM',
  GIG: 'RIO', SDU: 'RIO',
  DXB: 'DXB', DWC: 'DXB',
};
export const cityImg = (code, w) => {
  const c = AIRPORT_CITY[code] || code;
  return U(CITY_IMG[c] || IMG.clouds, w);
};
export const img = (key, w) => U(IMG[key] || key, w);

export const DESTINATIONS = [
  { code: 'LON', city: 'London', tag: 'Theatre, rain and tea' },
  { code: 'PAR', city: 'Paris', tag: 'Long lunches' },
  { code: 'NYC', city: 'New York', tag: 'The city that hums' },
  { code: 'TYO', city: 'Tokyo', tag: 'Neon and calm' },
  { code: 'DXB', city: 'Dubai', tag: 'Desert skyline' },
  { code: 'SIN', city: 'Singapore', tag: 'Garden city' },
  { code: 'ROM', city: 'Rome', tag: 'Ancient and alive' },
  { code: 'SYD', city: 'Sydney', tag: 'Harbour light' },
];

// ---------- Icons ----------
export const ICON = {
  plane:
    '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  city: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21h18M5 21V8l6-3v16M13 21V10h6v11M8 10h.01M8 14h.01M16 14h.01M16 17h.01"/></svg>',
  swap: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h13l-3-3M17 17H4l3 3"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 19c8 0 14-6 14-14C11 5 5 10 5 19zM5 19l6-6"/></svg>',
  bag: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V5h6v2"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01"/></svg>',
  power: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  seat: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4v9a3 3 0 0 0 3 3h7M6 20h12M16 16l2 4"/></svg>',
  compass:
    '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14.5" stroke="#d8bd8a" stroke-width="1.5"/><path d="M16 5l3.2 11L16 27l-3.2-11z" fill="#d8bd8a"/><path d="M16 16l3.2 0L16 27z" fill="#b38b4d"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  spark: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/></svg>',
  sofa: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2zM5 18v2M19 18v2"/></svg>',
};

// Logos for stubbed payment methods (simple marks, no brand artwork).
export const PAY_ICON = {
  card: '<svg width="34" height="22" viewBox="0 0 34 22"><rect width="34" height="22" rx="4" fill="#0e1a2b"/><rect x="4" y="6" width="8" height="6" rx="1.5" fill="#d8bd8a"/><rect x="4" y="15" width="16" height="2" rx="1" fill="#6a7282"/></svg>',
  apple: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.6zM14.1 5.6c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z"/></svg>',
  google: '<svg width="22" height="22" viewBox="0 0 24 24"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z"/><path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7C7 7.4 9.3 5.9 12 5.9z"/></svg>',
  paypal: '<svg width="22" height="22" viewBox="0 0 24 24"><path fill="#003087" d="M8.3 21H4.6L7.3 3h6.2c3.4 0 5.3 1.9 4.8 4.9-.6 3.8-3.3 5.3-6.6 5.3H9.9z"/><path fill="#009cde" d="M19.6 8.4c-.6 3.6-3.1 5.5-6.6 5.5h-1.5l-1 6.6H7.6l.3-1.8h1.8l.8-5.2h1.7c3.6 0 6.1-1.6 6.8-5.5.4.1.5.2.6.4z"/></svg>',
  later: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b38b4d" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  balance: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2e6b5c" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>',
};

// ---------- Modal and processing overlay ----------
export function modal({ title, body, actions = [] }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="x" aria-label="Close">×</button></div>
    <div class="modal-body"></div>
    <div class="modal-foot"></div></div>`;
  const bodyEl = ov.querySelector('.modal-body');
  const foot = ov.querySelector('.modal-foot');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  const close = () => ov.remove();
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${a.cls || 'btn-ghost'}`;
    b.textContent = a.label;
    b.addEventListener('click', () => (a.onClick ? a.onClick(close, b) : close()));
    foot.appendChild(b);
  }
  ov.querySelector('.x').addEventListener('click', close);
  ov.addEventListener('mousedown', (e) => {
    if (e.target === ov) close();
  });
  document.body.appendChild(ov);
  return { el: ov, body: bodyEl, foot, close };
}

export function processing(text) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="processing"><div class="spinner"></div><div class="serif" style="font-size:20px">${esc(text)}</div><div class="small muted" style="margin-top:6px">Please don’t close this window.</div></div>`;
  document.body.appendChild(ov);
  return {
    set(t) {
      ov.querySelector('.serif').textContent = t;
    },
    close() {
      ov.remove();
    },
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Places ----------
// The airport name without the city in front or "Airport" at the end:
// "Barcelona–El Prat Josep Tarradellas Airport" in Barcelona becomes "El Prat Josep Tarradellas".
export function shortAirport(name, city) {
  let n = String(name || '').trim();
  if (city) {
    const lead = new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[–—-]\\s*`, 'i');
    n = n.replace(lead, '');
  }
  const short = n.replace(/\s+(International\s+)?Airport$/i, '').trim();
  return short || n;
}

// Every chosen place shows the same way: the city name, then the code and which airport.
// An airport keeps its full name in `airport`.
export function placeOf(it) {
  if (!it || it.type !== 'airport') return it;
  if (it.airport) return it;
  const city = it.city || String(it.sub || '').split(',')[0].trim();
  if (!city) return it;
  return { type: 'airport', code: it.code, name: city, city, airport: it.name, sub: shortAirport(it.name, city) };
}

// Turn /api/places results into rows for the lookup list.
export function placeItems(places) {
  const items = [];
  for (const p of places) {
    if (p.type === 'city') {
      items.push({ type: 'city', code: p.code, name: p.name, sub: `All airports · ${p.country || ''}` });
      for (const a of p.airports) items.push({ type: 'airport', code: a.code, name: a.name, city: p.name, sub: p.name, child: true });
    } else {
      items.push({ type: 'airport', code: p.code, name: p.name, city: p.city, sub: [p.city, p.country].filter(Boolean).join(', ') });
    }
  }
  return items.slice(0, 12);
}
