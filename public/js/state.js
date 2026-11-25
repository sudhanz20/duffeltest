// App-wide state, kept in memory and mirrored to storage so a refresh does not lose it.
import { store, ymd, addDays, today } from './util.js';

function session(key, fallback) {
  try {
    const v = sessionStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function saveSession(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* too large or blocked: keep it in memory only */
  }
}

export function defaultSearch() {
  return {
    trip: 'return',
    from: { code: 'LON', name: 'London', sub: 'All airports', type: 'city' },
    to: { code: 'NYC', name: 'New York', sub: 'All airports', type: 'city' },
    depart: ymd(addDays(today(), 30)),
    ret: ymd(addDays(today(), 37)),
    adults: 1,
    childAges: [],
    infants: 0,
    cabin: 'economy',
    mixed: false,
    cabinOut: 'business',
    cabinBack: 'economy',
    loyalty: [],
    legs: null, // multi-city only: [{ from, to, date }], 2 to MAX_LEGS flights
  };
}

export const MAX_LEGS = 6;

// Every flight in the search, in order, whatever the trip type.
export function legsOf(s) {
  if (s.trip === 'multi') return (s.legs || []).map((l) => ({ from: l.from, to: l.to, date: l.date }));
  const out = [{ from: s.from, to: s.to, date: s.depart }];
  if (s.trip === 'return') out.push({ from: s.to, to: s.from, date: s.ret });
  return out;
}

// Multi-city keeps from, to and depart in step with its flights,
// so pages that show one route (images, recent searches) keep working.
export function syncMulti(s) {
  if (s.trip !== 'multi' || !s.legs || !s.legs.length) return;
  s.from = s.legs[0].from;
  s.to = s.legs[s.legs.length - 1].to;
  s.depart = s.legs[0].date;
  s.mixed = false;
}

// Start multi-city from the current search: the outbound, then a second flight onward or home.
export function startMulti(s) {
  if (s.legs && s.legs.length >= 2) return;
  const first = { from: s.from, to: s.to, date: s.depart };
  const back = s.ret && s.ret > s.depart ? s.ret : s.depart ? ymd(addDays(new Date(s.depart), 7)) : null;
  s.legs = [first, { from: s.to, to: null, date: back }];
}

const saved = store.get('nomad.search', null);
export const state = {
  search: saved && saved.depart >= ymd(today()) ? { ...defaultSearch(), ...saved } : defaultSearch(),
  results: session('nomad.results', null), // { key, data }
  offer: session('nomad.offer', null),
  travellers: session('nomad.travellers', null),
  confirmation: session('nomad.confirmation', null),
};

export function persist(key) {
  if (key === 'search') store.set('nomad.search', state.search);
  if (key === 'results') saveSession('nomad.results', state.results);
  if (key === 'offer') saveSession('nomad.offer', state.offer);
  if (key === 'travellers') saveSession('nomad.travellers', state.travellers);
  if (key === 'confirmation') saveSession('nomad.confirmation', state.confirmation);
}

export const searchKey = (s) =>
  JSON.stringify([
    s.trip,
    legsOf(s).map((l) => [l.from && l.from.code, l.to && l.to.code, l.date]),
    s.adults,
    s.childAges,
    s.infants,
    s.mixed && s.trip === 'return' ? [s.cabinOut, s.cabinBack] : s.cabin,
    s.loyalty,
  ]);

export const go = (hash) => {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
};

// ---------- Recent searches ----------
export function recentSearches() {
  return store.get('nomad.recent', []).filter((r) => r.depart >= ymd(today()));
}
export function addRecent(s) {
  const key = searchKey(s);
  const list = store.get('nomad.recent', []).filter((r) => searchKey(r) !== key);
  list.unshift({ ...s, at: Date.now() });
  store.set('nomad.recent', list.slice(0, 6));
}
export function clearRecent() {
  store.set('nomad.recent', []);
}

export const paxCount = (s) => s.adults + s.childAges.length + s.infants;
