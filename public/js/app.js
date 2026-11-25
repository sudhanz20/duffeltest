// Nomad: router and shell.
import { $, $$, ICON, api } from './util.js';
import { renderHome } from './search.js';
import { renderResults } from './results.js';
import { renderTravellers, renderPayment, renderConfirmation } from './checkout.js';
import { renderTrips, renderManage } from './trips.js';
import { initDev } from './dev.js';
import { isLux, setLux, renderLuxHome, renderLuxResults } from './lux.js';

$('#brand-mark').innerHTML = ICON.compass;

// Nomad Lux is a mode: #/lux turns it on, the classic home page turns it off.
// Results, checkout and bookings follow whichever mode is on.
const classicHome = (view) => {
  setLux(false);
  return renderHome(view);
};
const results = (view) => (isLux() ? renderLuxResults(view) : renderResults(view));
const HERO = [classicHome, renderLuxHome];

const routes = [
  [/^#?\/?$/, classicHome, 'home'],
  [/^#\/lux$/, renderLuxHome, 'lux'],
  [/^#\/lux\/results$/, renderLuxResults, 'lux'],
  [/^#\/results$/, results, 'home'],
  [/^#\/checkout$/, renderTravellers, 'home'],
  [/^#\/payment$/, renderPayment, 'home'],
  [/^#\/confirmation$/, renderConfirmation, 'trips'],
  [/^#\/trips$/, renderTrips, 'trips'],
  [/^#\/trip\/([\w]+)$/, renderManage, 'trips'],
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
  for (const [re, fn, nav] of routes) {
    const m = hash.match(re);
    if (m) {
      $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav && hash !== '#/' && hash !== ''));
      // The home pages have a transparent nav over the hero; other pages get a solid bar.
      $('#nav').classList.toggle('solid', !HERO.includes(fn));
      view.innerHTML = '';
      window.scrollTo(0, 0);
      cleanup = fn(view, ...m.slice(1));
      paintMode();
      return;
    }
  }
  location.hash = '#/';
}

function paintMode() {
  const on = isLux();
  document.body.classList.toggle('lux', on);
  $('.brand').href = on ? '#/lux' : '#/';
  $('#brand-name').textContent = on ? 'Nomad Lux' : 'Nomad';
  $('[data-nav=home]').href = on ? '#/lux' : '#/';
  const sw = $('#lux-link');
  sw.href = on ? '#/' : '#/lux';
  sw.textContent = on ? 'Classic' : 'Lux';
  sw.title = on ? 'Back to classic Nomad: every cabin, every price' : 'Nomad Lux: Premium, Business and First, ranked by time and comfort';
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
