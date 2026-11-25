// Checkout: traveller details, payment and confirmation.
import { $, $$, esc, api, toast, fmtDay, hhmm, dayDiff, dur, money, ageOn, ICON, PAY_ICON, CABIN_LABEL, cityImg, store, processing, wait } from './util.js';
import { state, persist, go } from './state.js';
import { logoHtml, cabinTags } from './results.js';

const TITLES_ADULT = [['mr', 'Mr'], ['ms', 'Ms'], ['mrs', 'Mrs'], ['miss', 'Miss'], ['dr', 'Dr']];
const TITLES_CHILD = [['miss', 'Miss'], ['mr', 'Master']];

function paxLabel(p, i, offer) {
  const kids = offer.passengers.filter((x) => x.type === 'child' || x.age != null && x.type !== 'adult');
  if (p.type === 'adult') return { title: `Adult ${offer.passengers.slice(0, i + 1).filter((x) => x.type === 'adult').length}`, sub: i === 0 ? 'Lead traveller · we send the tickets here' : '18 or over' };
  if (p.type === 'infant_without_seat') return { title: `Infant ${offer.passengers.slice(0, i + 1).filter((x) => x.type === 'infant_without_seat').length}`, sub: 'Under 2 · travels on an adult’s lap' };
  const n = offer.passengers.slice(0, i + 1).filter((x) => x.type !== 'adult' && x.type !== 'infant_without_seat').length;
  return { title: `Child ${n}`, sub: p.age != null ? `Aged ${p.age} on the day of travel` : 'Child', kids };
}

function steps(active) {
  const names = ['Travellers', 'Payment', 'Confirmed'];
  return `<div class="steps">${names
    .map((nm, i) => `${i ? '<span class="bar"></span>' : ''}<span class="s ${i === active ? 'on' : i < active ? 'done' : ''}"><span class="n">${i < active ? '✓' : i + 1}</span>${nm}</span>`)
    .join('')}</div>`;
}

