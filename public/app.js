// Duffel playground front end. Plain JS, no build step.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), isErr ? 7000 : 3500);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// Run a button/form action with a busy state and error toast.
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());
const setField = (form, name, value) => { $(`[name="${name}"]`, form).value = value; };

// ---------------- Tabs ----------------
$$('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${b.dataset.tab}`));
  })
);

// Default dates: a few weeks ahead.
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
$('#flight-search [name=departure_date]').value = day(30);
$$('.port').forEach((el) => (el.textContent = location.port || '80'));
// On a public host (e.g. Vercel) Duffel can reach this page directly: no tunnel needed.
const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
if (!isLocal && location.protocol === 'https:') {
  $('#wh-create [name=url]').value = location.origin;
  $('#wh-public-hint').hidden = false;
  $('#wh-local-steps').hidden = true;
}

// ---------------- Status ----------------
async function loadStatus() {
  const s = await api('GET', '/api/status').catch(() => null);
  if (!s) return ($('#status').textContent = 'Server not reachable');
  const pill = (cls, text) => `<span class="pill ${cls}">${text}</span>`;
  $('#status').innerHTML =
    (s.apiKeySet ? (s.testMode ? pill('ok', 'Test key') : pill('bad', 'LIVE key')) : pill('bad', 'No API key')) +
    (s.webhookSecretSet ? pill('ok', 'Webhook secret set') : pill('warn', 'No webhook secret'));
}
loadStatus();

// ---------------- Flights ----------------
$('#flight-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const out = $('#flight-offers');
  busy($('button', form), async () => {
    out.innerHTML = '<p class="muted">Searching… this can take up to 20 seconds.</p>';
    const d = formData(form);
    const r = await api('POST', '/api/flights/search', d);
    if (!r.offers.length) return (out.innerHTML = '<p class="muted">No offers.</p>');
    out.innerHTML = r.offers
      .map((o) => {
        const segs = o.slices
          .map((s) => s.segments.map((g) => `${g.origin.iata_code}→${g.destination.iata_code} ${g.marketing_carrier.iata_code}${g.marketing_carrier_flight_number}`).join(', '))
          .join(' | ');
        return `<div class="item"><div><b>${esc(o.owner.name)}</b><div class="meta">${esc(segs)}</div><div class="meta"><code>${esc(o.id)}</code></div></div>
          <div><div class="price">${esc(o.total_amount)} ${esc(o.total_currency)}</div><button class="small" data-offer="${esc(o.id)}">Select</button></div></div>`;
      })
      .join('');
  });
});

$('#flight-offers').addEventListener('click', (e) => {
  const id = e.target.dataset.offer;
  if (!id) return;
  setField($('#flight-book'), 'offer_id', id);
  $('#flight-book').scrollIntoView({ behavior: 'smooth' });
  toast('Offer selected. Fill in the passenger and create the order.');
});

$('#flight-book').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  busy($('button', form), async () => {
    const d = formData(form);
    const passenger = {
      title: d.title, gender: d.gender, given_name: d.given_name, family_name: d.family_name,
      born_on: d.born_on, email: d.email, phone_number: d.phone_number,
    };
    const r = await api('POST', '/api/flights/orders', { offer_id: d.offer_id, passengers: [passenger], hold: !!d.hold });
    setField($('#flight-cancel'), 'order_id', r.data.id);
    toast(`Order created: ${r.data.id} (booking ref ${r.data.booking_reference})`);
  });
});

$('#flight-cancel').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  busy($('button', form), async () => {
    const d = formData(form);
    const r = await api('POST', `/api/flights/orders/${encodeURIComponent(d.order_id)}/cancel`, { quoteOnly: !!d.quoteOnly });
    toast(d.quoteOnly ? `Refund quote: ${r.data.refund_amount} ${r.data.refund_currency}` : `Cancelled. Refund ${r.data.refund_amount} ${r.data.refund_currency}`);
  });
});

