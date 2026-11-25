// Nomad: router and shell.
import { $, $$, ICON, api } from './util.js';
import { renderHome } from './search.js';
import { renderResults } from './results.js';
import { renderTravellers, renderPayment, renderConfirmation } from './checkout.js';
import { renderTrips, renderManage } from './trips.js';
import { initDev } from './dev.js';

$('#brand-mark').innerHTML = ICON.compass;

// [pattern, page, nav item, route name for Vercel Web Analytics]
const routes = [
  [/^#?\/?$/, renderHome, 'home', '/'],
  [/^#\/results$/, renderResults, 'home', '/results'],
  [/^#\/checkout$/, renderTravellers, 'home', '/checkout'],
  [/^#\/payment$/, renderPayment, 'home', '/payment'],
  [/^#\/confirmation$/, renderConfirmation, 'trips', '/confirmation'],
  [/^#\/trips$/, renderTrips, 'trips', '/trips'],
  [/^#\/trip\/([\w]+)$/, renderManage, 'trips', '/trip/[id]'],
];

let cleanup = null;
function route() {
  const hash = location.hash || '#/';
  // A fresh element per page, so listeners from the previous page do not pile up.
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  for (const [re, fn, nav, name] of routes) {
    const m = hash.match(re);
    if (m) {
      $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav && hash !== '#/' && hash !== ''));
      // The home page has a transparent nav over the hero; other pages get a solid bar.
      $('#nav').classList.toggle('solid', fn !== renderHome);
      view.innerHTML = '';
      window.scrollTo(0, 0);
      cleanup = fn(view, ...m.slice(1));
      // Booking ids stay out of analytics: every Manage booking page reports as /trip/[id].
      if (window.va) window.va('pageview', { route: name, path: name });
      return;
    }
  }
  location.hash = '#/';
}

window.addEventListener('hashchange', route);
route();
initDev();

api('GET', '/api/status')
  .then((s) => {
    if (s.testMode) $('#mode-pill').hidden = false;
    if (!s.apiKeySet) {
      const n = document.createElement('div');
      n.className = 'notice bad';
      n.style.cssText = 'position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:60;max-width:90vw';
      n.textContent = 'DUFFEL_API_KEY is not set on the server. Add it to .env (or your Vercel settings) and restart.';
      document.body.appendChild(n);
    }
    if (s.apiKeySet && !s.testMode) {
      $('#footer-mode').textContent = 'LIVE key in use. Bookings are real and will be charged.';
      $('#footer-mode').style.color = 'var(--rose)';
    }
  })
  .catch(() => {});
