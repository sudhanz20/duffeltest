// Home page: hero, search form, recent searches and destinations.
import { $, $$, esc, api, toast, fmtDay, ymd, addDays, today, ICON, CABIN_LABEL, img, cityImg, DESTINATIONS, store } from './util.js';
import { placeItems, placeOf } from './util.js';
import { state, persist, go, recentSearches, addRecent, clearRecent, paxCount, legsOf, syncMulti, startMulti, MAX_LEGS } from './state.js';
import { createCalendar } from './calendar.js';
import { mountAi } from './ai.js';

const AIRLINES = [
  ['BA', 'British Airways Executive Club'],
  ['AA', 'American Airlines AAdvantage'],
  ['DL', 'Delta SkyMiles'],
  ['UA', 'United MileagePlus'],
  ['LH', 'Lufthansa Miles & More'],
  ['AF', 'Air France–KLM Flying Blue'],
  ['VS', 'Virgin Atlantic Flying Club'],
  ['EK', 'Emirates Skywards'],
  ['QR', 'Qatar Airways Privilege Club'],
  ['SQ', 'Singapore Airlines KrisFlyer'],
  ['CX', 'Cathay Asia Miles'],
  ['IB', 'Iberia Plus'],
  ['QF', 'Qantas Frequent Flyer'],
  ['ZZ', 'Duffel Airways (test)'],
];

export function paxLabel(s) {
  const n = paxCount(s);
  const parts = [`${n} traveller${n === 1 ? '' : 's'}`];
  const cabin = s.trip === 'return' && s.mixed ? `${CABIN_LABEL[s.cabinOut]} / ${CABIN_LABEL[s.cabinBack]}` : CABIN_LABEL[s.cabin];
  return { main: parts[0], sub: cabin + (s.loyalty.length ? ' · loyalty added' : '') };
}

export function datesLabel(s) {
  if (s.trip === 'multi') {
    const legs = legsOf(s);
    const first = legs[0] && legs[0].date;
    const last = legs[legs.length - 1] && legs[legs.length - 1].date;
    if (!first) return { main: 'Add dates', sub: '' };
    const main = first === last || !last ? fmtDay(first) : `${fmtDay(first, { day: 'numeric', month: 'short' })} – ${fmtDay(last, { day: 'numeric', month: 'short' })}`;
    return { main, sub: `Multi-city · ${legs.length} flights` };
  }
  if (!s.depart) return { main: 'Add dates', sub: '' };
  if (s.trip === 'oneway') return { main: fmtDay(s.depart), sub: 'One way' };
  if (!s.ret) return { main: `${fmtDay(s.depart)} →`, sub: 'Add a return date' };
  const nights = Math.round((new Date(s.ret) - new Date(s.depart)) / 864e5);
  return { main: `${fmtDay(s.depart, { day: 'numeric', month: 'short' })} – ${fmtDay(s.ret, { day: 'numeric', month: 'short' })}`, sub: `${nights} night${nights === 1 ? '' : 's'}` };
}

// "London → Paris → Rome" for multi-city, "London → Paris" otherwise.
export function routeLabel(s) {
  if (s.trip !== 'multi') return `${s.from.name} → ${s.to.name}`;
  const legs = legsOf(s);
  const stops = [legs[0].from];
  for (const l of legs) {
    if (stops[stops.length - 1] && l.from && stops[stops.length - 1].code !== l.from.code) stops.push(l.from, null);
    stops.push(l.to);
  }
  // A gap (flying out of a different city than you landed in) shows as "…".
  return stops.map((p) => (p ? p.name : '…')).join(' → ').replace(/ → … → /g, ' … ');
}

