// My bookings and Manage booking.
import { $, $$, esc, api, toast, fmtDay, hhmm, dur, money, ICON, CABIN_LABEL, cityImg, store, modal, processing, wait, ymd, today, addDays } from './util.js';
import { go } from './state.js';
import { logoHtml, cabinTags } from './results.js';
import { createCalendar } from './calendar.js';

function status(o) {
  if (o.cancelledAt) return ['cancelled', 'Cancelled'];
  if (o.awaitingPayment) return ['pending', 'Awaiting payment'];
  const last = o.slices[o.slices.length - 1];
  if (last && last.arrivingAt && last.arrivingAt.slice(0, 10) < ymd(today())) return ['past', 'Completed'];
  return ['', 'Confirmed'];
}

function title(o) {
  const a = o.slices[0];
  if (!a) return 'Trip';
  const back = o.slices.length > 1 && o.slices[o.slices.length - 1].destination === a.origin;
  return `${a.originCity} ${back ? '⇄' : '→'} ${a.destinationCity}`;
}

// ---------------------------------------------------------------------------
// My bookings
// ---------------------------------------------------------------------------
export function renderTrips(view) {
  view.innerHTML = `
    <div class="wrap page-head"><p class="eyebrow" style="margin:0 0 6px">Manage</p><h1>My bookings</h1></div>
    <div class="wrap" style="padding-bottom:70px">
      <form class="find" id="find">
        <div class="fg"><label>Booking reference</label><input class="input" name="reference" placeholder="e.g. EJJNER" maxlength="8" style="text-transform:uppercase" /></div>
        <div class="fg"><label>Last name</label><input class="input" name="lastName" placeholder="As on the booking" /></div>
        <button class="btn btn-primary" type="submit">Find booking</button>
      </form>
      <div id="trips"><div class="skeleton"></div><div class="skeleton"></div></div>
    </div>`;

  $('#find', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.reference || !f.lastName) return toast('Enter the booking reference and last name.', 'err');
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/orders/lookup', f);
      go(`#/trip/${r.order.id}`);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  let alive = true;
  api('GET', '/api/orders')
    .then((r) => {
      if (!alive) return;
      const box = $('#trips', view);
      if (!r.orders.length) {
        box.innerHTML = `<div class="empty"><h3>No bookings yet</h3><p>Your trips will appear here.</p><a class="btn btn-primary" href="#/">Find a flight</a></div>`;
        return;
      }
      const dep = (o) => (o.slices[0] && o.slices[0].departingAt) || '';
      const upcoming = r.orders.filter((o) => !o.cancelledAt && status(o)[0] !== 'past').sort((x, y) => dep(x).localeCompare(dep(y)));
      const cancelled = r.orders.filter((o) => o.cancelledAt).sort((x, y) => String(y.cancelledAt).localeCompare(String(x.cancelledAt)));
      const completed = r.orders.filter((o) => !o.cancelledAt && status(o)[0] === 'past').sort((x, y) => dep(y).localeCompare(dep(x)));
      const card = (o) => {
        const [cls, label] = status(o);
        const a = o.slices[0];
        return `<a class="trip-card" href="#/trip/${esc(o.id)}">
          <div class="img"><img loading="lazy" src="${cityImg(a ? a.destinationCityCode || a.destination : '', 700)}" alt="" /><span class="status ${cls}">${label}</span></div>
          <div class="body"><h3>${esc(title(o))}</h3>
            <div class="small muted">${a ? esc(fmtDay(a.departingAt, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}${o.slices.length > 1 ? ` – ${esc(fmtDay(o.slices[o.slices.length - 1].departingAt, { day: 'numeric', month: 'short' }))}` : ''} · ${o.passengers.length} traveller${o.passengers.length > 1 ? 's' : ''}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px"><span class="small"><span class="muted">Ref</span> <b style="letter-spacing:.08em">${esc(o.reference)}</b></span>${logoHtml(o.owner, 24)}</div>
          </div></a>`;
      };
      const section = (name, list, empty, first) =>
        `<section class="trip-group" data-group="${name.toLowerCase()}">
          <h2 class="serif" style="font-weight:400;font-size:24px;margin:${first ? 0 : 34}px 0 12px">${name} <span class="muted small" style="font-family:Inter,sans-serif">${list.length}</span></h2>
          ${list.length ? `<div class="trips">${list.map(card).join('')}</div>` : `<p class="small muted" style="margin:0">${empty}</p>`}
        </section>`;
      box.innerHTML =
        section('Upcoming', upcoming, 'No upcoming trips. <a href="#/">Find a flight</a>.', true) +
        section('Cancelled', cancelled, 'No cancelled bookings.') +
        (completed.length ? section('Completed', completed, '') : '');
    })
    .catch((e) => {
      if (alive) $('#trips', view).innerHTML = `<div class="notice bad">${esc(e.message)}</div>`;
    });
  return () => {
    alive = false;
  };
}