export function summaryHtml(o) {
  const n = o.passengers.length;
  const counts = {};
  for (const p of o.passengers) {
    const k = p.type === 'adult' ? 'Adult' : p.type === 'infant_without_seat' ? 'Infant' : 'Child';
    counts[k] = (counts[k] || 0) + 1;
  }
  const who = Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}${v > 1 ? (k === 'Child' ? 'ren' : 's') : ''}`).join(', ');
  const legs = o.slices
    .map(
      (sl, i) => `<div class="sum-leg">${logoHtml(o.separateTickets ? { logo: i === 0 ? o.owner.logo : o.owner.logo2 || o.owner.logo, code: o.owner.code.split('+')[i] || o.owner.code } : o.owner, 28)}
        <div style="flex:1;min-width:0"><b>${esc(sl.origin)} → ${esc(sl.destination)}</b> <span class="small muted">${hhmm(sl.departingAt)}–${hhmm(sl.arrivingAt)}${dayDiff(sl.departingAt, sl.arrivingAt) > 0 ? ' +1' : ''}</span>
        <div class="when">${esc(fmtDay(sl.departingAt))} · ${dur(sl.minutes)} · ${sl.stops ? `${sl.stops} stop${sl.stops > 1 ? 's' : ''}` : 'Direct'}</div>
        <div class="leg-tags">${cabinTags(sl.cabins)}</div></div></div>`
    )
    .join('');
  const city = o.slices[0].destinationCity;
  return `<div class="panel">
    <div class="summary-img"><img src="${cityImg(o.slices[0].destinationCityCode || o.slices[0].destination, 800)}" alt="" /><b>${esc(city)}</b></div>
    <div class="summary-body">
      ${legs}
      <div class="lines">
        <div class="line-item"><span>Flights for ${esc(who)}</span><span>${money(o.total, o.currency, 2)}</span></div>
        <div class="line-item"><span>Nomad booking fee</span><span>${money(0, o.currency, 2)}</span></div>
        <div class="line-item total"><span>Total</span><span>${money(o.total, o.currency, 2)}</span></div>
        <div class="tiny muted" style="margin-top:6px">Includes all taxes and airline charges${n > 1 ? ` · ${money(o.total / n, o.currency, 2)} per traveller` : ''}.</div>
      </div>
      <div class="leg-tags" style="margin-top:12px">${o.refundable ? '<span class="tag good">Refundable</span>' : '<span class="tag">Non-refundable</span>'}${o.changeable ? '<span class="tag good">Changeable</span>' : '<span class="tag">No changes</span>'}${o.separateTickets ? '<span class="tag">2 separate tickets</span>' : ''}</div>
    </div></div>`;
}

// ---------------------------------------------------------------------------
// Step 1: travellers
// ---------------------------------------------------------------------------
export function renderTravellers(view) {
  const o = state.offer;
  if (!o) return go('#/results');
  const loyalty = (o.search && o.search.loyalty) || [];
  const contact = store.get('nomad.contact', {});
  const saved = state.travellers || [];
  const firstDep = o.slices[0].departingAt;

  const form = (p, i) => {
    const l = paxLabel(p, i, o);
    const adultIndex = o.passengers.slice(0, i).filter((x) => x.type === 'adult').length;
    const loy = p.type === 'adult' ? loyalty.find((x) => Number(x.adult) === adultIndex) : null;
    const v = saved[i] || {
      givenName: loy ? loy.givenName : i === 0 ? contact.givenName || '' : '',
      familyName: loy ? loy.familyName : i === 0 ? contact.familyName || '' : '',
      email: i === 0 ? contact.email || '' : '',
      phone: i === 0 ? contact.phone || '' : '',
      title: p.type === 'adult' ? 'mr' : 'miss',
      gender: 'm',
      bornOn: '',
    };
    const titles = p.type === 'adult' ? TITLES_ADULT : TITLES_CHILD;
    return `<div class="panel" data-pax="${i}">
      <div class="trav-head"><div class="avatar">${i + 1}</div><div><h3>${esc(l.title)}</h3><div class="small muted">${esc(l.sub)}${loy ? ` · ${esc(loy.airline)} member ${esc(loy.number)}` : ''}</div></div></div>
      <div class="form-grid">
        <div class="fg w1"><label>Title</label><select name="title">${titles.map(([k, t]) => `<option value="${k}" ${v.title === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="fg w3" style="grid-column:span 2"><label>First and middle names</label><input class="input" name="givenName" value="${esc(v.givenName)}" autocomplete="given-name" /><div class="err"></div></div>
        <div class="fg w3" style="grid-column:span 3"><label>Last name</label><input class="input" name="familyName" value="${esc(v.familyName)}" autocomplete="family-name" /><div class="err"></div></div>
        <div class="fg w3"><label>Date of birth</label><input class="input" type="date" name="bornOn" value="${esc(v.bornOn)}" max="${new Date().toISOString().slice(0, 10)}" /><div class="err"></div></div>
        <div class="fg w3"><label>Gender (as on passport)</label><select name="gender"><option value="m" ${v.gender === 'm' ? 'selected' : ''}>Male</option><option value="f" ${v.gender === 'f' ? 'selected' : ''}>Female</option></select></div>
        ${i === 0 ? `
        <div class="fg w3"><label>Email</label><input class="input" type="email" name="email" value="${esc(v.email)}" autocomplete="email" /><div class="err"></div></div>
        <div class="fg w3"><label>Mobile (with country code)</label><input class="input" name="phone" value="${esc(v.phone)}" placeholder="+44 20 8016 0509" autocomplete="tel" /><div class="err"></div></div>` : ''}
      </div>
      <p class="tiny muted" style="margin:10px 0 0">Enter names exactly as they appear on the passport.</p>
    </div>`;
  };

  view.innerHTML = `
    <div class="wrap page-head"><a href="#/results" class="small muted">← Back to flights</a><h1>Who’s travelling?</h1>${steps(0)}</div>
    <div class="wrap checkout">
      <form id="trav" novalidate>
        ${o.expiresAt ? `<div class="notice info">This price is held until ${new Date(o.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Complete your booking before then.</div>` : ''}
        ${o.passengers.map(form).join('')}
        <div style="display:flex;justify-content:flex-end;gap:10px"><button class="btn btn-brass" type="submit" style="min-width:220px">Continue to payment</button></div>
      </form>
      <aside class="summary">${summaryHtml(o)}</aside>
    </div>`;

  const setErr = (panel, name, msg) => {
    const el = $(`[name=${name}]`, panel);
    const fg = el.closest('.fg');
    fg.classList.toggle('bad', Boolean(msg));
    const e = $('.err', fg);
    if (e) e.textContent = msg || '';
    return !msg;
  };

  $('#trav', view).addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    const out = [];
    $$('[data-pax]', view).forEach((panel) => {
      const i = Number(panel.dataset.pax);
      const p = o.passengers[i];
      const get = (n) => {
        const el = $(`[name=${n}]`, panel);
        return el ? el.value.trim() : '';
      };
      const t = { title: get('title'), givenName: get('givenName'), familyName: get('familyName'), bornOn: get('bornOn'), gender: get('gender'), email: get('email'), phone: get('phone').replace(/[\s()-]/g, '') };
      const nameRe = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{1,40}$/;
      ok = setErr(panel, 'givenName', !t.givenName ? 'Required' : !nameRe.test(t.givenName) ? 'Use letters only' : '') && ok;
      ok = setErr(panel, 'familyName', !t.familyName ? 'Required' : !nameRe.test(t.familyName) ? 'Use letters only' : '') && ok;
      let dobMsg = '';
      if (!t.bornOn) dobMsg = 'Required';
      else {
        const age = ageOn(t.bornOn, firstDep);
        if (p.type === 'adult' && age < 18) dobMsg = `Adults must be 18 or over on ${fmtDay(firstDep)}`;
        if (p.type === 'infant_without_seat' && age >= 2) dobMsg = 'Infants must be under 2 on the day of travel';
        if (p.type !== 'adult' && p.type !== 'infant_without_seat' && p.age != null && age !== p.age) dobMsg = `You searched for a child aged ${p.age}. This date makes them ${age} on ${fmtDay(firstDep)}.`;
      }
      ok = setErr(panel, 'bornOn', dobMsg) && ok;
      if (i === 0) {
        ok = setErr(panel, 'email', /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.email) ? '' : 'Enter a valid email') && ok;
        ok = setErr(panel, 'phone', /^\+\d{7,15}$/.test(t.phone) ? '' : 'Start with + and the country code') && ok;
      }
      out.push(t);
    });
    if (!ok) {
      const bad = $('.fg.bad', view);
      if (bad) bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return toast('Please check the highlighted details.', 'err');
    }
    store.set('nomad.contact', { givenName: out[0].givenName, familyName: out[0].familyName, email: out[0].email, phone: out[0].phone });
    state.travellers = out;
    persist('travellers');
    go('#/payment');
  });
}