// ---------------- Webhooks ----------------
$('#wh-create').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  busy($('button', form), async () => {
    const r = await api('POST', '/api/webhooks', formData(form));
    toast(r.savedToEnvFile
      ? `Webhook ${r.data.id} registered. Secret saved to .env.`
      : `Webhook ${r.data.id} registered. Copy its secret from the live feed into DUFFEL_WEBHOOK_SECRET.`);
    loadStatus();
    listWebhooks();
  });
});

async function listWebhooks(btn) {
  const out = $('#wh-list-out');
  await busy(btn, async () => {
    const r = await api('GET', '/api/webhooks');
    out.innerHTML =
      (r.data || [])
        .map((w) => `<div class="item"><div><code>${esc(w.id)}</code><div class="meta">${esc(w.url)} · ${w.active ? 'active' : 'inactive'}</div></div>
          <div><button class="small" data-ping="${esc(w.id)}">Ping</button> <button class="small danger" data-del="${esc(w.id)}">Delete</button></div></div>`)
        .join('') || '<p class="muted">No webhooks yet.</p>';
  });
}
$('#wh-list').addEventListener('click', (e) => listWebhooks(e.target));
$('#wh-list-out').addEventListener('click', (e) => {
  const { ping, del } = e.target.dataset;
  if (ping) busy(e.target, async () => { await api('POST', `/api/webhooks/${encodeURIComponent(ping)}/ping`); toast('Ping sent. Watch the live feed.'); });
  if (del) busy(e.target, async () => { await api('DELETE', `/api/webhooks/${encodeURIComponent(del)}`); listWebhooks(); });
});

// ---------------- Live feed (SSE) ----------------
const feed = $('#feed');
function renderEvent(ev) {
  const el = document.createElement('details');
  const time = new Date(ev.at).toLocaleTimeString();
  if (ev.kind === 'api') {
    const err = ev.status >= 400;
    el.className = 'evt api' + (err ? ' err' : '');
    el.innerHTML = `<summary><span class="badge ${err ? 'bad' : 'ok'}">${ev.status}</span><b>${esc(ev.method)}</b> <code>${esc(ev.path)}</code><span class="muted">${ev.ms} ms</span><span class="time">${time}</span></summary>
      ${ev.request ? `<div class="meta">Request</div><pre>${esc(JSON.stringify(ev.request, null, 2))}</pre>` : ''}
      <div class="meta">Response</div><pre>${esc(JSON.stringify(ev.response, null, 2))}</pre>`;
  } else {
    el.className = 'evt webhook' + (ev.verified ? '' : ' unverified');
    el.open = true;
    el.innerHTML = `<summary><span class="badge ${ev.verified ? 'ok' : 'warn'}">${ev.verified ? 'verified' : 'UNVERIFIED'}</span><b>webhook</b> <code>${esc(ev.type)}</code>
      ${ev.duplicate ? '<span class="badge warn">duplicate</span>' : ''}${ev.reason ? `<span class="muted">${esc(ev.reason)}</span>` : ''}<span class="time">${time}</span></summary>
      <pre>${esc(JSON.stringify(ev.body, null, 2))}</pre>`;
  }
  feed.prepend(el);
  applyFilter();
}
function applyFilter() {
  const showApi = $('#show-api').checked, showWh = $('#show-wh').checked;
  $$('.evt', feed).forEach((el) => {
    el.style.display = (el.classList.contains('api') ? showApi : showWh) ? '' : 'none';
  });
}
$('#show-api').addEventListener('change', applyFilter);
$('#show-wh').addEventListener('change', applyFilter);
$('#clear-feed').addEventListener('click', () => (feed.innerHTML = ''));

const loadedAt = Date.now();
const es = new EventSource('/events');
es.onopen = () => (feed.innerHTML = ''); // server replays recent history on each (re)connect
es.onmessage = (m) => {
  const ev = JSON.parse(m.data);
  renderEvent(ev);
  if (ev.kind === 'webhook' && Date.parse(ev.at) > loadedAt) toast(`Webhook: ${ev.type}${ev.verified ? '' : ' (unverified)'}`);
};
