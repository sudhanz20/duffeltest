// Results page: search, filter and sort offers.
import { $, $$, esc, api, toast, fmtDay, hhmm, dayDiff, dur, money, ICON, CABIN_LABEL, cityImg } from './util.js';
import { state, persist, go, searchKey, paxCount } from './state.js';
import { paxLabel, datesLabel } from './search.js';

const SORTS = {
  recommended: { label: 'Recommended', hint: 'Best balance', fn: (a, b) => a.recommendScore - b.recommendScore },
  comfort: { label: 'Comfort', hint: 'Best cabin, then price', fn: (a, b) => b.comfort - a.comfort || a.total - b.total },
  price: { label: 'Cheapest', hint: 'Lowest price', fn: (a, b) => a.total - b.total },
  fastest: { label: 'Fastest', hint: 'Shortest time', fn: (a, b) => a.minutes - b.minutes || a.total - b.total },
  greenest: { label: 'Greenest', hint: 'Lowest CO₂', fn: (a, b) => (a.emissionsKg ?? 1e9) - (b.emissionsKg ?? 1e9) || a.total - b.total },
};

// Filters backed by Duffel offer data. "Main flight" = the longest flight each way.
export const FEATURES = {
  cabinBag: 'Cabin bag included',
  wifi: 'Wi‑Fi on main flights',
  wifiFree: 'Free Wi‑Fi on main flights',
  power: 'Power sockets',
  flatBed: 'Flat bed',
  suite: 'Private suite',
  legroom: 'Extra legroom',
  priorityBoarding: 'Priority boarding',
  priorityCheckIn: 'Priority check-in',
  seatSelection: 'Seat selection included',
};
const FEATURE_GROUPS = [
  ['Bags and fare', ['cabinBag', 'seatSelection', 'priorityBoarding', 'priorityCheckIn']],
  ['On board', ['wifi', 'wifiFree', 'power', 'legroom', 'flatBed', 'suite']],
];
const hourOf = (iso) => (iso ? Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60 : 0);
const hh = (h) => (h >= 24 ? '23:59' : `${String(Math.floor(h)).padStart(2, '0')}:00`);

function legsFor(s) {
  const out = { origin: s.from.code, destination: s.to.code, date: s.depart, cabin: s.mixed && s.trip === 'return' ? s.cabinOut : s.cabin };
  if (s.trip !== 'return') return [out];
  return [out, { origin: s.to.code, destination: s.from.code, date: s.ret, cabin: s.mixed ? s.cabinBack : s.cabin }];
}

export function logoHtml(owner, size = 32) {
  const one = (src, code) =>
    src
      ? `<img class="logo" style="width:${size}px;height:${size}px" src="${esc(src)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;logo-ph&quot;>${esc(code || '')}</span>'" />`
      : `<span class="logo-ph">${esc((code || '').slice(0, 2))}</span>`;
  if (owner.logo2) return `<span style="display:flex">${one(owner.logo, owner.code.split('+')[0])}${one(owner.logo2, owner.code.split('+')[1])}</span>`;
  return one(owner.logo, owner.code);
}

export function cabinTags(cabins) {
  return cabins.map((c) => `<span class="tag cabin-${c}">${CABIN_LABEL[c] || c}</span>`).join('');
}