// ---------------------------------------------------------------------------
// Step 2: payment (methods are simulated; Duffel takes payment from the test balance)
// ---------------------------------------------------------------------------
const luhn = (num) => {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return num.length >= 13 && sum % 10 === 0;
};
const brand = (n) => (/^4/.test(n) ? 'VISA' : /^(5[1-5]|2[2-7])/.test(n) ? 'MASTERCARD' : /^3[47]/.test(n) ? 'AMEX' : '');

export function renderPayment(view) {
  const o = state.offer;
  const t = state.travellers;
  if (!o) return go('#/results');
  if (!t) return go('#/checkout');
  const canHold = !o.requiresInstantPayment && !o.separateTickets;
  const methods = [
    ['card', 'Card', 'Visa, Mastercard, Amex'],
    ['apple', 'Apple Pay', 'Pay with Face ID'],
    ['google', 'Google Pay', 'Pay with your Google account'],
    ['paypal', 'PayPal', 'Log in to pay'],
    ...(canHold ? [['later', 'Pay later', o.paymentRequiredBy ? `Hold until ${fmtDay(o.paymentRequiredBy)}` : 'Hold the booking']] : []),
    ['balance', 'Agency balance', 'Duffel balance'],
  ];
  let method = 'card';
  const lead = t[0];

  view.innerHTML = `
    <div class="wrap page-head"><a href="#/checkout" class="small muted">← Back to travellers</a><h1>Payment</h1>${steps(1)}</div>
    <div class="wrap checkout">
      <div>
        <div class="panel">
          <h3>How would you like to pay?</h3>
          <p class="panel-sub">Test mode: no method here is charged. Duffel takes payment from your test balance.</p>
          <div class="pay-methods">${methods.map(([k, nm, sub]) => `<button type="button" class="pm ${k === method ? 'on' : ''}" data-m="${k}"><span class="pm-ico">${PAY_ICON[k === 'card' ? 'card' : k]}</span><b>${nm}</b><span>${esc(sub)}</span></button>`).join('')}</div>
          <div id="method-body"></div>
        </div>
        <div class="panel">
          <h3>Travellers</h3>
          ${t.map((x, i) => `<div class="small" style="padding:4px 0">${i + 1}. ${esc(x.title[0].toUpperCase() + x.title.slice(1))} ${esc(x.givenName)} ${esc(x.familyName)} <span class="muted">· born ${esc(fmtDay(x.bornOn, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></div>`).join('')}
          <div class="small muted" style="margin-top:6px">Tickets go to ${esc(lead.email)}</div>
        </div>
        <label class="check small" style="margin:4px 0 16px"><input type="checkbox" id="terms" /> I accept the airline’s fare rules and Nomad’s terms.</label>
        <button type="button" class="btn btn-brass" id="pay" style="width:100%;padding:15px;font-size:16px"></button>
        <div class="secure">${ICON.lock} Payments are encrypted. This is a test environment.</div>
      </div>
      <aside class="summary">${summaryHtml(o)}</aside>
    </div>`;

  const body = $('#method-body', view);
  const payBtn = $('#pay', view);
  const card = { number: '4242 4242 4242 4242', name: `${lead.givenName} ${lead.familyName}`.toUpperCase(), exp: '12/29', cvc: '123' };

  function paintMethod() {
    $$('[data-m]', view).forEach((b) => b.classList.toggle('on', b.dataset.m === method));
    const total = money(o.total, o.currency, 2);
    payBtn.textContent = method === 'later' ? 'Hold my booking' : `Pay ${total}`;
    if (method === 'card') {
      const digits = card.number.replace(/\D/g, '');
      body.innerHTML = `
        <div class="card-preview"><div class="row"><span class="chip-ico"></span><span>${brand(digits)}</span></div>
          <div class="num">${esc(card.number || '•••• •••• •••• ••••')}</div>
          <div class="row"><span>${esc(card.name || 'NAME ON CARD')}</span><span>${esc(card.exp || 'MM/YY')}</span></div></div>
        <div class="form-grid">
          <div class="fg w6"><label>Card number</label><input class="input" data-c="number" inputmode="numeric" value="${esc(card.number)}" autocomplete="cc-number" /><div class="err"></div></div>
          <div class="fg w6"><label>Name on card</label><input class="input" data-c="name" value="${esc(card.name)}" autocomplete="cc-name" /><div class="err"></div></div>
          <div class="fg w3"><label>Expiry (MM/YY)</label><input class="input" data-c="exp" value="${esc(card.exp)}" autocomplete="cc-exp" /><div class="err"></div></div>
          <div class="fg w3"><label>Security code</label><input class="input" data-c="cvc" inputmode="numeric" value="${esc(card.cvc)}" autocomplete="cc-csc" /><div class="err"></div></div>
        </div>
        <p class="tiny muted" style="margin:10px 0 0">Test card filled in. Any valid card number works; nothing is charged.</p>`;
    } else if (method === 'apple' || method === 'google' || method === 'paypal') {
      const nm = { apple: 'Apple Pay', google: 'Google Pay', paypal: 'PayPal' }[method];
      body.innerHTML = `<div class="wallet-box">You’ll confirm ${total} with ${nm}.<br /><button type="button" class="wallet-btn ${method === 'paypal' ? 'paypal' : method === 'google' ? 'gpay' : ''}" data-wallet>${PAY_ICON[method]} Pay with ${nm}</button></div>`;
    } else if (method === 'later') {
      body.innerHTML = `<div class="notice">We hold your seats and price now. Pay from My bookings before <b>${esc(o.paymentRequiredBy ? new Date(o.paymentRequiredBy).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'the airline’s deadline')}</b>, or the booking is released.</div>`;
    } else {
      body.innerHTML = `<div class="notice info">The booking is paid straight from your Duffel balance. This is how every method on this page settles in test mode.</div>`;
    }
  }

  view.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) {
      method = m.dataset.m;
      paintMethod();
    }
    if (e.target.closest('[data-wallet]')) pay();
  });
  view.addEventListener('input', (e) => {
    const k = e.target.dataset.c;
    if (!k) return;
    let v = e.target.value;
    if (k === 'number') v = v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
    if (k === 'exp') v = v.replace(/\D/g, '').slice(0, 4).replace(/^(\d{2})(\d)/, '$1/$2');
    if (k === 'cvc') v = v.replace(/\D/g, '').slice(0, 4);
    if (k === 'name') v = v.toUpperCase();
    e.target.value = v;
    card[k] = v;
    const prev = $('.card-preview', view);
    if (prev) {
      const digits = card.number.replace(/\D/g, '');
      $('.num', prev).textContent = card.number || '•••• •••• •••• ••••';
      $$('.row span', prev)[1].textContent = brand(digits);
      $$('.row span', prev)[2].textContent = card.name || 'NAME ON CARD';
      $$('.row span', prev)[3].textContent = card.exp || 'MM/YY';
    }
  });

  function validCard() {
    let ok = true;
    const set = (k, msg) => {
      const el = $(`[data-c=${k}]`, view);
      el.closest('.fg').classList.toggle('bad', Boolean(msg));
      $('.err', el.closest('.fg')).textContent = msg || '';
      if (msg) ok = false;
    };
    const digits = card.number.replace(/\D/g, '');
    set('number', luhn(digits) ? '' : 'This card number is not valid');
    set('name', card.name.trim().length > 2 ? '' : 'Required');
    const [mm, yy] = card.exp.split('/').map(Number);
    const expOk = mm >= 1 && mm <= 12 && yy >= 0 && new Date(2000 + yy, mm, 1) > new Date();
    set('exp', expOk ? '' : 'Enter a future date as MM/YY');
    set('cvc', /^\d{3,4}$/.test(card.cvc) ? '' : '3 or 4 digits');
    return ok;
  }

  async function pay() {
    if (!$('#terms', view).checked) return toast('Please accept the fare rules and terms.', 'err');
    if (method === 'card' && !validCard()) return;
    const steps = {
      card: ['Authorising your card…', 'Confirming with the airline…'],
      apple: ['Waiting for Apple Pay…', 'Confirming with the airline…'],
      google: ['Waiting for Google Pay…', 'Confirming with the airline…'],
      paypal: ['Opening PayPal…', 'Confirming with the airline…'],
      later: ['Holding your seats…', 'Confirming with the airline…'],
      balance: ['Charging agency balance…', 'Confirming with the airline…'],
    }[method];
    const p = processing(steps[0]);
    payBtn.disabled = true;
    try {
      await wait(900);
      p.set(steps[1]);
      const r = await api('POST', '/api/orders', { offerId: o.id, travellers: t, payLater: method === 'later', shownTotal: o.total });
      state.confirmation = { orders: r.orders, held: r.held, method, offer: o };
      persist('confirmation');
      state.offer = null;
      state.results = null;
      persist('offer');
      persist('results');
      p.close();
      go('#/confirmation');
    } catch (e) {
      p.close();
      payBtn.disabled = false;
      const expired = /expired|no longer available|not available/i.test(e.message);
      toast(expired ? `${e.message} Please search again for a fresh price.` : e.message, 'err');
    }
  }

  payBtn.addEventListener('click', pay);
  paintMethod();
}

