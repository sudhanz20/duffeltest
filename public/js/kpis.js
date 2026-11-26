// Duffel supplier KPIs page: reads /api/kpis and draws a card with a sparkline per KPI.

const $ = (id) => document.getElementById(id);
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);
const secs = (v) => (v == null ? '—' : `${(v / 1000).toFixed(1)} s`);
const num = (v, d = 0) => (v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: d }));

// Sum counts over the period and work out period-wide rates from them.
function period(days) {
  const s = (f) => days.reduce((t, d) => t + (d[f] || 0), 0);
  const r = (a, b) => (b ? a / b : null);
  const timed = days.filter((d) => d.searchMsP95 != null);
  const worst = timed.length ? Math.max(...timed.map((d) => d.searchMsP95)) : null;
  const med = timed.length ? timed.map((d) => d.searchMsP50).sort((a, b) => a - b)[Math.floor(timed.length / 2)] : null;
  const errors = days.reduce((t, d) => t + (d.errorRate || 0) * d.duffelCalls, 0);
  const verified = days.reduce((t, d) => t + (d.webhookVerifiedRate || 0) * d.webhooks, 0);
  const sumMoney = (f) => {
    const out = {};
    for (const d of days) for (const [c, v] of Object.entries(d[f] || {})) out[c] = (out[c] || 0) + v;
    return out;
  };
  return {
    searchMsP50: med,
    searchMsP95: worst,
    errorRate: r(errors, s('duffelCalls')),
    orderSuccessRate: r(s('bookings'), s('bookAttempts')),
    searchesPerBooking: r(s('duffelSearches'), s('bookings')),
    offerExpiredRate: r(days.reduce((t, d) => t + (d.offerExpiredRate || 0) * d.bookAttempts, 0), s('bookAttempts')),
    priceChangeRate: r(days.reduce((t, d) => t + (d.priceChangeRate || 0) * d.bookings, 0), s('bookings')),
    offersPerSearch: r(days.reduce((t, d) => t + (d.offersPerSearch || 0) * d.searches, 0), s('searches')),
    bookings: s('bookings'),
    searches: s('searches'),
    heldPaidRate: r(s('heldPaid'), s('held')),
    cancellations: s('cancellations'),
    refunded: sumMoney('refunded'),
    scheduleChangesPer100: s('bookings') ? (100 * s('scheduleChanges')) / s('bookings') : null,
    webhookVerifiedRate: r(verified, s('webhooks')),
  };
}

function spark(values, bad) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return '<svg viewBox="0 0 100 44" aria-hidden="true"></svg>';
  const max = Math.max(...pts.map(([, v]) => v)) || 1;
  const n = values.length - 1 || 1;
  const xy = pts.map(([i, v]) => [(i / n) * 98 + 1, 40 - (v / max) * 34]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const [lx, ly] = xy[xy.length - 1];
  const color = bad ? 'var(--rose)' : 'var(--sky)';
  return `<svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="Daily trend">
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    <circle cx="${lx}" cy="${ly}" r="1.8" fill="${color}"/></svg>`;
}

function card({ label, value, series, hint, bad }) {
  const el = document.createElement('div');
  el.className = 'k-card';
  el.innerHTML = `<div class="k-label"></div><div class="k-value ${bad ? 'k-bad' : ''}"></div>${spark(series, bad)}<div class="k-hint"></div>`;
  el.querySelector('.k-label').textContent = label;
  el.querySelector('.k-value').textContent = value;
  el.querySelector('.k-hint').textContent = hint;
  return el;
}

