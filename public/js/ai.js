// Ask Nomad: plain-language search with a review step.
// The traveller writes a request, checks what Nomad understood, corrects it, then searches.
import { $, esc, api, toast, fmtDay, CABIN_LABEL, ICON, money } from './util.js';
import { paxCount } from './state.js';

const EXAMPLES = [
  'London to New York, 3 to 10 March, 2 adults, business class',
  'Somewhere warm in Europe for a week in April, from Manchester, cheapest',
  'Family of four from Paris to Tokyo over Easter, nonstop if possible',
  'One way Heathrow to Dubai next Friday, first class',
  'London to Paris on 2 May, 3 nights, then Rome for 4 nights, then home',
  'London to New York in business, morning flight out, flat bed, free Wi‑Fi, 2 bags, earning Avios, lowest CO₂',
];

function load() {
  try {
    return JSON.parse(sessionStorage.getItem('nomad.ai')) || { turns: [] };
  } catch {
    return { turns: [] };
  }
}
function save(st) {
  try {
    sessionStorage.setItem('nomad.ai', JSON.stringify(st));
  } catch {
    /* storage blocked: keep it in memory */
  }
}

let statusPromise = null;
const aiStatus = () => (statusPromise ||= api('GET', '/api/ai/status').catch(() => ({ enabled: false })));

const guessed = (plan, ...keys) => plan.assumptions.some((a) => keys.some((k) => String(a.field).toLowerCase().includes(k)));

function travellersText(s) {
  const parts = [`${s.adults} adult${s.adults > 1 ? 's' : ''}`];
  if (s.childAges.length) parts.push(`${s.childAges.length} child${s.childAges.length > 1 ? 'ren' : ''} (${s.childAges.join(', ')})`);
  if (s.infants) parts.push(`${s.infants} infant${s.infants > 1 ? 's' : ''}`);
  return parts.join(', ');
}

const FEATURE_TEXT = {
  cabinBag: 'cabin bag included', wifi: 'Wi‑Fi', wifiFree: 'free Wi‑Fi', power: 'power sockets', flatBed: 'flat bed', suite: 'private suite',
  legroom: 'extra legroom', priorityBoarding: 'priority boarding', priorityCheckIn: 'priority check-in', seatSelection: 'seat selection included',
};
const pad = (h) => `${String(h).padStart(2, '0')}:00`;

function prefsText(p, s) {
  const out = [{ recommended: 'Recommended first', comfort: 'Most comfortable first', price: 'Cheapest first', fastest: 'Fastest first', greenest: 'Lowest CO₂ first' }[p.sort]];
  if (p.directOnly) out.push('Direct only');
  if (p.refundable) out.push('Refundable only');
  if (p.changeable) out.push('Changeable only');
  for (const t of p.times || []) out.push(`${s.trip === 'multi' ? (t.direction === 'return' ? 'Last flight' : 'First flight') : t.direction === 'return' ? 'Return' : 'Outbound'} ${t.which === 'arrive' ? 'lands' : 'leaves'} ${pad(t.after)}–${pad(t.before)}`);
  if (p.maxHours) out.push(`Under ${p.maxHours} h each way`);
  if (p.checkedBags) out.push(`${p.checkedBags}+ checked bag${p.checkedBags > 1 ? 's' : ''}`);
  if ((p.features || []).length) out.push(p.features.map((k) => FEATURE_TEXT[k] || k).join(', '));
  if ((p.loyalty || []).length) out.push(`Earns with ${p.loyalty.join(', ')}`);
  if (p.maxPrice) out.push(`Under ${p.currency ? money(p.maxPrice, p.currency) : p.maxPrice} total`);
  return out.join(' · ');
}

