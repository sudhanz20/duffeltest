// Weather on the trip: live forecast for close dates, typical weather for later ones.
// Data from Open-Meteo through /api/weather. Temperatures arrive in °C; the traveller picks °C or °F.
import { api, esc, store, fmtDay, ymd, addDays, parseYmd } from './util.js';

// ---------- °C or °F ----------
const guessUnit = () => (/^en-(US|LR|MM)|^en-BS|^en-KY|^en-PW/.test(navigator.language || '') ? 'F' : 'C');
export const unit = () => store.get('nomad.unit', guessUnit());
export function setUnit(u) {
  store.set('nomad.unit', u === 'F' ? 'F' : 'C');
  window.dispatchEvent(new Event('nomad:unit'));
}
const deg = (c) => Math.round(unit() === 'F' ? (c * 9) / 5 + 32 : c);
export const temp = (c) => `${deg(c)}°${unit()}`;
export const hiLo = (w) => `${deg(w.highC)}° / ${deg(w.lowC)}°${unit()}`;

export function unitToggle() {
  const u = unit();
  return `<span class="unit-toggle" role="group" aria-label="Temperature unit"><button type="button" data-unit="C" class="${u === 'C' ? 'on' : ''}" aria-pressed="${u === 'C'}">°C</button><button type="button" data-unit="F" class="${u === 'F' ? 'on' : ''}" aria-pressed="${u === 'F'}">°F</button></span>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-unit]');
  if (b) setUnit(b.dataset.unit);
});

// Repaint on a unit change for as long as the element is on the page.
export function onUnit(el, paint) {
  const fn = () => (el.isConnected ? paint() : window.removeEventListener('nomad:unit', fn));
  window.addEventListener('nomad:unit', fn);
}

// ---------- How it feels (by the average daytime high, in °C) ----------
export const CLIMATES = {
  any: { label: 'Any weather' },
  warm: { label: 'Warm', hint: 'Highs of 22°C (72°F) or more' },
  mild: { label: 'Mild', hint: 'Highs of 15 to 22°C (59 to 72°F)' },
  cool: { label: 'Cool', hint: 'Highs under 15°C (59°F)' },
};
export function feelOf(highC) {
  if (highC == null) return null;
  if (highC >= 28) return 'hot';
  if (highC >= 22) return 'warm';
  if (highC >= 15) return 'mild';
  if (highC >= 8) return 'cool';
  return 'cold';
}
export function fits(climate, highC) {
  const f = feelOf(highC);
  if (!climate || climate === 'any' || !f) return true;
  if (climate === 'warm') return f === 'warm' || f === 'hot';
  if (climate === 'cool') return f === 'cool' || f === 'cold';
  return f === 'mild';
}

// ---------- Fetch ----------
const memo = new Map();
// Resolves to a Map of code -> weather (places with no data are left out).
export function getWeather(codes, from, to) {
  const list = [...new Set(codes.filter(Boolean))];
  if (!list.length || !from) return Promise.resolve(new Map());
  const key = `${list.join(',')}|${from}|${to || from}`;
  if (!memo.has(key)) {
    const p = api('GET', `/api/weather?codes=${list.join(',')}&from=${from}&to=${to || from}`)
      .then((r) => new Map(r.places.filter((w) => !w.error).map((w) => [w.code, w])))
      .catch((e) => {
        memo.delete(key);
        throw e;
      });
    memo.set(key, p);
  }
  return memo.get(key);
}

// ---------- Words and markup ----------
const span = (w) => (w.from === w.to ? fmtDay(w.from, { day: 'numeric', month: 'short' }) : `${fmtDay(w.from, { day: 'numeric', month: 'short' })} – ${fmtDay(w.to, { day: 'numeric', month: 'short' })}`);
export function sourceText(w) {
  if (w.kind === 'forecast') return `Forecast for ${span(w)}, from Open-Meteo.`;
  return `Typical weather: the average of ${span(w)} in each of the last ${w.years || 5} years (since ${w.sinceYear || ''}), from Open-Meteo. Your dates are beyond the 16-day forecast.`;
}
export const kindLabel = (w) => (w.kind === 'forecast' ? 'Forecast' : 'Typical');

export function wxPill(w, name, role) {
  const f = feelOf(w.highC);
  const wet = w.wetDays != null && w.wetDays >= 40 ? ` · rain ${w.wetDays}% of days` : '';
  return `<span class="wx feel-${f}" title="${esc(sourceText(w))}">
    <i class="wx-dot" aria-hidden="true"></i>
    <span>${role ? `<span class="wx-role">${esc(role)}</span> ` : ''}<b>${esc(name)}</b> ${hiLo(w)}<span class="wx-meta"> · ${f}${wet} · ${kindLabel(w)}</span></span>
  </span>`;
}

// The places on a trip, each with the dates the traveller is there.
// Origin on the day they leave; each destination from arrival until the next flight.
export function tripPlaces(s) {
  const legs =
    s.trip === 'multi'
      ? (s.legs || []).filter((l) => l.from && l.to && l.date)
      : [{ from: s.from, to: s.to, date: s.depart }, ...(s.trip === 'return' && s.ret ? [{ from: s.to, to: s.from, date: s.ret }] : [])];
  if (!legs.length || !legs[0].from) return [];
  const out = [{ code: legs[0].from.code, name: legs[0].from.name, from: legs[0].date, to: legs[0].date, role: 'Leaving' }];
  const home = legs[0].from.code;
  const firstWeek = (d) => ymd(addDays(parseYmd(d), 6));
  if (s.trip !== 'multi') {
    if (legs[0].to) out.push({ code: legs[0].to.code, name: legs[0].to.name, from: legs[0].date, to: s.trip === 'return' && s.ret ? s.ret : firstWeek(legs[0].date), role: 'At' });
    return out;
  }
  legs.forEach((l, i) => {
    if (l.to.code === home && i === legs.length - 1) return;
    const next = legs[i + 1];
    out.push({ code: l.to.code, name: l.to.name, from: l.date, to: next ? next.date : firstWeek(l.date), role: 'At' });
  });
  return out;
}

// Fill el with weather for the trip. Groups places that share dates into one request.
export function mountTripWeather(el, s, { compact } = {}) {
  const places = tripPlaces(s).filter((p) => p.code && p.from);
  if (!places.length) {
    el.innerHTML = '';
    return;
  }
  const groups = new Map();
  for (const p of places) {
    const k = `${p.from}|${p.to}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  let got = null;
  const paint = () => {
    if (!got) return;
    const rows = places.map((p) => ({ p, w: got.get(`${p.from}|${p.to}`)?.get(p.code) })).filter((r) => r.w);
    if (!rows.length) {
      el.innerHTML = '';
      return;
    }
    const kinds = new Set(rows.map((r) => r.w.kind));
    const note = kinds.has('typical') ? (kinds.has('forecast') ? 'Forecast where your dates are close, typical weather for later dates.' : 'Typical weather for your dates. The forecast covers 16 days.') : 'Live forecast for your dates.';
    el.innerHTML = `<div class="wx-row ${compact ? 'compact' : ''}">${rows.map((r) => wxPill(r.w, r.p.name, r.p.role)).join('')}${unitToggle()}</div>
      <div class="wx-note">${note} Data: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</div>`;
  };
  el.innerHTML = '<div class="wx-row wx-loading"><span class="wx">Checking the weather…</span></div>';
  Promise.all([...groups].map(([k, ps]) => getWeather(ps.map((p) => p.code), ps[0].from, ps[0].to).then((m) => [k, m]).catch(() => [k, new Map()]))).then((pairs) => {
    got = new Map(pairs);
    paint();
  });
  onUnit(el, paint);
}