function render(data) {
  const days = data.days;
  const p = period(days);
  const col = (f) => days.map((d) => d[f]);
  const money = Object.entries(p.refunded).map(([c, v]) => `${num(v, 2)} ${c}`).join(', ') || '0';

  $('g-reliability').replaceChildren(
    card({ label: 'Search time, median', value: secs(p.searchMsP50), series: col('searchMsP50'), hint: 'Typical wait for offers.' }),
    card({ label: 'Search time, slowest 5%', value: secs(p.searchMsP95), series: col('searchMsP95'), hint: 'Worst day in the period. Alert above 15 s.', bad: p.searchMsP95 > 15000 }),
    card({ label: 'Duffel error rate', value: pct(p.errorRate), series: col('errorRate'), hint: 'Share of Duffel calls that failed.', bad: p.errorRate > 0.01 }),
    card({ label: 'Order success rate', value: pct(p.orderSuccessRate), series: col('orderSuccessRate'), hint: 'Bookings created ÷ attempts.', bad: p.orderSuccessRate != null && p.orderSuccessRate < 0.97 })
  );
  $('g-conversion').replaceChildren(
    card({ label: 'Searches', value: num(p.searches), series: col('searches'), hint: 'Shopper searches in the period.' }),
    card({ label: 'Bookings', value: num(p.bookings), series: col('bookings'), hint: 'Orders confirmed or held.' }),
    card({ label: 'Duffel searches per booking', value: num(p.searchesPerBooking), series: col('searchesPerBooking'), hint: 'Duffel charges above 1,500.', bad: p.searchesPerBooking > 1500 }),
    card({ label: 'Offer expired at checkout', value: pct(p.offerExpiredRate), series: col('offerExpiredRate'), hint: 'Share of booking attempts.', bad: p.offerExpiredRate > 0.05 }),
    card({ label: 'Price changed at booking', value: pct(p.priceChangeRate), series: col('priceChangeRate'), hint: 'Final price differed from the price shown.', bad: p.priceChangeRate > 0.02 }),
    card({ label: 'Offers per search', value: num(p.offersPerSearch), series: col('offersPerSearch'), hint: 'How much choice Duffel returns.' })
  );
  $('g-after').replaceChildren(
    card({ label: 'Held orders paid', value: pct(p.heldPaidRate), series: col('heldPaid'), hint: 'Paid ÷ held, in the period.' }),
    card({ label: 'Cancellations', value: num(p.cancellations), series: col('cancellations'), hint: `Refunded: ${money}.` }),
    card({ label: 'Airline schedule changes', value: p.scheduleChangesPer100 == null ? '—' : `${num(p.scheduleChangesPer100, 1)} per 100`, series: col('scheduleChanges'), hint: 'From Duffel webhooks, per 100 bookings.' }),
    card({ label: 'Webhooks verified', value: pct(p.webhookVerifiedRate), series: col('webhookVerifiedRate'), hint: 'Share that passed the signature check.', bad: p.webhookVerifiedRate != null && p.webhookVerifiedRate < 0.99 })
  );

  const rows = data.routes.map((r) => {
    const tr = document.createElement('tr');
    for (const [v, cls] of [[r.route, ''], [num(r.searches), 'n'], [num(r.offersPerSearch, 1), 'n'], [num(r.airlinesPerSearch, 1), 'n']]) {
      const td = document.createElement('td');
      td.textContent = v;
      if (cls) td.className = cls;
      tr.append(td);
    }
    return tr;
  });
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="muted">No searches recorded in this period.</td>';
    rows.push(tr);
  }
  $('k-routes').replaceChildren(...rows);
}

async function load() {
  $('k-error').hidden = true;
  const mode = $('k-mode').value;
  const days = $('k-days').value;
  try {
    const res = await fetch(`/api/kpis?days=${days}&mode=${mode}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
    $('k-setup').hidden = data.enabled;
    $('k-test').hidden = data.mode !== 'test';
    render(data);
  } catch (e) {
    $('k-error').hidden = false;
    $('k-error').textContent = `Could not load the KPIs: ${e.message}`;
  }
}

fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    $('k-mode').value = s.testMode ? 'test' : 'live';
  })
  .catch(() => {})
  .finally(() => {
    $('k-mode').addEventListener('change', load);
    $('k-days').addEventListener('change', load);
    load();
  });