function legRow(sl, owner, showCarrier) {
  const plus = dayDiff(sl.departingAt, sl.arrivingAt);
  const stopsText = sl.stops === 0 ? '<span class="direct">Direct</span>' : `${sl.stops} stop${sl.stops > 1 ? 's' : ''} · ${sl.segments.slice(0, -1).map((g) => g.to).join(', ')}`;
  const dots = sl.segments.slice(0, -1).map((_, i, arr) => `<i style="left:${((i + 1) / (arr.length + 1)) * 100}%"></i>`).join('');
  const carrier = sl.segments[0].carrier;
  return `<div class="leg">
    <div class="carrier">${showCarrier ? logoHtml(owner) : ''}<div class="nm">${esc(carrier)}<div class="tiny">${esc(fmtDay(sl.departingAt))}</div></div></div>
    <div>
      <div class="times">
        <div><div class="t">${hhmm(sl.departingAt)}</div><div class="code">${esc(sl.origin)}</div></div>
        <div class="path"><div>${dur(sl.minutes)}</div><div class="line">${dots}</div><div>${stopsText}</div></div>
        <div style="text-align:right"><div class="t">${hhmm(sl.arrivingAt)}${plus > 0 ? `<sup>+${plus}</sup>` : ''}</div><div class="code">${esc(sl.destination)}</div></div>
      </div>
      <div class="leg-tags">${cabinTags(sl.cabins)}${sl.fareBrand ? `<span class="tiny muted" style="align-self:center">${esc(sl.fareBrand)} fare</span>` : ''}</div>
    </div>
  </div>`;
}

function bagText(baggages) {
  const checked = baggages.filter((b) => b.type === 'checked').reduce((t, b) => t + b.quantity, 0);
  const carry = baggages.filter((b) => b.type === 'carry_on').reduce((t, b) => t + b.quantity, 0);
  return `${checked ? `${checked} checked` : 'No checked bag'} · ${carry ? `${carry} cabin` : 'No cabin bag'}`;
}

function detailsHtml(o) {
  return o.slices
    .map((sl, si) => {
      let html = `<h4 class="serif" style="font-weight:400;margin:${si ? '18px' : '0'} 0 6px">${si === 0 ? 'Outbound' : 'Return'} · ${esc(sl.originCity)} → ${esc(sl.destinationCity)}</h4>`;
      sl.segments.forEach((g, i) => {
        if (i > 0) {
          const prev = sl.segments[i - 1];
          const lay = Math.round((new Date(g.departingAt) - new Date(prev.arrivingAt)) / 60000);
          html += `<div class="layover">Change planes in ${esc(prev.toName || prev.to)} · ${dur(lay)}</div>`;
        }
        const a = g.amenities || {};
        const amen = [];
        if (a.wifi && a.wifi.available) amen.push(`${ICON.wifi} Wi‑Fi${a.wifi.cost === 'free' ? ' (free)' : ''}`);
        if (a.power && a.power.available) amen.push(`${ICON.power} Power`);
        if (a.seat && a.seat.pitch && a.seat.pitch !== 'n/a') amen.push(`${ICON.seat} ${esc(a.seat.pitch)}″ pitch`);
        amen.push(`${ICON.bag} ${bagText(g.baggages)}`);
        html += `<div class="seg"><div><div class="when">${hhmm(g.departingAt)} – ${hhmm(g.arrivingAt)}</div><div class="tiny muted">${dur(g.minutes)}</div></div>
          <div><b>${esc(g.from)}</b> ${esc(g.fromName)} → <b>${esc(g.to)}</b> ${esc(g.toName)}
          <div class="small muted">${esc(g.carrier)} ${esc(g.flight)}${g.operatedBy ? ` · operated by ${esc(g.operatedBy)}` : ''}${g.aircraft ? ` · ${esc(g.aircraft)}` : ''} · ${esc(g.cabinName || CABIN_LABEL[g.cabin])}</div>
          <div class="amen">${amen.map((x) => `<span>${x}</span>`).join('')}</div></div></div>`;
      });
      return html;
    })
    .join('');
}

function co2Diff(kg, median) {
  const pct = Math.round(((kg - median) / median) * 100);
  return pct === 0 ? 'typical' : pct < 0 ? `${-pct}% less than typical` : `${pct}% more than typical`;
}

