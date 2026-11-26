// Nomad Lux: search, results and concierge for travellers who put comfort and time first.
// Lux searches Premium economy, Business and First only, and ranks by time and comfort.
// Checkout and My bookings are shared with classic Nomad.
import { $, $$, esc, api, toast, fmtDay, hhmm, dayDiff, dur, money, ICON, cityImg, img, store, ymd, addDays, today } from './util.js';
import { placeItems, placeOf } from './util.js';
import { state, persist, go } from './state.js';
import { createCalendar } from './calendar.js';
import { logoHtml, detailsHtml } from './results.js';
import { mountTripWeather, wxPill, CLIMATES, unitToggle, onUnit } from './weather.js';

// ---------- Mode ----------
export const isLux = () => store.get('nomad.mode', 'classic') === 'lux';
export const setLux = (on) => store.set('nomad.mode', on ? 'lux' : 'classic');

const CABINS = {
  best: { label: 'Best available', sub: 'Premium, Business and First' },
  business: { label: 'Business', sub: 'Business only' },
  first: { label: 'First', sub: 'First only' },
  premium_economy: { label: 'Premium economy', sub: 'Premium economy only' },
};
const CABIN_NAME = { premium_economy: 'Premium economy', business: 'Business', first: 'First' };
const MAX_LEGS = 5;

function defaultLux() {
  return {
    trip: 'return',
    from: { code: 'LON', name: 'London', sub: 'All airports', type: 'city' },
    to: null,
    depart: ymd(addDays(today(), 42)),
    ret: ymd(addDays(today(), 49)),
    legs: [],
    adults: 2,
    childAges: [],
    cabin: 'best',
  };
}
function loadLux() {
  const s = { ...defaultLux(), ...store.get('nomad.lux.search', {}) };
  if (!s.depart || s.depart < ymd(today())) Object.assign(s, { depart: defaultLux().depart, ret: defaultLux().ret });
  s.legs = (s.legs || []).filter((l) => !l.date || l.date >= ymd(today()));
  // Searches saved before places showed as "City · CODE" still show the long airport name.
  s.from = placeOf(s.from);
  s.to = placeOf(s.to);
  for (const l of s.legs) Object.assign(l, { from: placeOf(l.from), to: placeOf(l.to) });
  return s;
}
const lux = loadLux();
const saveLux = () => store.set('nomad.lux.search', lux);

// Flights to search, in order. Multi-city: the first leg is from/to/depart, then the extra legs.
function legsOf(s) {
  if (s.trip === 'multi') {
    return [{ from: s.from, to: s.to, date: s.depart }, ...s.legs];
  }
  const out = [{ from: s.from, to: s.to, date: s.depart }];
  if (s.trip === 'return') out.push({ from: s.to, to: s.from, date: s.ret });
  return out;
}
const keyOf = (s) => JSON.stringify([legsOf(s).map((l) => [l.from && l.from.code, l.to && l.to.code, l.date]), s.adults, s.childAges, s.cabin]);
const paxText = (s) => {
  const n = s.adults + s.childAges.length;
  return `${n} traveller${n === 1 ? '' : 's'}`;
};
function datesText(s) {
  if (s.trip === 'multi') return `${legsOf(s).length} flights from ${fmtDay(s.depart, { day: 'numeric', month: 'short' })}`;
  if (s.trip === 'oneway') return fmtDay(s.depart);
  if (!s.ret) return `${fmtDay(s.depart)} →`;
  const nights = Math.round((new Date(s.ret) - new Date(s.depart)) / 864e5);
  return `${fmtDay(s.depart, { day: 'numeric', month: 'short' })} – ${fmtDay(s.ret, { day: 'numeric', month: 'short' })} · ${nights} night${nights === 1 ? '' : 's'}`;
}