// ---------------------------------------------------------------------------
// Step 3: confirmation
// ---------------------------------------------------------------------------
export function renderConfirmation(view) {
  const c = state.confirmation;
  if (!c) return go('#/trips');
  const first = c.orders[0];
  const city = (c.offer && c.offer.search && c.offer.search.to && c.offer.search.to.name) || first.slices[0].destinationCity;
  const methodName = { card: 'card', apple: 'Apple Pay', google: 'Google Pay', paypal: 'PayPal', later: 'pay later', balance: 'agency balance' }[c.method];
  view.innerHTML = `
    <section class="band" style="height:200px"><img src="${cityImg(first.slices[0].destinationCityCode || first.slices[0].destination, 1800)}" alt="" /></section>
    <div class="wrap">
      <div class="confirm-hero">
        <div class="tick">${ICON.check}</div>
        <h1>${c.held ? 'Your seats are held' : `You’re going to ${esc(city)}`}</h1>
        <p class="muted">${c.held ? 'Pay from My bookings before the deadline to keep them.' : `Paid by ${esc(methodName)}. Confirmation sent to ${esc(first.passengers[0] && first.passengers[0].email ? first.passengers[0].email : 'the lead traveller')}.`}</p>
        <div class="ref-box">${c.orders.map((o, i) => `<div><div class="ref-label">${c.orders.length > 1 ? (i === 0 ? 'Outbound ticket' : 'Return ticket') : 'Booking reference'}</div><div class="ref">${esc(o.reference)}</div></div>`).join('')}</div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          ${c.orders.map((o, i) => `<a class="btn btn-primary" href="#/trip/${esc(o.id)}">Manage ${c.orders.length > 1 ? (i === 0 ? 'outbound' : 'return') : 'booking'}</a>`).join('')}
          <a class="btn btn-ghost" href="#/">Book another trip</a>
        </div>
      </div>
      <div style="max-width:720px;margin:0 auto 60px">
        ${c.orders.map((o) => `<div class="panel">${o.slices.map((sl) => `
          <div class="itin-leg"><div><div class="route">${esc(sl.originCity)} → ${esc(sl.destinationCity)}</div>
          <div class="small muted">${esc(fmtDay(sl.departingAt, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${hhmm(sl.departingAt)} – ${hhmm(sl.arrivingAt)} · ${sl.stops ? `${sl.stops} stop${sl.stops > 1 ? 's' : ''}` : 'Direct'}</div>
          <div class="leg-tags">${cabinTags(sl.cabins)}</div></div>${logoHtml(o.owner)}</div>`).join('')}
          <div class="lines"><div class="line-item total"><span>${esc(o.owner.name)} · ${o.passengers.length} traveller${o.passengers.length > 1 ? 's' : ''}</span><span>${money(o.total, o.currency, 2)}</span></div></div></div>`).join('')}
      </div>
    </div>`;
}
