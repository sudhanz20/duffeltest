// Developer drawer: live feed of API calls and webhooks, and webhook setup.
import { $, $$, esc, api, toast } from './util.js';

export function initDev() {
  const drawer = $('#drawer');
  $('#dev-open').addEventListener('click', () => drawer.classList.add('open'));
  $('#dev-close').addEventListener('click', () => drawer.classList.remove('open'));
  $$('[data-dtab]').forEach((b) =>
    b.addEventListener('click', () => {
      $$('[data-dtab]').forEach((x) => x.classList.toggle('on', x === b));
      $$('[data-dpanel]').forEach((p) => (p.hidden = p.dataset.dpanel !== b.dataset.dtab));
    })
  );

  // Webhook setup
  $$('.port').forEach((el) => (el.textContent = location.port || '80'));
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  if (!isLocal && location.protocol === 'https:') {
    $('#wh-create [name=url]').value = location.origin;
    $('#wh-public-hint').classList.remove('hidden');
    $('#wh-local-steps').hidden = true;
  }
  const status = () =>
    api('GET', '/api/status')
      .then((s) => {
        $('#dev-status').innerHTML = `API key: <b>${s.apiKeySet ? (s.testMode ? 'test' : 'LIVE') : 'missing'}</b> · Webhook secret: <b>${s.webhookSecretSet ? 'set' : 'not set'}</b>`;
      })
      .catch(() => {});
  status();

  $('#wh-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/webhooks', { url: e.target.url.value });
      toast(
        r.savedToEnvFile
          ? 'Webhook registered. Secret saved to .env.'
          : 'Webhook registered. Copy its secret from the live feed into DUFFEL_WEBHOOK_SECRET.',
        'ok'
      );
      status();
      listHooks();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  async function listHooks() {
    try {
      const r = await api('GET', '/api/webhooks');
      $('#wh-list-out').innerHTML =
        (r.data || [])
          .map(
            (w) => `<div class="change-opt" style="cursor:default"><div><code>${esc(w.id)}</code><div class="tiny muted">${esc(w.url)} · ${w.active ? 'active' : 'inactive'}</div></div>
            <div style="display:flex;gap:6px"><button type="button" class="btn btn-ghost btn-sm" data-ping="${esc(w.id)}">Ping</button><button type="button" class="btn btn-ghost btn-sm" data-del="${esc(w.id)}">Delete</button></div></div>`
          )
          .join('') || '<p class="small muted">No webhooks yet.</p>';
    } catch (err) {
      toast(err.message, 'err');
    }
  }
  $('#wh-list').addEventListener('click', listHooks);
  $('#wh-list-out').addEventListener('click', async (e) => {
    const { ping, del } = e.target.dataset;
    try {
      if (ping) {
        await api('POST', `/api/webhooks/${encodeURIComponent(ping)}/ping`);
        toast('Ping sent. Watch the live feed.');
      }
      if (del) {
        await api('DELETE', `/api/webhooks/${encodeURIComponent(del)}`);
        listHooks();
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  // Live feed (Server-Sent Events)
  const feed = $('#feed');
  const applyFilter = () => {
    const a = $('#show-api').checked;
    const w = $('#show-wh').checked;
    $$('.evt', feed).forEach((el) => (el.style.display = (el.classList.contains('api') ? a : w) ? '' : 'none'));
  };
  $('#show-api').addEventListener('change', applyFilter);
  $('#show-wh').addEventListener('change', applyFilter);
  $('#clear-feed').addEventListener('click', () => (feed.innerHTML = ''));

  const render = (ev) => {
    const el = document.createElement('details');
    const time = new Date(ev.at).toLocaleTimeString();
    if (ev.kind === 'api') {
      const err = ev.status >= 400;
      el.className = `evt api${err ? ' err' : ''}`;
      el.innerHTML = `<summary><span class="badge ${err ? 'bad' : 'ok'}">${ev.status}</span><b>${esc(ev.method)}</b><code>${esc(ev.path)}</code><span class="tiny muted">${ev.ms} ms</span><span class="time">${time}</span></summary>
        ${ev.request ? `<div class="tiny muted">Request</div><pre>${esc(JSON.stringify(ev.request, null, 2))}</pre>` : ''}<div class="tiny muted">Response</div><pre>${esc(JSON.stringify(ev.response, null, 2))}</pre>`;
    } else {
      el.className = `evt webhook${ev.verified ? '' : ' unverified'}`;
      el.open = true;
      el.innerHTML = `<summary><span class="badge ${ev.verified ? 'ok' : 'warn'}">${ev.verified ? 'verified' : 'UNVERIFIED'}</span><b>webhook</b><code>${esc(ev.type)}</code>${ev.duplicate ? '<span class="badge warn">duplicate</span>' : ''}${ev.reason ? `<span class="tiny muted">${esc(ev.reason)}</span>` : ''}<span class="time">${time}</span></summary>
        <pre>${esc(JSON.stringify(ev.body, null, 2))}</pre>`;
    }
    feed.prepend(el);
    while (feed.children.length > 150) feed.lastElementChild.replaceWith();
    applyFilter();
  };

  const loadedAt = Date.now();
  const es = new EventSource('/events');
  es.onopen = () => (feed.innerHTML = ''); // the server replays recent history on every (re)connect
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    render(ev);
    if (ev.kind === 'webhook' && Date.parse(ev.at) > loadedAt) toast(`Webhook: ${ev.type}${ev.verified ? '' : ' (unverified)'}`);
  };
}