// ---------- Place lookup ----------
function bindPlace(inp, field, onPick, pops) {
  let timer = null;
  let items = [];
  let hl = -1;
  const list = document.createElement('div');
  list.className = 'popover ac-list';
  list.addEventListener('mousedown', (e) => e.preventDefault());
  const paint = () => {
    list.innerHTML = items.length
      ? items.map((it, i) => `<div class="ac-item ${it.child ? 'sub' : ''} ${i === hl ? 'hl' : ''}" data-i="${i}">${it.type === 'city' ? ICON.city : ICON.plane}
          <div style="flex:1;min-width:0"><div class="nm">${esc(it.name)}</div><div class="tiny muted">${esc(it.sub)}</div></div><span class="code">${esc(it.code)}</span></div>`).join('')
      : '<div class="ac-item muted small">No matches</div>';
  };
  const pick = (it) => {
    pops.close();
    onPick(placeOf(it));
    inp.blur();
  };
  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-i]');
    if (row) pick(items[Number(row.dataset.i)]);
  });
  inp.addEventListener('focus', () => inp.select());
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (q.length < 2) return pops.close();
    timer = setTimeout(async () => {
      try {
        const r = await api('GET', `/api/places?q=${encodeURIComponent(q)}`);
        if (inp.value.trim() !== q) return;
        items = placeItems(r.places);
        hl = items.length ? 0 : -1;
        paint();
        if (!pops.isOpen(list)) pops.open(list, field);
      } catch (e) {
        toast(e.message, 'err');
      }
    }, 180);
  });
  inp.addEventListener('keydown', (e) => {
    if (!pops.isOpen(list)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint();
    } else if (e.key === 'Enter' && items[hl]) {
      e.preventDefault();
      pick(items[hl]);
    } else if (e.key === 'Escape') pops.close();
  });
  inp.addEventListener('blur', () => setTimeout(() => {
    if (pops.isOpen(list)) pops.close();
    onPick(null);
  }, 150));
}