function offerCard(o, i, sortKey, n, eco) {
  const per = o.total / n;
  const badges = [];
  const green = eco && o.emissionsKg != null && o.emissionsKg <= eco.min * 1.1;
  if (i === 0) badges.push(`<span class="tag good">${sortKey === 'comfort' ? 'Most comfortable' : sortKey === 'price' ? 'Cheapest' : sortKey === 'fastest' ? 'Fastest' : sortKey === 'greenest' ? 'Greenest' : 'Our pick'}</span>`);
  if (green) badges.push(`<span class="tag leaf">${ICON.leaf} Lowest CO₂</span>`);
  if (o.separateTickets) badges.push('<span class="tag">2 tickets</span>');
  return `<article class="offer" data-id="${esc(o.id)}">
    <div class="offer-main">
      <div class="offer-legs">${o.slices.map((sl, k) => legRow(sl, o.owner, k === 0 || o.separateTickets)).join('')}</div>
      <div class="offer-side">
        <div class="offer-badges">${badges.join('')}</div>
        <div><div class="price">${money(o.total, o.currency)}</div><div class="tiny muted">${n > 1 ? `${money(per, o.currency)} per traveller · ` : ''}total</div></div>
        <button type="button" class="btn btn-primary" data-select="${esc(o.id)}">Select</button>
      </div>
    </div>
    <div class="offer-foot">
      <span>${esc(o.owner.name)}</span>
      ${o.refundable ? '<span class="tag good">Refundable</span>' : '<span class="tag">Non-refundable</span>'}
      ${o.changeable ? '<span class="tag good">Changeable</span>' : ''}
      ${o.emissionsKg ? `<span class="co2 ${green ? 'green' : ''}">${ICON.leaf} ${o.emissionsKg.toLocaleString()} kg CO₂${eco && eco.median ? ` · ${co2Diff(o.emissionsKg, eco.median)}` : ''}</span>` : ''}
      ${o.features && o.features.checkedBags ? `<span>${ICON.bag} ${o.features.checkedBags} checked bag${o.features.checkedBags > 1 ? 's' : ''}</span>` : ''}
      ${o.features && o.features.wifi ? `<span>${ICON.wifi} ${o.features.wifiFree ? 'Free Wi‑Fi' : 'Wi‑Fi'}</span>` : ''}
      ${o.features && o.features.flatBed ? `<span>${ICON.seat} Flat bed</span>` : ''}
      <button type="button" class="btn-link" data-details style="margin-left:auto">Flight details</button>
    </div>
    <div class="details hidden"></div>
  </article>`;
}