// Multi-city: one line per flight, spanning the grid. A missing part reads "Needed".
function flightsCell(legs, flag) {
  const part = (p) => (p ? `${esc(p.name)} <span class="muted">${esc(p.code)}</span>` : '<b class="need">Needed</b>');
  const ok = legs.every((l) => l.from && l.to && l.date);
  return `<div class="ai-cell ai-flights ${flag ? 'guess' : ''} ${ok ? '' : 'missing'}">
    <span class="label">Flights · multi-city${flag ? ' <em>guessed</em>' : ''}</span>
    <ol>${legs.map((l) => `<li>${part(l.from)} → ${part(l.to)} <span class="when">${l.date ? esc(fmtDay(l.date, { weekday: 'short', day: 'numeric', month: 'short' })) : '<b class="need">Date needed</b>'}</span></li>`).join('')}</ol></div>`;
}

function cell(label, value, flag) {
  return `<div class="ai-cell ${flag ? 'guess' : ''} ${value ? '' : 'missing'}">
    <span class="label">${label}${flag ? ' <em>guessed</em>' : ''}</span>
    <span class="value">${value ? esc(value) : 'Needed'}</span></div>`;
}

export function mountAi(box, { onUseForm, onSearch }) {
  let st = load();
  let busy = false;

  box.innerHTML = `
    <div class="ai-head"><span class="ai-badge">${ICON.spark}</span><div><b>Ask Nomad</b><div class="small muted">Describe your trip in your own words. You check the details before anything is searched.</div></div></div>
    <div id="ai-off" class="notice hidden"></div>
    <form id="ai-form" class="ai-input" autocomplete="off">
      <textarea id="ai-text" rows="2" maxlength="1500" placeholder="e.g. Two of us from London to somewhere warm for a week in March. Business out, cheapest way back."></textarea>
      <button type="submit" class="btn btn-brass" id="ai-go">Plan search</button>
    </form>
    <div class="ai-examples" id="ai-examples">${EXAMPLES.map((e) => `<button type="button" class="ai-chip" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    <div id="ai-plan"></div>`;

  const text = $('#ai-text', box);
  const planBox = $('#ai-plan', box);

  aiStatus().then((s) => {
    if (s.enabled) return;
    const off = $('#ai-off', box);
    off.classList.remove('hidden');
    off.innerHTML = 'Ask Nomad is switched off. The site owner needs to add <code>ANTHROPIC_API_KEY</code> to the server settings. You can still use the classic search.';
    $('#ai-go', box).disabled = true;
  });

  function paintPlan() {
    const last = st.turns[st.turns.length - 1];
    const plan = last && last.plan;
    $('#ai-examples', box).classList.toggle('hidden', Boolean(st.turns.length));
    $('#ai-form', box).classList.toggle('hidden', Boolean(plan));
    if (!plan) {
      planBox.innerHTML = busy ? thinking() : '';
      return;
    }
    const s = plan.search;
    const dates = s.depart ? (s.trip === 'return' && s.ret ? `${fmtDay(s.depart, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDay(s.ret, { day: 'numeric', month: 'short' })}` : `${fmtDay(s.depart, { day: 'numeric', month: 'short', year: 'numeric' })}${s.trip === 'oneway' ? ' · one way' : ''}`) : '';
    const cabin = s.mixed ? `${CABIN_LABEL[s.cabinOut]} out, ${CABIN_LABEL[s.cabinBack]} back` : s.cabin === 'any' ? 'Any cabin' : CABIN_LABEL[s.cabin];
    planBox.innerHTML = `
      <div class="ai-said">${st.turns.map((t) => `<div><span class="muted small">You</span> ${esc(t.text)}</div>`).join('')}</div>
      <div class="ai-plan">
        <p class="ai-summary serif">${esc(plan.summary || 'Here is what Nomad understood.')}</p>
        <div class="ai-grid">
          ${s.trip === 'multi' ? flightsCell(s.legs, guessed(plan, 'flight', 'origin', 'destination', 'date', 'leg')) : `
          ${cell('From', s.from && `${s.from.name} (${s.from.code})`, guessed(plan, 'origin', 'from'))}
          ${cell('To', s.to && `${s.to.name} (${s.to.code})`, guessed(plan, 'destination', 'to'))}
          ${cell('Dates', dates, guessed(plan, 'date', 'depart', 'ret'))}`}
          ${cell('Travellers', travellersText(s), guessed(plan, 'adult', 'child', 'infant', 'traveller', 'passenger'))}
          ${cell('Cabin', cabin, guessed(plan, 'cabin', 'class'))}
          ${cell('Preferences', prefsText(s.prefs, s), guessed(plan, 'sort', 'pref', 'price', 'budget', 'direct', 'time', 'bag', 'wifi', 'loyalty', 'meal', 'starlink'))}
        </div>
        ${plan.questions.length ? `<div class="ai-q"><b>Nomad needs to know</b><ul>${plan.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
        ${plan.assumptions.length ? `<div class="ai-a"><b>Nomad guessed</b><ul>${plan.assumptions.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul><div class="tiny muted">Correct anything below, or search if it looks right.</div></div>` : ''}
        ${plan.alternatives.length ? `<div class="ai-alts"><span class="small muted">Or go to</span> ${plan.alternatives.map((a) => `<button type="button" class="ai-chip" data-alt="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : ''}
        <form id="ai-refine" class="ai-input ai-refine" autocomplete="off">
          <input id="ai-fix" class="input" maxlength="600" placeholder="${plan.questions.length ? 'Answer here, e.g. from Manchester, back on the 19th' : 'Change anything, e.g. make it 3 adults, or fly back a day later'}" />
          <button type="submit" class="btn btn-ghost">Update</button>
        </form>
        ${busy ? thinking() : ''}
        <div class="ai-actions">
          <button type="button" class="btn btn-brass" id="ai-search" ${plan.ready && !busy ? '' : 'disabled'}>Search ${paxCount(s) > 1 ? `for ${paxCount(s)} travellers` : 'flights'}</button>
          <button type="button" class="btn btn-ghost" id="ai-form-edit" ${busy ? 'disabled' : ''}>Edit in the form</button>
          <button type="button" class="btn-link" id="ai-reset">Start over</button>
        </div>
      </div>`;
    if (!busy) $('#ai-fix', box)?.focus();
  }

  const thinking = () => `<div class="ai-thinking"><span class="dot"></span><span class="dot"></span><span class="dot"></span> Nomad is reading your request…</div>`;

  async function send(input) {
    const value = String(input || '').trim();
    if (!value || busy) return;
    busy = true;
    const turns = [...st.turns.map((t) => ({ text: t.text, plan: t.plan && { raw: t.plan.raw } })), { text: value }];
    const pending = { turns: [...st.turns, { text: value }] };
    const before = st;
    st = pending;
    paintPlan();
    try {
      const plan = await api('POST', '/api/ai/plan', { turns });
      st.turns[st.turns.length - 1].plan = plan;
      save(st);
    } catch (e) {
      st = before;
      toast(e.message, 'err');
      if (!st.turns.length) text.value = value;
    } finally {
      busy = false;
      paintPlan();
    }
  }

  $('#ai-form', box).addEventListener('submit', (e) => {
    e.preventDefault();
    send(text.value);
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(text.value);
    }
  });

  box.addEventListener('submit', (e) => {
    if (e.target.id !== 'ai-refine') return;
    e.preventDefault();
    send($('#ai-fix', box).value);
  });

  box.addEventListener('click', (e) => {
    const ex = e.target.closest('[data-ex]');
    if (ex) {
      text.value = ex.dataset.ex;
      return send(ex.dataset.ex);
    }
    const alt = e.target.closest('[data-alt]');
    if (alt) return send(`Make the destination ${alt.dataset.alt} instead.`);
    const plan = st.turns.length && st.turns[st.turns.length - 1].plan;
    if (e.target.id === 'ai-reset') {
      st = { turns: [] };
      save(st);
      text.value = '';
      paintPlan();
      text.focus();
    }
    if (!plan) return;
    if (e.target.id === 'ai-search') onSearch(plan.search);
    if (e.target.id === 'ai-form-edit') onUseForm(plan.search);
  });

  paintPlan();
}