// ---------------------------------------------------------------------------
// Manage booking
// ---------------------------------------------------------------------------
// Duffel's API cannot rename passengers: airlines do this by hand. Nomad records the request
// in this browser and shows it as pending, so the flow can be tested end to end.
const titleCase = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
const nameRequests = () => store.get('nomad.nameRequests', []);

export function renderManage(view, id) {
  view.innerHTML = `<div class="loading" style="padding:120px 0"><div class="spinner"></div>Loading your booking…</div>`;
  let alive = true;
  let order = null;

  async function load() {
    try {
      const r = await api('GET', `/api/orders/${encodeURIComponent(id)}`);
      if (!alive) return;
      order = r.order;
      paint();
    } catch (e) {
      if (alive) view.innerHTML = `<div class="wrap empty"><h3>We couldn’t load this booking</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/trips">My bookings</a></div>`;
    }
  }

  function paint() {
    const o = order;
    const [cls, label] = status(o);
    const live = !o.cancelledAt && cls !== 'past';
    const canChange = live && o.actions.includes('change');
    const canCancel = live && o.actions.includes('cancel');
    const reqs = nameRequests().filter((r) => r.orderId === o.id);
    const a = o.slices[0];
    const refund = o.conditions.refund_before_departure;
    const change = o.conditions.change_before_departure;

    view.innerHTML = `
      <section class="band"><img src="${cityImg(a ? a.destinationCityCode || a.destination : '', 1800)}" alt="" />
        <div class="wrap"><p class="eyebrow" style="margin:0 0 6px">Booking ${esc(o.reference)}</p><h1>${esc(title(o))}</h1>
          <div class="meta"><span class="status ${cls}">${label}</span><span>${o.passengers.length} traveller${o.passengers.length > 1 ? 's' : ''}</span><span class="dot">•</span><span>${esc(o.owner.name)}</span></div>
          <a href="#/trips" class="btn btn-ghost btn-sm edit">All bookings</a></div>
      </section>
      <div class="wrap manage">
        <div>
          ${o.awaitingPayment && live ? `<div class="notice">This booking is on hold. Pay before ${esc(new Date(o.paymentRequiredBy).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))} or the airline releases the seats.</div>` : ''}
          <div class="panel"><h3>Itinerary</h3><p class="panel-sub">${o.changes ? `Changed ${o.changes} time${o.changes > 1 ? 's' : ''}. ` : ''}Times are local to each airport.</p>
            ${o.slices.map((sl) => `
              <div class="itin-leg">
                <div><div class="route">${esc(sl.originCity)} → ${esc(sl.destinationCity)}</div>
                  <div class="small muted">${esc(fmtDay(sl.departingAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} · ${hhmm(sl.departingAt)} – ${hhmm(sl.arrivingAt)}${sl.minutes ? ` · ${dur(sl.minutes)}` : ''} · ${sl.stops ? `${sl.stops} stop${sl.stops > 1 ? 's' : ''}` : 'Direct'}</div>
                  <div class="tiny muted">${sl.segments.map((g) => `${esc(g.flight)} ${esc(g.from)}–${esc(g.to)}${g.aircraft ? ` (${esc(g.aircraft)})` : ''}`).join(' · ')}</div>
                  <div class="leg-tags">${cabinTags(sl.cabins)}</div></div>
                ${canChange && sl.changeable ? `<button type="button" class="btn btn-ghost btn-sm" data-change="${esc(sl.id)}">Change date or cabin</button>` : ''}
              </div>`).join('')}
          </div>
          <div class="panel"><h3>Travellers</h3>
            <div class="trav-list">${o.passengers.map((p) => {
              const req = reqs.find((r) => r.passengerId === p.id);
              return `<div class="trav"><div class="avatar">${esc((p.givenName || '?')[0])}</div>
                <div class="grow"><b>${esc(titleCase(p.title))} ${esc(p.givenName)} ${esc(p.familyName)}</b>
                  <div class="small muted">${p.bornOn ? `Born ${esc(fmtDay(p.bornOn, { day: 'numeric', month: 'short', year: 'numeric' }))}` : ''}${p.email ? ` · ${esc(p.email)}` : ''}</div>
                  ${req ? `<div class="leg-tags"><span class="tag warn">Name correction requested: ${esc(req.givenName)} ${esc(req.familyName)}</span></div>` : ''}</div>
                ${live ? `<button type="button" class="btn btn-ghost btn-sm" data-rename="${esc(p.id)}">Correct name</button>` : ''}</div>`;
            }).join('')}</div>
          </div>
        </div>
        <aside>
          <div class="panel">
            <h3>${money(o.total, o.currency, 2)}</h3><p class="panel-sub">${o.awaitingPayment ? 'Not paid yet' : 'Paid'} · booked ${esc(fmtDay(o.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }))}</p>
            <div class="actions">
              ${o.awaitingPayment && live ? `<button type="button" class="btn btn-brass" id="pay-now">Pay ${money(o.total, o.currency, 2)} now</button>` : ''}
              ${canCancel ? '<button type="button" class="btn btn-ghost" id="cancel" style="color:var(--rose);border-color:#f0cbc6">Cancel booking</button>' : ''}
              ${!live ? `<div class="small muted">${o.cancelledAt ? `Cancelled on ${esc(fmtDay(o.cancelledAt, { day: 'numeric', month: 'short', year: 'numeric' }))}.` : 'This trip has finished.'}</div>` : ''}
            </div>
          </div>
          <div class="panel"><h3>Fare rules</h3>
            <div class="small" style="padding:4px 0">${!refund ? 'Refund rules not published by the airline. Cancel to see your exact refund.' : refund.allowed ? `Refundable${Number(refund.penalty_amount) ? ` for a ${money(refund.penalty_amount, refund.penalty_currency, 2)} fee` : ' with no fee'}` : 'Not refundable. Taxes may be returned.'}</div>
            <div class="small" style="padding:4px 0">${!change ? (canChange ? 'Change rules not published. The airline quotes a price for each change.' : 'Changes not offered online.') : change.allowed ? `Changes allowed${Number(change.penalty_amount) ? ` for a ${money(change.penalty_amount, change.penalty_currency, 2)} fee plus any fare difference` : ' plus any fare difference'}` : 'Changes not allowed.'}</div>
          </div>
        </aside>
      </div>`;
  }

  // ---------- Actions ----------
  view.addEventListener('click', (e) => {
    if (!order) return;
    if (e.target.id === 'cancel') return cancelFlow();
    if (e.target.id === 'pay-now') return payNow(e.target);
    const ch = e.target.closest('[data-change]');
    if (ch) return changeFlow(order.slices.find((s) => s.id === ch.dataset.change));
    const rn = e.target.closest('[data-rename]');
    if (rn) return renameFlow(order.passengers.find((p) => p.id === rn.dataset.rename));
  });

  async function payNow(btn) {
    btn.disabled = true;
    const p = processing('Taking payment…');
    try {
      await wait(700);
      const r = await api('POST', `/api/orders/${order.id}/pay`);
      order = r.order;
      p.close();
      toast('Paid. Your booking is confirmed.', 'ok');
      paint();
    } catch (err) {
      p.close();
      btn.disabled = false;
      toast(err.message, 'err');
    }
  }

  async function cancelFlow() {
    const m = modal({ title: 'Cancel this booking?', body: '<div class="loading" style="padding:20px 0"><div class="spinner"></div>Asking the airline for your refund…</div>' });
    try {
      const q = await api('POST', `/api/orders/${order.id}/cancellation`);
      const amount = Number(q.refundAmount || 0);
      const to = { original_form_of_payment: 'your original payment method', balance: 'your Duffel balance', airline_credits: 'airline credit', voucher: 'a voucher' }[q.refundTo] || q.refundTo || 'your original payment method';
      m.body.innerHTML = `
        <p>If you cancel now you get back:</p>
        <div class="price" style="margin:6px 0 4px">${money(amount, q.refundCurrency || order.currency, 2)}</div>
        <p class="small muted">Refunded to ${esc(to)}.${q.expiresAt ? ` This quote is valid until ${esc(new Date(q.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}.` : ''}</p>
        <p class="small">All ${order.passengers.length} traveller${order.passengers.length > 1 ? 's' : ''} and every flight on booking <b>${esc(order.reference)}</b> are cancelled. This can’t be undone.</p>`;
      const keep = document.createElement('button');
      keep.className = 'btn btn-ghost';
      keep.textContent = 'Keep booking';
      keep.onclick = m.close;
      const go2 = document.createElement('button');
      go2.className = 'btn btn-danger';
      go2.textContent = 'Cancel booking';
      go2.onclick = async () => {
        go2.disabled = true;
        try {
          const c = await api('POST', `/api/cancellations/${q.id}/confirm`);
          m.close();
          toast(`Cancelled. ${money(Number(c.refundAmount || 0), c.refundCurrency || order.currency, 2)} is on its way back.`, 'ok');
          load();
        } catch (err) {
          go2.disabled = false;
          toast(err.message, 'err');
        }
      };
      m.foot.append(keep, go2);
    } catch (err) {
      m.body.innerHTML = `<div class="notice bad">${esc(err.message)}</div>`;
    }
  }

  function changeFlow(sl) {
    const box = document.createElement('div');
    let date = sl.departingAt.slice(0, 10);
    let cabin = sl.cabins[0] || 'economy';
    let picked = null;
    let options = [];
    box.innerHTML = `
      <p class="small muted" style="margin-top:0">${esc(sl.originCity)} → ${esc(sl.destinationCity)} · now ${esc(fmtDay(sl.departingAt, { weekday: 'short', day: 'numeric', month: 'short' }))} in ${esc(CABIN_LABEL[cabin])}</p>
      <div class="form-grid">
        <div class="fg w3"><label>New date</label><div class="field date-btn" role="button" tabindex="0" id="cd"><span class="value" style="font-weight:600"></span></div></div>
        <div class="fg w3"><label>Cabin</label><select id="cc">${['economy', 'premium_economy', 'business', 'first'].map((c) => `<option value="${c}" ${c === cabin ? 'selected' : ''}>${CABIN_LABEL[c]}</option>`).join('')}</select></div>
      </div>
      <div id="cal-slot"></div>
      <div style="margin-top:14px"><button type="button" class="btn btn-primary" id="find-opts">Find flights</button></div>
      <div id="opts" style="margin-top:14px"></div>`;
    const m = modal({ title: 'Change your flight', body: box });
    const paintDate = () => {
      $('#cd .value', box).textContent = fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' });
    };
    paintDate();
    $('#cd', box).addEventListener('click', () => {
      const slot = $('#cal-slot', box);
      if (slot.firstChild) return (slot.innerHTML = '');
      slot.appendChild(
        createCalendar({
          mode: 'single',
          inline: true,
          start: date,
          min: ymd(addDays(today(), 1)),
          onChange: (d) => {
            if (d) date = d;
            paintDate();
          },
          onDone: () => (slot.innerHTML = ''),
        })
      );
    });
    $('#cc', box).addEventListener('change', (e) => (cabin = e.target.value));

    $('#find-opts', box).addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      picked = null;
      $('#opts', box).innerHTML = '<div class="loading" style="padding:20px 0"><div class="spinner"></div>Asking the airline for options…</div>';
      try {
        const r = await api('POST', `/api/orders/${order.id}/change-options`, { sliceId: sl.id, date, cabin });
        options = r.options;
        const head = options.length && !r.anyMatch ? `<div class="notice">The airline has no ${esc(CABIN_LABEL[cabin])} seats that day. These are the other cabins it offers.</div>` : '';
        $('#opts', box).innerHTML = options.length
          ? head + options
              .map((c, i) => {
                const s2 = c.slices[0];
                const cost = c.changeTotal > 0 ? `+${money(c.changeTotal, c.currency, 2)}` : c.changeTotal < 0 ? `${money(c.changeTotal, c.currency, 2)} back` : 'No extra cost';
                return `<div class="change-opt" data-opt="${i}"><div><b>${hhmm(s2.departingAt)} – ${hhmm(s2.arrivingAt)}</b> <span class="small muted">${esc(s2.flights.join(', '))} · ${s2.stops ? `${s2.stops} stop` : 'Direct'}</span>
                  <div class="leg-tags">${cabinTags(s2.cabins)}${c.penalty ? `<span class="tag">Includes ${money(c.penalty, c.currency, 2)} fee</span>` : ''}</div></div>
                  <div class="cost">${cost}<div class="tiny muted">New total ${money(c.newTotal, c.currency, 2)}</div></div></div>`;
              })
              .join('')
          : '<div class="notice">The airline has no flights to offer on that date. Try another date.</div>';
      } catch (err) {
        $('#opts', box).innerHTML = `<div class="notice bad">${esc(err.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });

    $('#opts', box).addEventListener('click', (e) => {
      const row = e.target.closest('[data-opt]');
      if (!row) return;
      picked = options[Number(row.dataset.opt)];
      $$('.change-opt', box).forEach((r) => r.classList.toggle('on', r === row));
      let btn = $('#confirm-change', m.foot);
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'confirm-change';
        btn.className = 'btn btn-brass';
        m.foot.appendChild(btn);
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const p = processing(picked.changeTotal > 0 ? `Paying ${money(picked.changeTotal, picked.currency, 2)}…` : 'Changing your flight…');
          try {
            await api('POST', '/api/order-changes', { optionId: picked.id });
            p.close();
            m.close();
            toast('Your flight has been changed.', 'ok');
            load();
          } catch (err) {
            p.close();
            btn.disabled = false;
            toast(err.message, 'err');
          }
        });
      }
      btn.textContent = picked.changeTotal > 0 ? `Pay ${money(picked.changeTotal, picked.currency, 2)} and change` : 'Confirm change';
    });
  }

  function renameFlow(p) {
    const box = document.createElement('div');
    box.innerHTML = `
      <div class="notice info">Airlines fix name mistakes by hand, and Duffel’s API cannot change a name. Nomad records your request and shows it as pending. This step is simulated.</div>
      <div class="form-grid">
        <div class="fg w3"><label>First and middle names</label><input class="input" id="rg" value="${esc(p.givenName)}" /></div>
        <div class="fg w3"><label>Last name</label><input class="input" id="rf" value="${esc(p.familyName)}" /></div>
        <div class="fg w6"><label>What’s wrong?</label><select id="rr"><option>Spelling mistake</option><option>Missing middle name</option><option>Name changed (marriage or deed poll)</option><option>First and last name swapped</option></select></div>
      </div>`;
    modal({
      title: `Correct ${p.givenName}’s name`,
      body: box,
      actions: [
        { label: 'Not now' },
        {
          label: 'Send request',
          cls: 'btn-primary',
          onClick: (close) => {
            const g = $('#rg', box).value.trim();
            const f = $('#rf', box).value.trim();
            if (!g || !f) return toast('Enter both names.', 'err');
            const list = nameRequests().filter((r) => !(r.orderId === order.id && r.passengerId === p.id));
            list.push({ orderId: order.id, passengerId: p.id, givenName: g, familyName: f, reason: $('#rr', box).value, at: Date.now() });
            store.set('nomad.nameRequests', list);
            close();
            toast('Request recorded. In a live app, the airline would confirm within 48 hours.', 'ok');
            paint();
          },
        },
      ],
    });
  }

  load();
  return () => {
    alive = false;
  };
}