function popovers() {
  let cur = null;
  const api2 = {
    open(el, field) {
      api2.close();
      field.classList.add('open');
      (el.classList.contains('cal-sheet') ? document.body : field).appendChild(el);
      cur = { el, field };
    },
    close() {
      if (!cur) return;
      cur.el.remove();
      cur.field.classList.remove('open');
      cur = null;
    },
    isOpen: (el) => Boolean(cur && cur.el === el),
    field: () => cur && cur.field,
  };
  return api2;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
const ESCAPES = [
  { code: 'TYO', city: 'Tokyo', tag: 'Quiet luxury, perfect service', ask: 'A week in Tokyo, the best flight there and back' },
  { code: 'DPS', city: 'Bali', tag: 'Villas, rice terraces, slow days', ask: 'Ten days in Bali to properly switch off' },
  { code: 'VCE', city: 'Venice', tag: 'A long weekend on the water', ask: 'A long weekend in Venice, out Thursday back Monday' },
  { code: 'SYD', city: 'Sydney', tag: 'Worth the long flight, done well', ask: 'Two weeks in Sydney, flat bed both ways' },
  { code: 'DXB', city: 'Dubai', tag: 'Winter sun, seven hours away', ask: 'Five nights of winter sun in Dubai' },
  { code: 'HKT', city: 'Phuket', tag: 'Andaman beaches in the dry season', ask: 'A beach week in Phuket in the dry season' },
];

export function renderLuxHome(view) {
  setLux(true);
  const s = lux;
  view.innerHTML = `
    <section class="hero lux-hero">
      <img class="hero-img" src="${img('window', 2000)}" alt="" />
      <div class="wrap">
        <p class="eyebrow">Nomad Lux</p>
        <h1>Fly well. <em>Arrive rested.</em></h1>
        <p class="lede">Premium, Business and First only. Ranked by your time and comfort. Price only breaks a tie.</p>
        <div class="mode-switch lux-switch" role="tablist">
          <button type="button" data-lmode="search" class="on">Search</button>
          <button type="button" data-lmode="concierge">${ICON.spark} Concierge</button>
        </div>
        <form class="search-card lux-card" id="lux-search" autocomplete="off">
          <div class="trip-toggle" role="tablist">
            <button type="button" data-trip="return">Return</button>
            <button type="button" data-trip="oneway">One way</button>
            <button type="button" data-trip="multi">Multi-city</button>
          </div>
          <div class="search-row lux-row">
            <div class="field"><label for="lx-from">From</label><input id="lx-from" placeholder="City or airport" /><div class="sub" id="lx-from-sub"></div></div>
            <div class="field"><label for="lx-to">To</label><input id="lx-to" placeholder="City or airport" /><div class="sub" id="lx-to-sub"></div></div>
            <div class="field" id="lx-dates" role="button" tabindex="0"><span class="label">Dates</span><span class="value" id="lx-dates-main"></span><span class="sub" id="lx-dates-sub"></span></div>
            <div class="field" id="lx-pax" role="button" tabindex="0"><span class="label">Travellers & cabin</span><span class="value" id="lx-pax-main"></span><span class="sub" id="lx-pax-sub"></span></div>
            <button type="submit" class="btn btn-brass search-btn">Find flights</button>
          </div>
          <div id="lx-legs" class="lux-legs"></div>
        </form>
        <div class="wx-home" id="lx-wx" aria-live="polite"></div>
        <div class="search-card lux-card hidden" id="lux-concierge"></div>
      </div>
    </section>

    <div class="wrap lux-body">
      <section class="lux-how">
        <div class="lux-how-head"><p class="eyebrow">How Lux ranks</p><h2 class="serif">Your time comes first.</h2>
          <p class="muted">Every flight is scored on what makes a trip easy. You see why each one is in the list.</p></div>
        <ol class="lux-weights">
          <li><b>Journey time</b><span>Door of the plane to door of the plane, each way.</span></li>
          <li><b>Nonstop</b><span>Every connection costs time and risk.</span></li>
          <li><b>Cabin and bed</b><span>First over Business over Premium. A flat bed on any flight over 6 hours.</span></li>
          <li><b>Sensible hours</b><span>No 5am starts. No 3am arrivals, unless you slept in a flat bed.</span></li>
          <li><b>Good connections</b><span>No waits over 3 hours, and no dashes under 55 minutes.</span></li>
          <li><b>Flexibility</b><span>Changeable and refundable fares rank higher.</span></li>
        </ol>
        <p class="tiny muted lux-cant">Lux uses only the airline's own data. Airlines do not share lounge access, meals or chauffeur service with Nomad, so Lux cannot rank on them.</p>
      </section>

      <section class="section">
        <div class="section-head"><div><p class="eyebrow" style="margin:0 0 6px">Escapes</p><h2>Worth the flight</h2></div></div>
        <div class="dests">
          ${ESCAPES.map((d) => `<button type="button" class="dest" data-escape="${esc(d.ask)}"><img loading="lazy" src="${cityImg(d.code, 900)}" alt="" /><div><b>${esc(d.city)}</b><span>${esc(d.tag)}</span></div></button>`).join('')}
        </div>
      </section>
    </div>`;

  const form = $('#lux-search', view);
  const pops = popovers();
  const onDoc = (e) => {
    const f = pops.field();
    if (f && !f.contains(e.target) && !(e.target.closest && e.target.closest('.cal-sheet'))) pops.close();
  };
  document.addEventListener('click', onDoc);

  function paint() {
    $$('[data-trip]', form).forEach((b) => b.classList.toggle('on', b.dataset.trip === s.trip));
    for (const k of ['from', 'to']) {
      const inp = $(`#lx-${k}`, form);
      if (document.activeElement !== inp) inp.value = s[k] ? s[k].name : '';
      $(`#lx-${k}-sub`, form).textContent = s[k] ? `${s[k].code} · ${s[k].sub || ''}` : 'Type at least 2 letters';
    }
    $('#lx-dates-main', form).textContent = s.trip === 'multi' ? fmtDay(s.depart) : datesText(s).split(' · ')[0];
    $('#lx-dates-sub', form).textContent = s.trip === 'multi' ? 'First flight' : s.trip === 'oneway' ? 'One way' : datesText(s).split(' · ')[1] || 'Add a return date';
    $('#lx-pax-main', form).textContent = paxText(s);
    $('#lx-pax-sub', form).textContent = CABINS[s.cabin].label;
    paintWeather();
  }

  // Weather for the trip in the form, after the traveller stops typing.
  var wxKey = ''; // var: paint() can run before this line
  var wxTimer = null;
  function paintWeather() {
    const legs = legsOf(s);
    const key = JSON.stringify([s.trip, legs.map((l) => [l.from && l.from.code, l.to && l.to.code, l.date])]);
    if (key === wxKey) return;
    wxKey = key;
    clearTimeout(wxTimer);
    wxTimer = setTimeout(() => {
      const box = $('#lx-wx', view);
      if (box) mountTripWeather(box, { trip: s.trip, from: s.from, to: s.to, depart: s.depart, ret: s.ret, legs }, { compact: true });
    }, 350);
  }

  // Extra flights for multi-city. Each row: from, to, date.
  function paintLegs() {
    const box = $('#lx-legs', form);
    if (s.trip !== 'multi') {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `${s.legs.map((l, i) => `
      <div class="lux-leg" data-leg="${i}">
        <span class="lux-leg-n">Flight ${i + 2}</span>
        <div class="field"><label>From</label><input data-lf="from" value="${esc(l.from ? l.from.name : '')}" placeholder="City or airport" /><div class="sub">${l.from ? esc(l.from.code) : ''}</div></div>
        <div class="field"><label>To</label><input data-lf="to" value="${esc(l.to ? l.to.name : '')}" placeholder="City or airport" /><div class="sub">${l.to ? esc(l.to.code) : ''}</div></div>
        <div class="field"><label>Date</label><input type="date" data-ld value="${esc(l.date || '')}" min="${i ? s.legs[i - 1].date || s.depart : s.depart}" /></div>
        <button type="button" class="x" data-ldel="${i}" aria-label="Remove flight ${i + 2}">×</button>
      </div>`).join('')}
      ${legsOf(s).length < MAX_LEGS + 1 ? '<button type="button" class="btn-link" id="lx-add">+ Add another flight</button>' : ''}`;
    $$('[data-leg]', box).forEach((row) => {
      const i = Number(row.dataset.leg);
      for (const inp of $$('[data-lf]', row)) {
        const key = inp.dataset.lf;
        bindPlace(inp, inp.closest('.field'), (it) => {
          if (!it) {
            const l = s.legs[i];
            if (l && document.activeElement !== inp) inp.value = l[key] ? l[key].name : '';
            return;
          }
          s.legs[i][key] = it;
          if (key === 'to' && s.legs[i + 1] && !s.legs[i + 1].from) s.legs[i + 1].from = it;
          saveLux();
          paintLegs();
        }, pops);
      }
    });
  }

  bindPlace($('#lx-from', form), $('#lx-from', form).closest('.field'), (it) => {
    if (it) {
      s.from = it;
      saveLux();
    }
    paint();
  }, pops);
  bindPlace($('#lx-to', form), $('#lx-to', form).closest('.field'), (it) => {
    if (it) {
      s.to = it;
      if (s.legs[0] && !s.legs[0].from) {
        s.legs[0].from = it;
        paintLegs();
      }
      saveLux();
    }
    paint();
  }, pops);

  form.addEventListener('click', (e) => {
    const t = e.target.closest('[data-trip]');
    if (t) {
      s.trip = t.dataset.trip;
      if (s.trip === 'return' && (!s.ret || s.ret <= s.depart)) s.ret = ymd(addDays(new Date(s.depart), 7));
      if (s.trip === 'multi' && !s.legs.length) s.legs.push({ from: s.to, to: null, date: ymd(addDays(new Date(s.depart), 4)) });
      saveLux();
      paintLegs();
      return paint();
    }
    if (e.target.id === 'lx-add') {
      const last = legsOf(s)[legsOf(s).length - 1];
      s.legs.push({ from: last.to, to: null, date: last.date ? ymd(addDays(new Date(last.date), 4)) : null });
      saveLux();
      return paintLegs();
    }
    const del = e.target.closest('[data-ldel]');
    if (del) {
      s.legs.splice(Number(del.dataset.ldel), 1);
      if (!s.legs.length) s.trip = 'oneway';
      saveLux();
      paintLegs();
      return paint();
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('[data-ld]')) {
      s.legs[Number(e.target.closest('[data-leg]').dataset.leg)].date = e.target.value || null;
      saveLux();
    }
  });

  // Dates
  $('#lx-dates', form).addEventListener('click', (e) => {
    const field = e.currentTarget;
    if (e.target.closest('.popover')) return;
    if (pops.field() === field) return pops.close();
    e.stopPropagation();
    pops.open(createCalendar({
      mode: s.trip === 'return' ? 'range' : 'single',
      start: s.depart,
      end: s.ret,
      onChange(a, b) {
        s.depart = a;
        s.ret = b;
        saveLux();
        paint();
      },
      onDone: () => pops.close(),
    }), field);
  });

  // Travellers and cabin
  $('#lx-pax', form).addEventListener('click', (e) => {
    const field = e.currentTarget;
    if (e.target.closest('.popover')) return;
    if (pops.field() === field) return pops.close();
    e.stopPropagation();
    const pop = document.createElement('div');
    pop.className = 'popover pax';
    const render = () => {
      const n = s.adults + s.childAges.length;
      pop.innerHTML = `
        <h5>Travellers</h5>
        <div class="pax-row"><div><b>Adults</b><span class="tiny muted">18 and over</span></div>
          <div class="stepper"><button type="button" data-step="adults" data-d="-1" ${s.adults <= 1 ? 'disabled' : ''}>−</button><output>${s.adults}</output><button type="button" data-step="adults" data-d="1" ${n >= 9 ? 'disabled' : ''}>+</button></div></div>
        <div class="pax-row"><div><b>Children</b><span class="tiny muted">2 to 17</span></div>
          <div class="stepper"><button type="button" data-step="children" data-d="-1" ${!s.childAges.length ? 'disabled' : ''}>−</button><output>${s.childAges.length}</output><button type="button" data-step="children" data-d="1" ${n >= 9 ? 'disabled' : ''}>+</button></div></div>
        ${s.childAges.length ? `<div class="ages">${s.childAges.map((a, i) => `<label>Child ${i + 1} age<select data-age="${i}">${Array.from({ length: 16 }, (_, k) => k + 2).map((v) => `<option ${v === a ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
        <h5>Cabin</h5>
        <div class="lux-cabins">${Object.entries(CABINS).map(([k, v]) => `<button type="button" class="lux-cabin ${s.cabin === k ? 'on' : ''}" data-lcabin="${k}"><b>${v.label}</b><span>${v.sub}</span></button>`).join('')}</div>
        <div class="pax-foot"><button type="button" class="btn btn-primary btn-sm" data-done>Done</button></div>`;
    };
    pop.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const st = ev.target.closest('[data-step]');
      if (st) {
        const d = Number(st.dataset.d);
        if (st.dataset.step === 'adults') s.adults = Math.max(1, s.adults + d);
        else if (d > 0) s.childAges.push(10);
        else s.childAges.pop();
      }
      const c = ev.target.closest('[data-lcabin]');
      if (c) s.cabin = c.dataset.lcabin;
      if (ev.target.closest('[data-done]')) return pops.close();
      if (st || c) {
        saveLux();
        render();
        paint();
      }
    });
    pop.addEventListener('change', (ev) => {
      if (ev.target.dataset.age) s.childAges[Number(ev.target.dataset.age)] = Number(ev.target.value);
      saveLux();
    });
    render();
    pops.open(pop, field);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const legs = legsOf(s);
    const bad = legs.findIndex((l) => !l.from || !l.to || !l.date);
    if (bad >= 0) return toast(bad ? `Flight ${bad + 1} needs a from, a to and a date.` : 'Choose where you fly from and to.', 'err');
    if (legs.some((l) => l.from.code === l.to.code)) return toast('From and To are the same place.', 'err');
    if (legs.some((l, i) => i && l.date < legs[i - 1].date)) return toast('Put the flights in date order.', 'err');
    saveLux();
    go('#/lux/results');
  });

  // Search or concierge
  let conciergeMounted = false;
  view.addEventListener('click', (e) => {
    const m = e.target.closest('[data-lmode]');
    if (m) {
      $$('[data-lmode]', view).forEach((b) => b.classList.toggle('on', b === m));
      const c = m.dataset.lmode === 'concierge';
      form.classList.toggle('hidden', c);
      $('#lx-wx', view).classList.toggle('hidden', c);
      $('#lux-concierge', view).classList.toggle('hidden', !c);
      if (c && !conciergeMounted) {
        conciergeMounted = true;
        mountConcierge($('#lux-concierge', view));
      }
      if (c) $('#lx-ask', view)?.focus();
      return;
    }
    const esc2 = e.target.closest('[data-escape]');
    if (esc2) {
      $('[data-lmode=concierge]', view).click();
      const box = $('#lx-ask', view);
      box.value = `${esc2.dataset.escape}, from ${s.from ? s.from.name : 'London'}.`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      box.focus();
    }
  });

  paint();
  paintLegs();
  return () => document.removeEventListener('click', onDoc);
}

// ---------------------------------------------------------------------------
// Concierge: trip ideas from Claude, each one a Lux search
// ---------------------------------------------------------------------------
function mountConcierge(box) {
  let busy = false;
  let last = null;
  box.innerHTML = `
    <div class="ai-head"><span class="ai-badge">${ICON.spark}</span><div><b>Lux concierge</b><div class="small muted">Say what kind of trip you want. The concierge suggests places and dates, then Lux finds the best flights.</div></div></div>
    <div id="lx-off" class="notice hidden"></div>
    <form id="lx-ask-form" class="ai-input" autocomplete="off">
      <textarea id="lx-ask" rows="2" maxlength="1500" placeholder="e.g. Ten days somewhere warm in February, from London, two of us. Nonstop if possible."></textarea>
      <button type="submit" class="btn btn-brass" id="lx-ask-go">Suggest trips</button>
    </form>
    <div class="chips lx-climate" id="lx-climate" role="group" aria-label="Weather you want"><span class="small muted">Weather</span>${Object.entries(CLIMATES).map(([k, c]) => `<button type="button" class="chip" data-climate="${k}" title="${esc(c.hint || '')}">${esc(c.label)}</button>`).join('')}</div>
    <div id="lx-ideas"></div>`;
  api('GET', '/api/lux/status').then((st) => {
    if (st.concierge) return;
    const off = $('#lx-off', box);
    off.classList.remove('hidden');
    off.innerHTML = 'The concierge is switched off. The site owner needs to add <code>ANTHROPIC_API_KEY</code> to the server settings. Lux search still works.';
    $('#lx-ask-go', box).disabled = true;
  }).catch(() => {});

  let climate = store.get('nomad.climate', 'any');
  if (!CLIMATES[climate]) climate = 'any';
  const paintClimate = () => $$('[data-climate]', box).forEach((b) => b.classList.toggle('on', b.dataset.climate === climate));
  paintClimate();
  $('#lx-climate', box).addEventListener('click', (e) => {
    const b = e.target.closest('[data-climate]');
    if (!b) return;
    climate = b.dataset.climate;
    store.set('nomad.climate', climate);
    paintClimate();
  });

  const out = $('#lx-ideas', box);
  onUnit(out, () => paint());
  const paint = () => {
    if (busy) {
      out.innerHTML = '<div class="ai-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span> The concierge is thinking…</div>';
      return;
    }
    if (!last) return (out.innerHTML = '');
    const r = last;
    out.innerHTML = `
      ${r.intro ? `<p class="ai-summary serif">${esc(r.intro)}</p>` : ''}
      ${r.questions.length ? `<div class="ai-q"><b>The concierge needs to know</b><ul>${r.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
      <div class="lux-ideas">${r.ideas.map((i, k) => `
        <article class="lux-idea">
          <img src="${cityImg(i.to.code, 700)}" alt="" loading="lazy" />
          <div class="lux-idea-body">
            <p class="eyebrow">${esc(i.city)}, ${esc(i.country)}</p>
            <h3 class="serif">${esc(i.headline)}</h3>
            <p class="small">${esc(i.why)}</p>
            ${i.highlights.length ? `<ul class="lux-hl">${i.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
            <div class="small muted">${esc(fmtDay(i.depart, { day: 'numeric', month: 'short' }))}${i.ret ? ` – ${esc(fmtDay(i.ret, { day: 'numeric', month: 'short' }))}` : ' · one way'} · ${esc(CABINS[i.cabin].label)}</div>
            ${i.weather ? `<div class="idea-wx">${wxPill(i.weather, i.city)}${i.fits === false && r.climate ? `<span class="tiny wx-miss">Not ${esc(r.climate)} on these dates</span>` : ''}</div>` : ''}
            <button type="button" class="btn btn-brass btn-sm" data-idea="${k}" ${r.from ? '' : 'disabled'}>See flights</button>
          </div>
        </article>`).join('')}</div>
      ${r.ideas.some((i) => i.weather) ? `<div class="tiny muted wx-foot">Weather from Open-Meteo: forecast for close dates, else the average of the same dates in recent years. ${unitToggle()}</div>` : ''}
      ${r.ideas.length ? '<p class="tiny muted">Ideas from Claude, not bookings. Nomad books the flights. Hotels and plans on the ground are up to you.</p>' : ''}`;
  };

  async function ask(text) {
    const value = String(text || '').trim();
    if (!value || busy) return;
    busy = true;
    paint();
    try {
      last = await api('POST', '/api/lux/ideas', { text: value, from: lux.from, climate: climate === 'any' ? null : climate });
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      busy = false;
      paint();
    }
  }
  $('#lx-ask-form', box).addEventListener('submit', (e) => {
    e.preventDefault();
    ask($('#lx-ask', box).value);
  });
  $('#lx-ask', box).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(e.target.value);
    }
  });
  out.addEventListener('click', (e) => {
    const b = e.target.closest('[data-idea]');
    if (!b || !last) return;
    const i = last.ideas[Number(b.dataset.idea)];
    Object.assign(lux, { trip: i.ret ? 'return' : 'oneway', from: last.from, to: i.to, depart: i.depart, ret: i.ret, legs: [], adults: last.adults, childAges: [], cabin: i.cabin });
    saveLux();
    go('#/lux/results');
  });
}

// ---------------------------------------------------------------------------
// Results: a short, explained list
// ---------------------------------------------------------------------------
const SORTS = {
  lux: { label: 'Lux pick', fn: (a, b) => a.luxScore - b.luxScore },
  quickest: { label: 'Quickest', fn: (a, b) => a.minutes - b.minutes || a.luxScore - b.luxScore },
  comfort: { label: 'Most comfortable', fn: (a, b) => b.comfort - a.comfort || Number(b.features.flatBed) - Number(a.features.flatBed) || a.luxScore - b.luxScore },
  price: { label: 'Lowest price', fn: (a, b) => a.total - b.total },
};
const CHIPS = {
  nonstop: { label: 'Nonstop', test: (o) => o.stops === 0 },
  flatBed: { label: 'Flat bed', test: (o) => o.features && o.features.flatBed },
  flexible: { label: 'Changeable', test: (o) => o.changeable },
  first: { label: 'First class', test: (o) => o.lux && o.lux.topCabin === 'first' },
};

function legHtml(sl, i, n) {
  const plus = dayDiff(sl.departingAt, sl.arrivingAt);
  const via = sl.stops ? `via ${sl.segments.slice(0, -1).map((g) => g.to).join(', ')}` : 'Nonstop';
  const cabins = sl.cabins.map((c) => CABIN_NAME[c] || c).join(' + ');
  return `<div class="lux-leg-row">
    <span class="lux-when">${n > 1 ? `${n === 2 ? (i ? 'Return' : 'Out') : `Flight ${i + 1}`} · ` : ''}${esc(fmtDay(sl.departingAt, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
    <span class="lux-times"><b>${hhmm(sl.departingAt)}</b> ${esc(sl.origin)} <span class="lux-line"></span> <b>${hhmm(sl.arrivingAt)}${plus > 0 ? `<sup>+${plus}</sup>` : ''}</b> ${esc(sl.destination)}</span>
    <span class="lux-meta">${dur(sl.minutes)} · ${esc(via)} · ${esc(cabins)}</span>
  </div>`;
}

function card(o, rank, n) {
  const l = o.lux || { good: [], warn: [] };
  return `<article class="lux-offer" data-id="${esc(o.id)}">
    <div class="lux-rank serif">${rank}</div>
    <div class="lux-offer-main">
      <div class="lux-airline">${logoHtml(o.owner, 28)}<span>${esc(o.owner.name)}</span></div>
      ${o.slices.map((sl, i) => legHtml(sl, i, o.slices.length)).join('')}
      <ul class="lux-why">${l.good.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
      ${l.warn.length ? `<ul class="lux-warn">${l.warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <button type="button" class="btn-link small" data-details>Flight details</button>
      <div class="details hidden"></div>
    </div>
    <div class="lux-offer-side">
      <div class="lux-price">${money(o.total, o.currency)}</div>
      <div class="tiny muted">${n > 1 ? `${money(o.total / n, o.currency)} each · ` : ''}total</div>
      <button type="button" class="btn btn-brass" data-select="${esc(o.id)}">Choose</button>
    </div>
  </article>`;
}

export function renderLuxResults(view) {
  setLux(true);
  const s = lux;
  const legs = legsOf(s);
  if (legs.some((l) => !l.from || !l.to || !l.date)) return go('#/lux');
  const key = keyOf(s);
  const n = s.adults + s.childAges.length;
  const last = legs[legs.length - 1];
  const dest = s.trip === 'return' ? s.to : s.trip === 'multi' ? last.to : s.to;
  const title = s.trip === 'multi' ? legs.map((l) => l.from.name).concat(last.to.name).join(' → ') : `${s.from.name} → ${s.to.name}`;

  view.innerHTML = `
    <section class="band lux-band"><img src="${cityImg(dest.code, 1800)}" alt="" />
      <div class="wrap">
        <p class="eyebrow" style="margin:0 0 6px">Nomad Lux · ${s.trip === 'return' ? 'Return' : s.trip === 'multi' ? 'Multi-city' : 'One way'}</p>
        <h1>${esc(title)}</h1>
        <div class="meta"><span>${esc(datesText(s))}</span><span class="dot">•</span><span>${esc(paxText(s))}</span><span class="dot">•</span><span>${esc(CABINS[s.cabin].label)}</span></div>
        <div class="band-wx" id="band-wx"></div>
        <a href="#/lux" class="btn btn-ghost btn-sm edit">Edit search</a>
      </div>
    </section>
    <div class="wrap lux-results">
      <div id="lx-head"></div>
      <div class="lux-controls" id="lx-controls"></div>
      <div id="lx-list"><div class="loading"><div class="plane-loader"><div class="track"></div>${ICON.plane}</div>Searching Premium, Business and First…</div><div class="skeleton"></div><div class="skeleton"></div></div>
    </div>`;

  mountTripWeather($('#band-wx', view), { trip: s.trip, from: s.from, to: s.to, depart: s.depart, ret: s.ret, legs }, { compact: true });

  const cached = store.get('nomad.lux.results', null);
  let data = cached && cached.key === key && Date.now() - cached.at < 20 * 60e3 ? cached.data : null;
  let sortKey = 'lux';
  const chips = new Set();
  let shown = 5;

  function list() {
    return data.offers.filter((o) => [...chips].every((c) => CHIPS[c].test(o))).sort(SORTS[sortKey].fn);
  }

  function paint() {
    if (!data.offers.length) {
      $('#lx-controls', view).innerHTML = '';
      $('#lx-list', view).innerHTML = `<div class="empty"><h3>No premium flights found</h3><p>${data.hiddenEconomy ? `Every option we found puts you in Economy for part of the trip. ` : ''}Try other dates, a nearby airport, or Best available.</p><a class="btn btn-primary" href="#/lux">Change search</a></div>`;
      return;
    }
    const rows = list();
    const cn = data.cabins.map((c) => CABIN_NAME[c]);
    const names = cn.length > 1 ? `${cn.slice(0, -1).join(', ')} and ${cn[cn.length - 1]}` : cn[0];
    $('#lx-head', view).innerHTML = `
      <p class="lux-lede serif">We compared ${data.matching} ${esc(names)} options. ${rows.length ? `Here ${Math.min(shown, rows.length) === 1 ? 'is the best one' : `are the best ${Math.min(shown, rows.length)}`} for your time and comfort.` : ''}</p>
      ${data.hiddenEconomy ? `<p class="small muted">We left out ${data.hiddenEconomy} option${data.hiddenEconomy === 1 ? '' : 's'} with an Economy flight in them.</p>` : ''}
`;
    $('#lx-controls', view).innerHTML = `
      <div class="lux-sorts">${Object.entries(SORTS).map(([k, v]) => `<button type="button" class="${k === sortKey ? 'on' : ''}" data-lsort="${k}">${v.label}</button>`).join('')}</div>
      <div class="chips">${Object.entries(CHIPS).filter(([, c]) => data.offers.some(c.test)).map(([k, c]) => `<button type="button" class="chip ${chips.has(k) ? 'on' : ''}" data-chip="${k}">${c.label}</button>`).join('')}</div>`;
    $('#lx-list', view).innerHTML = rows.length
      ? rows.slice(0, shown).map((o, i) => card(o, i + 1, n)).join('') +
        (rows.length > shown ? `<div class="more"><button type="button" class="btn btn-ghost" id="lx-more">Show ${Math.min(5, rows.length - shown)} more</button></div>` : '')
      : '<div class="empty"><h3>Nothing matches those choices</h3><p>Turn one off to see more.</p></div>';
  }

  view.addEventListener('click', (e) => {
    const so = e.target.closest('[data-lsort]');
    if (so) {
      sortKey = so.dataset.lsort;
      shown = 5;
      return paint();
    }
    const ch = e.target.closest('[data-chip]');
    if (ch) {
      chips.has(ch.dataset.chip) ? chips.delete(ch.dataset.chip) : chips.add(ch.dataset.chip);
      shown = 5;
      return paint();
    }
    if (e.target.id === 'lx-more') {
      shown += 5;
      return paint();
    }
    const det = e.target.closest('[data-details]');
    if (det) {
      const c = det.closest('.lux-offer');
      const box = $('.details', c);
      if (box.classList.contains('hidden')) box.innerHTML = detailsHtml(data.offers.find((x) => x.id === c.dataset.id));
      box.classList.toggle('hidden');
      det.textContent = box.classList.contains('hidden') ? 'Flight details' : 'Hide details';
      return;
    }
    const sel = e.target.closest('[data-select]');
    if (sel) {
      const o = data.offers.find((x) => x.id === sel.dataset.select);
      state.offer = { ...o, lux: true, search: { childAges: s.childAges, loyalty: [], to: dest, from: s.from } };
      state.travellers = null;
      persist('offer');
      persist('travellers');
      go('#/checkout');
    }
  });

  if (data) {
    paint();
    return;
  }
  let alive = true;
  api('POST', '/api/lux/search', {
    legs: legs.map((l) => ({ origin: l.from.code, destination: l.to.code, date: l.date })),
    passengers: { adults: s.adults, childAges: s.childAges, infants: 0 },
    cabin: s.cabin,
  })
    .then((r) => {
      if (!alive) return;
      data = r;
      store.set('nomad.lux.results', { key, at: Date.now(), data: r });
      paint();
    })
    .catch((e) => {
      if (!alive) return;
      $('#lx-list', view).innerHTML = `<div class="empty"><h3>We couldn’t search right now</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/lux">Back to search</a></div>`;
      toast(e.message, 'err');
    });
  return () => {
    alive = false;
  };
}