export function renderResults(view) {
  const s = state.search;
  if (!s || !s.from || !s.to) return go('#/');
  const key = searchKey(s);
  const d = datesLabel(s);
  const p = paxLabel(s);
  const n = paxCount(s);
  const legs = legsFor(s);

  view.innerHTML = `
    <section class="band"><img src="${cityImg(s.to.code, 1800)}" alt="" />
      <div class="wrap">
        <p class="eyebrow" style="margin:0 0 6px">${s.trip === 'return' ? 'Return trip' : 'One way'}</p>
        <h1>${esc(s.from.name)} → ${esc(s.to.name)}</h1>
        <div class="meta"><span>${esc(d.main)}</span><span class="dot">•</span><span>${esc(p.main)}</span><span class="dot">•</span><span>${esc(p.sub)}</span></div>
        <a href="#/" class="btn btn-ghost btn-sm edit">Edit search</a>
      </div>
    </section>
    <div class="wrap results-layout">
      <aside class="filters" id="filters"></aside>
      <div>
        <div class="sorts" id="sorts"></div>
        <div id="note"></div>
        <div class="count-line"><span id="count"></span><span id="expiry"></span></div>
        <div id="list"><div class="loading"><div class="plane-loader"><div class="track"></div>${ICON.plane}</div>Searching airlines for the best flights…</div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      </div>
    </div>`;

  // Reuse results for 20 minutes. After that Duffel offers start to expire.
  const fresh = state.results && state.results.key === key && Date.now() - (state.results.at || 0) < 20 * 60e3;
  let data = fresh ? state.results.data : null;
  let sortKey = 'recommended';
  let shown = 15;
  const f = { stops: new Set(), airlines: new Set(), refundable: false, changeable: false, maxPrice: null, times: legs.map(() => ({ dep: [0, 24], arr: [0, 24] })), maxHours: null, checked: 0, feats: new Set(), loyalty: new Set() };
  let eco = null;
  const longest = (o) => Math.max(...o.slices.map((sl) => sl.minutes));

  function filtered() {
    return data.offers.filter((o) => {
      if (f.stops.size) {
        const worst = Math.max(...o.slices.map((sl) => sl.stops));
        const k = worst >= 2 ? '2' : String(worst);
        if (!f.stops.has(k)) return false;
      }
      if (f.airlines.size && !f.airlines.has(o.owner.code)) return false;
      if (f.refundable && !o.refundable) return false;
      if (f.changeable && !o.changeable) return false;
      if (f.maxPrice != null && o.total > f.maxPrice) return false;
      for (let k = 0; k < f.times.length; k++) {
        const sl = o.slices[k];
        if (!sl) continue;
        const [d0, d1] = f.times[k].dep;
        const [a0, a1] = f.times[k].arr;
        const dh = hourOf(sl.departingAt);
        const ah = hourOf(sl.arrivingAt);
        if (dh < d0 || dh > d1 || ah < a0 || ah > a1) return false;
      }
      if (f.maxHours != null && longest(o) > f.maxHours * 60) return false;
      const ft = o.features || {};
      if (f.checked && (ft.checkedBags || 0) < f.checked) return false;
      for (const k of f.feats) if (!ft[k]) return false;
      if (f.loyalty.size && !(ft.loyalty || []).some((c) => f.loyalty.has(c))) return false;
      return true;
    });
  }

  function paintFilters() {
    const airlines = new Map();
    for (const o of data.offers) {
      const cur = airlines.get(o.owner.code);
      if (!cur || o.total < cur.min) airlines.set(o.owner.code, { owner: o.owner, min: o.total });
    }
    const stopMin = (k) => {
      const list = data.offers.filter((o) => {
        const w = Math.max(...o.slices.map((sl) => sl.stops));
        return (w >= 2 ? '2' : String(w)) === k;
      });
      return list.length ? Math.min(...list.map((o) => o.total)) : null;
    };
    const prices = data.offers.map((o) => o.total);
    const lo = Math.floor(Math.min(...prices));
    const hi = Math.ceil(Math.max(...prices));
    const cur = data.offers[0] ? data.offers[0].currency : 'GBP';
    const count = (fn) => data.offers.filter(fn).length;
    const hours = data.offers.map((o) => longest(o) / 60);
    const hLo = Math.floor(Math.min(...hours));
    const hHi = Math.ceil(Math.max(...hours));
    const names = new Map(data.offers.map((o) => [o.owner.code, o.owner.name]));
    const progCount = new Map();
    for (const o of data.offers) for (const c of (o.features && o.features.loyalty) || []) progCount.set(c, (progCount.get(c) || 0) + 1);
    const programmes = [...progCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    const dual = (id, label, [lo2, hi2]) => `<div class="dual-wrap"><div class="dual-head"><span>${label}</span><span class="small muted" id="${id}-label">${hh(lo2)} – ${hh(hi2)}</span></div>
      <div class="dual" data-dual="${id}"><div class="dual-fill" style="left:${(lo2 / 24) * 100}%;right:${100 - (hi2 / 24) * 100}%"></div>
      <input type="range" min="0" max="24" step="1" value="${lo2}" data-end="0" aria-label="${label} after" /><input type="range" min="0" max="24" step="1" value="${hi2}" data-end="1" aria-label="${label} before" /></div></div>`;
    $('#filters', view).innerHTML = `
      <section><h4>Stops</h4>
        ${[['0', 'Direct'], ['1', '1 stop'], ['2', '2+ stops']].map(([k, label]) => {
          const m = stopMin(k);
          return `<label class="check"><input type="checkbox" data-stop="${k}" ${f.stops.has(k) ? 'checked' : ''} ${m == null ? 'disabled' : ''} /><span class="grow">${label}</span><span class="small muted">${m == null ? '—' : money(m, cur)}</span></label>`;
        }).join('')}
      </section>
      <section><h4>Max price</h4>
        <input type="range" class="range" id="maxp" min="${lo}" max="${hi}" step="1" value="${f.maxPrice ?? hi}" />
        <div class="small muted" id="maxp-label">Up to ${money(f.maxPrice ?? hi, cur)}</div>
      </section>
      ${legs.map((l, k) => `<section><h4>${legs.length > 1 ? (k ? 'Return times' : 'Outbound times') : 'Times'}</h4>
        ${dual(`t${k}d`, 'Departs', f.times[k].dep)}${dual(`t${k}a`, 'Arrives', f.times[k].arr)}
      </section>`).join('')}
      <section><h4>Journey time</h4>
        <input type="range" class="range" id="maxh" min="${hLo}" max="${hHi}" step="1" value="${f.maxHours ?? hHi}" />
        <div class="small muted" id="maxh-label">Up to ${f.maxHours ?? hHi} hours each way</div>
      </section>
      <section><h4>Checked bags</h4>
        <div class="seg-btns">${[0, 1, 2].map((n) => `<button type="button" data-bags="${n}" class="${f.checked === n ? 'on' : ''}" ${n && !count((o) => (o.features?.checkedBags || 0) >= n) ? 'disabled' : ''}>${n ? `${n}+ included` : 'Any'}</button>`).join('')}</div>
      </section>
      <section><h4>Fare rules</h4>
        <label class="check"><input type="checkbox" id="refund" ${f.refundable ? 'checked' : ''} ${count((o) => o.refundable) ? '' : 'disabled'} /><span class="grow">Refundable</span><span class="small muted">${count((o) => o.refundable)}</span></label>
        <label class="check"><input type="checkbox" id="changeable" ${f.changeable ? 'checked' : ''} ${count((o) => o.changeable) ? '' : 'disabled'} /><span class="grow">Changeable</span><span class="small muted">${count((o) => o.changeable)}</span></label>
      </section>
      ${FEATURE_GROUPS.map(([title, keys]) => `<section><h4>${title}</h4>${keys.map((k) => {
        const c = count((o) => o.features && o.features[k]);
        return `<label class="check"><input type="checkbox" data-feat="${k}" ${f.feats.has(k) ? 'checked' : ''} ${c ? '' : 'disabled'} /><span class="grow">${FEATURES[k]}</span><span class="small muted">${c}</span></label>`;
      }).join('')}</section>`).join('')}
      ${programmes.length ? `<section><h4>Earn miles with</h4>${programmes.map(([code, c]) => `
        <label class="check"><input type="checkbox" data-loy="${esc(code)}" ${f.loyalty.has(code) ? 'checked' : ''} /><span class="grow">${esc(names.get(code) || code)}</span><span class="small muted">${c}</span></label>`).join('')}
        <div class="tiny muted">Flights where this airline's frequent flyer programme can be added.</div></section>` : ''}
      <section><h4>Airlines</h4>
        ${[...airlines.values()].sort((a, b) => a.min - b.min).slice(0, 20).map(({ owner, min }) => `
          <label class="check"><input type="checkbox" data-air="${esc(owner.code)}" ${f.airlines.has(owner.code) ? 'checked' : ''} />${logoHtml(owner, 20)}<span class="grow" title="${esc(owner.name)}">${esc(owner.name)}</span><span class="small muted">${money(min, cur)}</span></label>`).join('')}
      </section>`;
  }

  function paintList() {
    const list = filtered();
    const sorted = {};
    for (const k of Object.keys(SORTS)) sorted[k] = [...list].sort(SORTS[k].fn);
    $('#sorts', view).innerHTML = Object.entries(SORTS)
      .map(([k, v]) => {
        const top = sorted[k][0];
        return `<button type="button" class="sort ${k === sortKey ? 'on' : ''}" data-sort="${k}"><b>${v.label}</b><span>${top ? `${money(top.total, top.currency)} · ${dur(top.minutes)}` : '—'}</span><small>${v.hint}</small></button>`;
      })
      .join('');
    $('#count', view).textContent = `${list.length} of ${data.offers.length} flights shown`;
    const rows = sorted[sortKey];
    const em = data.offers.map((o) => o.emissionsKg).filter((x) => x != null).sort((a, b) => a - b);
    eco = em.length ? { min: em[0], median: em[Math.floor(em.length / 2)] } : null;
    $('#list', view).innerHTML = rows.length
      ? rows.slice(0, shown).map((o, i) => offerCard(o, i, sortKey, n, eco)).join('') +
        (rows.length > shown ? `<div class="more"><button type="button" class="btn btn-ghost" id="more">Show ${Math.min(15, rows.length - shown)} more</button></div>` : '')
      : `<div class="empty"><h3>No flights match these filters</h3><p>Try removing a filter.</p></div>`;
  }

  function paintAll() {
    if (data.note) $('#note', view).innerHTML = `<div class="notice">${esc(data.note)}</div>`;
    if (!data.offers.length) {
      $('#filters', view).classList.add('hidden');
      $('#list', view).innerHTML = `<div class="empty"><h3>No flights found</h3><p>Try other dates, a nearby airport or another cabin.</p><a class="btn btn-primary" href="#/">Change search</a></div>`;
      return;
    }
    applyPrefs();
    paintFilters();
    paintList();
  }

  // Preferences from Ask Nomad ("cheapest", "nonstop", "under £800") become the starting sort and filters.
  // Each one is skipped, with a note, if no flight could match it.
  let prefsDone = false;
  function applyPrefs() {
    const p = s.prefs;
    if (prefsDone || !p) return;
    prefsDone = true;
    if (SORTS[p.sort]) sortKey = p.sort;
    // Apply each preference in turn. Skip any that would leave no flights, and say so.
    const skipped = [];
    const step = (label, apply, undo) => {
      apply();
      if (!filtered().length) {
        undo();
        skipped.push(label);
      }
    };
    const cur = data.offers[0].currency;
    if (p.directOnly) step('direct only', () => f.stops.add('0'), () => f.stops.delete('0'));
    for (const t of p.times || []) {
      const k = t.direction === 'return' ? 1 : 0;
      const key = t.which === 'arrive' ? 'arr' : 'dep';
      if (!f.times[k]) continue;
      const prev = f.times[k][key];
      step(`${k ? 'return' : 'outbound'} ${key === 'dep' ? 'leaving' : 'landing'} ${hh(t.after)}–${hh(t.before)}`, () => (f.times[k][key] = [t.after, t.before]), () => (f.times[k][key] = prev));
    }
    if (p.checkedBags) step(`${p.checkedBags}+ checked bags`, () => (f.checked = Math.min(2, p.checkedBags)), () => (f.checked = 0));
    const loy = (p.loyalty || []).map((c) => c.toUpperCase());
    if (loy.length) step(`earning with ${loy.join(', ')}`, () => loy.forEach((c) => f.loyalty.add(c)), () => f.loyalty.clear());
    for (const k of p.features || []) if (FEATURES[k]) step(FEATURES[k].toLowerCase(), () => f.feats.add(k), () => f.feats.delete(k));
    if (p.refundable) step('refundable', () => (f.refundable = true), () => (f.refundable = false));
    if (p.changeable) step('changeable', () => (f.changeable = true), () => (f.changeable = false));
    if (p.maxHours) step(`under ${p.maxHours} hours`, () => (f.maxHours = Math.ceil(p.maxHours)), () => (f.maxHours = null));
    if (p.maxPrice) {
      if (p.currency && p.currency.toUpperCase() !== cur) skipped.push(`a budget in ${p.currency.toUpperCase()} (prices are in ${cur})`);
      else step(`under ${money(p.maxPrice, cur)}`, () => (f.maxPrice = Math.ceil(p.maxPrice)), () => (f.maxPrice = null));
    }
    if (skipped.length) $('#note', view).insertAdjacentHTML('beforeend', `<div class="notice">No flight matched everything you asked Nomad for, so these were left off: ${esc(skipped.join(', '))}. You can turn them on in the filters.</div>`);
  }

  // ---------- Events ----------
  view.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.stop) t.checked ? f.stops.add(t.dataset.stop) : f.stops.delete(t.dataset.stop);
    else if (t.dataset.air) t.checked ? f.airlines.add(t.dataset.air) : f.airlines.delete(t.dataset.air);
    else if (t.id === 'refund') f.refundable = t.checked;
    else if (t.id === 'changeable') f.changeable = t.checked;
    else if (t.dataset.feat) t.checked ? f.feats.add(t.dataset.feat) : f.feats.delete(t.dataset.feat);
    else if (t.dataset.loy) t.checked ? f.loyalty.add(t.dataset.loy) : f.loyalty.delete(t.dataset.loy);
    else return;
    shown = 15;
    paintList();
  });
  view.addEventListener('input', (e) => {
    const dualBox = e.target.closest('[data-dual]');
    if (dualBox) {
      const id = dualBox.dataset.dual;
      const [a, b] = $$('input', dualBox).map((x) => Number(x.value));
      if (a > b) e.target.value = e.target.dataset.end === '0' ? b : a; // handles cannot cross
      const lo2 = Math.min(a, b);
      const hi2 = Math.max(a, b);
      f.times[Number(id[1])][id[2] === 'd' ? 'dep' : 'arr'] = [lo2, hi2];
      $('.dual-fill', dualBox).style.cssText = `left:${(lo2 / 24) * 100}%;right:${100 - (hi2 / 24) * 100}%`;
      $(`#${id}-label`, view).textContent = `${hh(lo2)} – ${hh(hi2)}`;
      shown = 15;
      return paintList();
    }
    if (e.target.id === 'maxh') {
      f.maxHours = Number(e.target.value);
      $('#maxh-label', view).textContent = `Up to ${f.maxHours} hours each way`;
      shown = 15;
      return paintList();
    }
    if (e.target.id !== 'maxp') return;
    f.maxPrice = Number(e.target.value);
    const cur = data.offers[0].currency;
    $('#maxp-label', view).textContent = `Up to ${money(f.maxPrice, cur)}`;
    shown = 15;
    paintList();
  });
  view.addEventListener('click', (e) => {
    const bags = e.target.closest('[data-bags]');
    if (bags) {
      f.checked = Number(bags.dataset.bags);
      $$('[data-bags]', view).forEach((b) => b.classList.toggle('on', b === bags));
      shown = 15;
      return paintList();
    }
    const so = e.target.closest('[data-sort]');
    if (so) {
      sortKey = so.dataset.sort;
      shown = 15;
      return paintList();
    }
    if (e.target.id === 'more') {
      shown += 15;
      return paintList();
    }
    const det = e.target.closest('[data-details]');
    if (det) {
      const card = det.closest('.offer');
      const box = $('.details', card);
      if (box.classList.contains('hidden')) {
        const o = data.offers.find((x) => x.id === card.dataset.id);
        box.innerHTML = detailsHtml(o);
      }
      box.classList.toggle('hidden');
      det.textContent = box.classList.contains('hidden') ? 'Flight details' : 'Hide details';
      return;
    }
    const sel = e.target.closest('[data-select]');
    if (sel) {
      const o = data.offers.find((x) => x.id === sel.dataset.select);
      state.offer = { ...o, search: { childAges: s.childAges, loyalty: s.loyalty, to: s.to, from: s.from } };
      state.travellers = null;
      persist('offer');
      persist('travellers');
      go('#/checkout');
    }
  });

  if (data) {
    paintAll();
    return;
  }
  let alive = true;
  api('POST', '/api/search', {
    legs,
    passengers: { adults: s.adults, childAges: s.childAges, infants: s.infants, loyalty: s.loyalty },
  })
    .then((r) => {
      if (!alive) return;
      data = r;
      state.results = { key, data: r, at: Date.now() };
      persist('results');
      paintAll();
    })
    .catch((e) => {
      if (!alive) return;
      $('#list', view).innerHTML = `<div class="empty"><h3>We couldn’t search right now</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/">Back to search</a></div>`;
      $('#filters', view).classList.add('hidden');
      toast(e.message, 'err');
    });
  return () => {
    alive = false;
  };
}