export function renderHome(view) {
  const s = state.search;
  view.innerHTML = `
    <section class="hero">
      <img class="hero-img" src="${img('hero', 2000)}" alt="" />
      <div class="wrap">
        <p class="eyebrow">Nomad · Flights</p>
        <h1>The world, <em>beautifully</em> arranged.</h1>
        <p class="lede">Compare every cabin, mix them across your trip, and book in a few calm steps.</p>
        <div class="mode-switch" role="tablist">
          <button type="button" data-mode="classic">Search</button>
          <button type="button" data-mode="ai">${ICON.spark} Ask Nomad</button>
        </div>
        <div class="search-card ai-card hidden" id="ai"></div>
        <form class="search-card" id="search" autocomplete="off">
          <div class="trip-toggle" role="tablist">
            <button type="button" data-trip="return">Return</button>
            <button type="button" data-trip="oneway">One way</button>
            <button type="button" data-trip="multi">Multi-city</button>
          </div>
          <div class="legs hidden" id="legs"></div>
          <div class="search-row">
            <div class="field f-from"><label for="from-in">From</label><input id="from-in" data-place="from" placeholder="City or airport" /><div class="sub" data-sub="from"></div></div>
            <button type="button" class="swap" id="swap" aria-label="Swap origin and destination">${ICON.swap}</button>
            <div class="field f-to"><label for="to-in">To</label><input id="to-in" data-place="to" placeholder="City or airport" /><div class="sub" data-sub="to"></div></div>
            <div class="field f-dates" id="dates-btn" role="button" tabindex="0"><span class="label">Dates</span><span class="value" id="dates-main"></span><span class="sub" id="dates-sub"></span></div>
            <div class="field f-pax" id="pax-btn" role="button" tabindex="0"><span class="label">Travellers & cabin</span><span class="value" id="pax-main"></span><span class="sub" id="pax-sub"></span></div>
            <button type="submit" class="btn btn-brass search-btn">Search</button>
          </div>
        </form>
      </div>
    </section>

    <div class="wrap">
      <section class="section" id="recent-sec">
        <div class="section-head"><h2>Recent searches</h2><button type="button" class="btn-link" id="clear-recent">Clear</button></div>
        <div class="recent" id="recent"></div>
      </section>

      <section class="section">
        <div class="section-head"><div><p class="eyebrow" style="margin:0 0 6px">Inspiration</p><h2>Where to next?</h2></div></div>
        <div class="dests">
          ${DESTINATIONS.map((d) => `<button type="button" class="dest" data-dest="${d.code}" data-city="${esc(d.city)}"><img loading="lazy" src="${cityImg(d.code, 900)}" alt="" /><div><b>${esc(d.city)}</b><span>${esc(d.tag)}</span></div></button>`).join('')}
        </div>
      </section>

      <section class="values">
        <div><div class="ico">${ICON.sofa}</div><h3>Comfort, ranked honestly</h3><p>Sort by the best cabin you can get, then the best price for it.</p></div>
        <div><div class="ico">${ICON.spark}</div><h3>Mix your cabins</h3><p>Fly business out and economy home. Nomad pairs the best of each.</p></div>
        <div><div class="ico">${ICON.shield}</div><h3>Manage it yourself</h3><p>Change dates, upgrade cabins or cancel, all from My bookings.</p></div>
      </section>
    </div>`;

  const form = $('#search', view);
  let open = null; // currently open popover { el, field }

  function close() {
    if (!open) return;
    open.el.remove();
    open.field && open.field.classList.remove('open');
    open = null;
  }
  function openPop(el, field) {
    close();
    field.classList.add('open');
    // A phone calendar is a sheet over the whole page, so it lives on the body.
    (el.classList.contains('cal-sheet') ? document.body : field).appendChild(el);
    open = { el, field };
  }

  // ---------- Paint the fields ----------
  function paint() {
    $$('[data-trip]', form).forEach((b) => b.classList.toggle('on', b.dataset.trip === s.trip));
    form.classList.toggle('is-multi', s.trip === 'multi');
    $('#legs', form).classList.toggle('hidden', s.trip !== 'multi');
    if (s.trip === 'multi') paintLegs();
    for (const k of ['from', 'to']) {
      const inp = $(`[data-place=${k}]`, form);
      if (document.activeElement !== inp) inp.value = s[k] ? s[k].name : '';
      $(`[data-sub=${k}]`, form).textContent = s[k] ? `${s[k].code} · ${s[k].sub || ''}` : 'Type at least 2 letters';
    }
    const d = datesLabel(s);
    $('#dates-main', form).textContent = d.main;
    $('#dates-sub', form).textContent = d.sub;
    const p = paxLabel(s);
    $('#pax-main', form).textContent = p.main;
    $('#pax-sub', form).textContent = p.sub;
  }

  // ---------- Trip type ----------
  $$('[data-trip]', form).forEach((b) =>
    b.addEventListener('click', () => {
      const was = s.trip;
      s.trip = b.dataset.trip;
      if (s.trip === 'multi') {
        startMulti(s);
        syncMulti(s);
        renderLegs();
      } else if (was === 'multi') {
        // Back to a simple trip: keep the first flight's route and date.
        const first = s.legs && s.legs[0];
        if (first) Object.assign(s, { from: first.from, to: first.to, depart: first.date });
      }
      if (s.trip === 'return' && (!s.ret || s.ret <= s.depart)) s.ret = ymd(addDays(new Date(s.depart), 7));
      persist('search');
      paint();
    })
  );

  $('#swap', form).addEventListener('click', () => {
    [s.from, s.to] = [s.to, s.from];
    persist('search');
    paint();
  });

  // ---------- Airport lookup ----------
  function bindPlace(inp, onChoose) {
    let timer = null;
    let items = [];
    let hl = -1;
    const field = inp.closest('.field');
    const list = document.createElement('div');
    list.className = 'popover ac-list';
    list.addEventListener('mousedown', (e) => e.preventDefault());

    const choose = (it) => {
      close();
      inp.blur();
      onChoose(placeOf(it));
    };

    const renderList = () => {
      list.innerHTML = items.length
        ? items
            .map(
              (it, i) => `<div class="ac-item ${it.child ? 'sub' : ''} ${i === hl ? 'hl' : ''}" data-i="${i}">
                ${it.type === 'city' ? ICON.city : ICON.plane}
                <div style="flex:1;min-width:0"><div class="nm">${esc(it.name)}</div><div class="tiny muted">${esc(it.sub)}</div></div>
                <span class="code">${esc(it.code)}</span></div>`
            )
            .join('')
        : '<div class="ac-item muted small">No matches</div>';
    };
    list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (row) choose(items[Number(row.dataset.i)]);
    });

    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inp.value.trim();
      if (q.length < 2) return close();
      timer = setTimeout(async () => {
        try {
          const r = await api('GET', `/api/places?q=${encodeURIComponent(q)}`);
          if (inp.value.trim() !== q) return;
          items = placeItems(r.places);
          hl = items.length ? 0 : -1;
          renderList();
          if (!open || open.el !== list) openPop(list, field);
        } catch (e) {
          toast(e.message, 'err');
        }
      }, 180);
    });
    inp.addEventListener('keydown', (e) => {
      if (!open || open.el !== list) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        renderList();
      } else if (e.key === 'Enter' && items[hl]) {
        e.preventDefault();
        choose(items[hl]);
      } else if (e.key === 'Escape') close();
    });
    inp.addEventListener('blur', () => setTimeout(() => {
      if (open && open.el === list) close();
      paint();
    }, 150));
  }
  for (const inp of $$('[data-place]', form)) {
    const key = inp.dataset.place;
    bindPlace(inp, (it) => {
      s[key] = it;
      persist('search');
      paint();
      if (key === 'from') $('[data-place=to]', form).focus();
      else if (!s.depart) $('#dates-btn', form).click();
    });
  }

  // ---------- Multi-city flights ----------
  const legsBox = $('#legs', form);
  const placeSub = (p) => (p ? `${p.code} · ${p.sub || ''}` : 'City or airport');
  function renderLegs() {
    if (!s.legs) return;
    close();
    legsBox.innerHTML = `${s.legs
      .map(
        (l, i) => `<div class="leg-row" data-leg="${i}">
          <span class="leg-no">${i + 1}</span>
          <div class="field"><label>From</label><input data-leg-place="from" placeholder="City or airport" /><div class="sub" data-leg-sub="from"></div></div>
          <div class="field"><label>To</label><input data-leg-place="to" placeholder="City or airport" /><div class="sub" data-leg-sub="to"></div></div>
          <div class="field f-leg-date" role="button" tabindex="0" data-leg-date><span class="label">Date</span><span class="value" data-leg-day></span></div>
          ${s.legs.length > 2 ? `<button type="button" class="leg-del" data-leg-del="${i}" aria-label="Remove flight ${i + 1}">×</button>` : '<span></span>'}
        </div>`
      )
      .join('')}
      ${s.legs.length < MAX_LEGS ? `<button type="button" class="btn-link small add-leg" id="add-leg">+ Add another flight</button>` : `<p class="tiny muted add-leg">Up to ${MAX_LEGS} flights in one booking.</p>`}`;
    for (const row of $$('[data-leg]', legsBox)) {
      const i = Number(row.dataset.leg);
      for (const inp of $$('[data-leg-place]', row)) {
        const k = inp.dataset.legPlace;
        bindPlace(inp, (it) => {
          s.legs[i][k] = it;
          // Most trips carry on from where the last flight landed.
          if (k === 'to' && s.legs[i + 1] && !s.legs[i + 1].from) s.legs[i + 1].from = it;
          syncMulti(s);
          persist('search');
          paint();
          if (k === 'from') $('[data-leg-place=to]', row).focus();
          else if (!s.legs[i].date) $('[data-leg-date]', row).click();
        });
      }
    }
    paintLegs();
  }
  function paintLegs() {
    if (!s.legs || $$('[data-leg]', legsBox).length !== s.legs.length) return renderLegs();
    for (const row of $$('[data-leg]', legsBox)) {
      const l = s.legs[Number(row.dataset.leg)];
      for (const k of ['from', 'to']) {
        const inp = $(`[data-leg-place=${k}]`, row);
        if (document.activeElement !== inp) inp.value = l[k] ? l[k].name : '';
        $(`[data-leg-sub=${k}]`, row).textContent = placeSub(l[k]);
      }
      $('[data-leg-day]', row).textContent = l.date ? fmtDay(l.date) : 'Add date';
    }
  }
  legsBox.addEventListener('click', (e) => {
    if (e.target.id === 'add-leg') {
      const last = s.legs[s.legs.length - 1];
      s.legs.push({ from: last.to, to: null, date: last.date ? ymd(addDays(new Date(last.date), 3)) : null });
      persist('search');
      renderLegs();
      $$('[data-leg-place=to]', legsBox).pop().focus();
      return;
    }
    const del = e.target.closest('[data-leg-del]');
    if (del) {
      s.legs.splice(Number(del.dataset.legDel), 1);
      syncMulti(s);
      persist('search');
      renderLegs();
      paint();
      return;
    }
    const field = e.target.closest('[data-leg-date]');
    if (!field || e.target.closest('.popover')) return;
    if (open && open.field === field) return close();
    const i = Number(field.closest('[data-leg]').dataset.leg);
    const prev = s.legs[i - 1] && s.legs[i - 1].date;
    const cal = createCalendar({
      mode: 'single',
      start: s.legs[i].date,
      min: prev && prev > ymd(today()) ? prev : undefined,
      onChange(a) {
        s.legs[i].date = a;
        // Keep the flights in order: later flights cannot leave before this one.
        for (let k = i + 1; k < s.legs.length; k++) if (s.legs[k].date && s.legs[k].date < a) s.legs[k].date = a;
        syncMulti(s);
        persist('search');
        paint();
        close();
      },
      onDone: () => close(),
    });
    openPop(cal, field);
  });

  // ---------- Dates ----------
  $('#dates-btn', form).addEventListener('click', (e) => {
    const field = e.currentTarget;
    if (e.target.closest('.popover')) return;
    if (open && open.field === field) return close();
    const cal = createCalendar({
      mode: s.trip === 'return' ? 'range' : 'single',
      start: s.depart,
      end: s.ret,
      onChange(a, b) {
        s.depart = a;
        s.ret = b;
        persist('search');
        paint();
      },
      onDone: () => close(),
    });
    openPop(cal, field);
  });

  // ---------- Travellers, cabin and loyalty ----------
  $('#pax-btn', form).addEventListener('click', (e) => {
    const field = e.currentTarget;
    if (e.target.closest('.popover')) return;
    if (open && open.field === field) return close();
    const pop = document.createElement('div');
    pop.className = 'popover pax';
    pop.addEventListener('click', (ev) => ev.stopPropagation());
    const renderPax = () => {
      const n = paxCount(s);
      const cabinChips = ['economy', 'premium_economy', 'business', 'first', 'any']
        .map((c) => `<button type="button" class="chip ${!s.mixed && s.cabin === c ? 'on' : ''}" data-cabin="${c}">${CABIN_LABEL[c]}</button>`)
        .join('');
      const opt = (sel) => ['economy', 'premium_economy', 'business', 'first'].map((c) => `<option value="${c}" ${sel === c ? 'selected' : ''}>${CABIN_LABEL[c]}</option>`).join('');
      pop.innerHTML = `
        <h5>Travellers</h5>
        <div class="pax-row"><div><b>Adults</b><span class="tiny muted">18 and over</span></div>
          <div class="stepper"><button type="button" data-step="adults" data-d="-1" ${s.adults <= 1 ? 'disabled' : ''}>−</button><output>${s.adults}</output><button type="button" data-step="adults" data-d="1" ${n >= 9 ? 'disabled' : ''}>+</button></div></div>
        <div class="pax-row"><div><b>Children</b><span class="tiny muted">2 to 17</span></div>
          <div class="stepper"><button type="button" data-step="children" data-d="-1" ${!s.childAges.length ? 'disabled' : ''}>−</button><output>${s.childAges.length}</output><button type="button" data-step="children" data-d="1" ${n >= 9 ? 'disabled' : ''}>+</button></div></div>
        ${s.childAges.length ? `<div class="ages">${s.childAges.map((a, i) => `<label>Child ${i + 1} age<select data-age="${i}">${Array.from({ length: 16 }, (_, k) => k + 2).map((v) => `<option ${v === a ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`).join('')}</div>` : ''}
        <div class="pax-row"><div><b>Infants</b><span class="tiny muted">Under 2, on a lap</span></div>
          <div class="stepper"><button type="button" data-step="infants" data-d="-1" ${!s.infants ? 'disabled' : ''}>−</button><output>${s.infants}</output><button type="button" data-step="infants" data-d="1" ${n >= 9 || s.infants >= s.adults ? 'disabled' : ''}>+</button></div></div>

        <h5>Cabin</h5>
        <div class="chips">${cabinChips}</div>
        ${s.trip === 'return' ? `
          <label class="switch"><span>Different cabin each way</span><input type="checkbox" id="mix" ${s.mixed ? 'checked' : ''} /></label>
          ${s.mixed ? `<div class="mix-grid"><label class="small muted">Outbound<select data-mix="cabinOut">${opt(s.cabinOut)}</select></label><label class="small muted">Return<select data-mix="cabinBack">${opt(s.cabinBack)}</select></label></div>
          <p class="tiny muted" style="margin:8px 0 0">Nomad pairs two one-way tickets for this. Each has its own booking reference.</p>` : ''}` : ''}

        <h5>Frequent flyer <span style="text-transform:none;letter-spacing:0">(optional)</span></h5>
        ${s.loyalty.map((l, i) => `
          <div class="loyalty-row" data-l="${i}">
            <button type="button" class="x" data-ldel="${i}" aria-label="Remove">×</button>
            <label class="small muted" style="grid-column:span 2">Programme<select data-lf="airline">${AIRLINES.map(([c, nm]) => `<option value="${c}" ${l.airline === c ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select></label>
            <label class="small muted">Traveller<select data-lf="adult">${Array.from({ length: s.adults }, (_, k) => `<option value="${k}" ${Number(l.adult) === k ? 'selected' : ''}>Adult ${k + 1}</option>`).join('')}</select></label>
            <label class="small muted">Member number<input class="input" data-lf="number" value="${esc(l.number)}" /></label>
            <label class="small muted">First name<input class="input" data-lf="givenName" value="${esc(l.givenName)}" /></label>
            <label class="small muted">Last name<input class="input" data-lf="familyName" value="${esc(l.familyName)}" /></label>
          </div>`).join('')}
        <button type="button" class="btn-link small" id="add-loyalty">+ Add a programme</button>
        <p class="tiny muted" style="margin:6px 0 0">Airlines may show member fares. The name must match the membership.</p>
        <div class="pax-foot"><button type="button" class="btn btn-primary btn-sm" id="pax-done">Done</button></div>`;
    };
    pop.addEventListener('click', (ev) => {
      const st = ev.target.closest('[data-step]');
      if (st) {
        const d = Number(st.dataset.d);
        if (st.dataset.step === 'adults') {
          s.adults = Math.max(1, s.adults + d);
          s.infants = Math.min(s.infants, s.adults);
          s.loyalty = s.loyalty.filter((l) => Number(l.adult) < s.adults);
        } else if (st.dataset.step === 'children') {
          if (d > 0) s.childAges.push(8);
          else s.childAges.pop();
        } else s.infants = Math.max(0, s.infants + d);
      }
      const ch = ev.target.closest('[data-cabin]');
      if (ch) {
        s.cabin = ch.dataset.cabin;
        s.mixed = false;
      }
      if (ev.target.id === 'add-loyalty') s.loyalty.push({ airline: 'BA', adult: 0, number: '', givenName: '', familyName: '' });
      const del = ev.target.closest('[data-ldel]');
      if (del) s.loyalty.splice(Number(del.dataset.ldel), 1);
      if (ev.target.id === 'pax-done') {
        close();
        return;
      }
      if (st || ch || del || ev.target.id === 'add-loyalty') {
        persist('search');
        renderPax();
        paint();
      }
    });
    pop.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.age) s.childAges[Number(t.dataset.age)] = Number(t.value);
      if (t.id === 'mix') s.mixed = t.checked;
      if (t.dataset.mix) s[t.dataset.mix] = t.value;
      if (t.dataset.lf) {
        const row = t.closest('[data-l]');
        s.loyalty[Number(row.dataset.l)][t.dataset.lf] = t.value;
      }
      persist('search');
      if (t.id === 'mix') renderPax();
      paint();
    });
    pop.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.dataset.lf) {
        s.loyalty[Number(t.closest('[data-l]').dataset.l)][t.dataset.lf] = t.value;
        persist('search');
      }
    });
    renderPax();
    openPop(pop, field);
  });

  const outside = (e) => {
    if (open && !open.field.contains(e.target) && !open.el.contains(e.target)) close();
  };
  document.addEventListener('mousedown', outside);

  // ---------- Submit ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    close();
    if (s.trip === 'multi') {
      const bad = s.legs.findIndex((l) => !l.from || !l.to || !l.date);
      if (bad >= 0) return toast(`Flight ${bad + 1} needs a from, a to and a date.`, 'err');
      const same = s.legs.findIndex((l) => l.from.code === l.to.code);
      if (same >= 0) return toast(`Flight ${same + 1} starts and ends in the same place.`, 'err');
      if (s.legs.some((l, i) => i && l.date < s.legs[i - 1].date)) return toast('Put the flights in date order.', 'err');
      syncMulti(s);
    }
    if (!s.from || !s.to) return toast('Choose where you are flying from and to.', 'err');
    if (s.from.code === s.to.code) return toast('From and To are the same place.', 'err');
    if (!s.depart) return toast('Choose a departure date.', 'err');
    if (s.trip === 'return' && !s.ret) return toast('Choose a return date, or switch to one way.', 'err');
    const badLoyalty = s.loyalty.find((l) => l.number && (!l.givenName || !l.familyName));
    if (badLoyalty) return toast('Each frequent flyer programme needs the member’s first and last name.', 'err');
    s.loyalty = s.loyalty.filter((l) => l.number);
    s.prefs = null; // AI preferences apply only to AI searches
    persist('search');
    addRecent(s);
    go('#/results');
  });

  // ---------- Ask Nomad (AI search) ----------
  function setMode(mode) {
    store.set('nomad.mode', mode);
    $$('[data-mode]', view).forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('#ai', view).classList.toggle('hidden', mode !== 'ai');
    form.classList.toggle('hidden', mode === 'ai');
    if (mode === 'ai') $('#ai-text', view)?.focus();
  }
  $$('[data-mode]', view).forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  mountAi($('#ai', view), {
    onSearch(found) {
      Object.assign(s, found);
      syncMulti(s);
      persist('search');
      addRecent(s);
      go('#/results');
    },
    onUseForm(found) {
      for (const [k, v] of Object.entries(found)) if (v !== null && v !== undefined) s[k] = v;
      syncMulti(s);
      persist('search');
      if (s.trip === 'multi') renderLegs();
      paint();
      setMode('classic');
    },
  });
  setMode(store.get('nomad.mode', 'classic'));

  // ---------- Recent searches ----------
  function paintRecent() {
    const list = recentSearches();
    $('#recent-sec', view).classList.toggle('hidden', !list.length);
    $('#recent', view).innerHTML = list
      .map((r, i) => {
        const d = datesLabel(r);
        const p = paxLabel(r);
        return `<button type="button" class="recent-card" data-r="${i}"><img loading="lazy" src="${cityImg(r.to.code, 200)}" alt="" />
          <div style="min-width:0"><b>${esc(routeLabel(r))}</b><div class="small muted">${esc(d.main)}</div><div class="tiny muted">${esc(p.main)} · ${esc(p.sub)}</div></div></button>`;
      })
      .join('');
  }
  $('#recent', view).addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    const r = recentSearches()[Number(b.dataset.r)];
    if (!r) return;
    const { at, ...rest } = r;
    Object.assign(s, { legs: null }, rest);
    persist('search');
    addRecent(s);
    go('#/results');
  });
  $('#clear-recent', view).addEventListener('click', () => {
    clearRecent();
    paintRecent();
  });

  // ---------- Destinations ----------
  $$('[data-dest]', view).forEach((b) =>
    b.addEventListener('click', () => {
      s.to = { code: b.dataset.dest, name: b.dataset.city, sub: 'All airports', type: 'city' };
      if (s.from && s.from.code === s.to.code) s.from = null;
      persist('search');
      paint();
      $('#search', view).scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!s.from) $('[data-place=from]', form).focus();
    })
  );

  if (s.trip === 'multi') renderLegs();
  if (s.depart && s.depart < ymd(today())) {
    s.depart = ymd(addDays(today(), 30));
    s.ret = ymd(addDays(today(), 37));
  }
  paint();
  paintRecent();
  return () => document.removeEventListener('mousedown', outside);
}
