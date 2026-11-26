// A date calendar. Range mode picks departure and return in one flow:
// tap a departure, then a return, and the tabs at the top show which one is next.
// Wide screens show two months side by side. Phones get a bottom sheet with months that scroll.
import { ymd, parseYmd, addDays, today, fmtDay, ICON, esc } from './util.js';

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const isPhone = () => window.matchMedia('(max-width: 680px)').matches;

/**
 * @param {object} o
 * @param {'range'|'single'} o.mode
 * @param {string} [o.start]  YYYY-MM-DD
 * @param {string} [o.end]    YYYY-MM-DD (range only)
 * @param {string} [o.min]
 * @param {string} [o.max]
 * @param {(start:string,end:string|null)=>void} o.onChange
 * @param {()=>void} [o.onDone]
 * @param {boolean} [o.inline]
 */
export function createCalendar(o) {
  const range = o.mode === 'range';
  const sheet = !o.inline && isPhone();
  const min = o.min ? parseYmd(o.min) : today();
  const max = o.max ? parseYmd(o.max) : addDays(today(), 330);
  let start = o.start || null;
  let end = range ? o.end || null : null;
  let hover = null;
  // Which date the next tap sets. A new range starts on the departure.
  let picking = range && start && !end ? 'end' : 'start';
  const first = start ? parseYmd(start) : min;
  let view = new Date(first.getFullYear(), first.getMonth(), 1);
  const lastMonth = new Date(max.getFullYear(), max.getMonth(), 1);

  // On a phone the calendar is a sheet over a dimmed page. Tapping the dimmed page closes it.
  const el = document.createElement('div');
  const panel = sheet ? document.createElement('div') : el;
  if (sheet) {
    el.className = 'cal-sheet';
    el.appendChild(panel);
    el.addEventListener('click', (e) => {
      if (e.target === el && o.onDone) o.onDone();
    });
  }
  panel.className = `popover cal${o.inline ? ' inline-cal' : ''}${sheet ? ' sheet' : ''}`;
  el.addEventListener('click', (e) => e.stopPropagation());

  function month(base) {
    const y = base.getFullYear();
    const m = base.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
    const days = new Date(y, m + 1, 0).getDate();
    const t = ymd(today());
    let cells = sheet ? '' : DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < lead; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const s = ymd(date);
      const off = date < min || date > max;
      cells += `<button type="button" class="cal-day${s === t ? ' today' : ''}" data-d="${s}" ${off ? 'disabled' : ''}><span>${d}</span></button>`;
    }
    const title = base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return `<div class="cal-month" data-m="${ymd(base).slice(0, 7)}"><h4>${esc(title)}</h4><div class="cal-grid">${cells}</div></div>`;
  }

  const nightsText = () => {
    const n = Math.round((parseYmd(end) - parseYmd(start)) / 864e5);
    return n === 0 ? 'Same-day return' : `${n} night${n === 1 ? '' : 's'}`;
  };

  function head() {
    if (!range) {
      const txt = start ? fmtDay(start, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Choose a date';
      return `<div class="cal-hint">${esc(txt)}</div>`;
    }
    const tab = (k, label, val, empty) =>
      `<button type="button" class="cal-tab${picking === k ? ' on' : ''}" data-pick="${k}"><small>${label}</small><b>${val ? esc(fmtDay(val)) : `<i>${empty}</i>`}</b></button>`;
    return `<div class="cal-tabs">${tab('start', 'Depart', start, 'Choose date')}${tab('end', 'Return', end, start ? 'Choose date' : '—')}</div>`;
  }

  function foot() {
    let note = '';
    if (range && start && end) note = nightsText();
    else if (range && picking === 'end') note = 'Now tap your return date';
    else if (range) note = 'Tap your departure date';
    return `<button type="button" class="btn-link" data-clear>Clear</button>
      <span class="small muted cal-note">${esc(note)}</span>
      ${o.onDone ? '<button type="button" class="btn btn-primary btn-sm" data-done>Done</button>' : ''}`;
  }

  // Build the months. Phones get every bookable month in one scrolling list.
  function render() {
    if (sheet) {
      let months = '';
      for (let m = new Date(min.getFullYear(), min.getMonth(), 1); m <= lastMonth; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months += month(m);
      panel.innerHTML = `
        <div class="cal-grab"></div>
        <div class="cal-top">${head()}<div class="cal-grid cal-dows">${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('')}</div></div>
        <div class="cal-scroll">${months}</div>
        <div class="cal-foot">${foot()}</div>`;
    } else {
      const next = new Date(view.getFullYear(), view.getMonth() + 1, 1);
      const canPrev = view > new Date(min.getFullYear(), min.getMonth(), 1);
      const canNext = next <= lastMonth;
      panel.innerHTML = `
        <div class="cal-head">
          <button type="button" class="cal-nav" data-nav="-1" ${canPrev ? '' : 'disabled'} aria-label="Previous month">${ICON.chevL}</button>
          <div class="cal-top">${head()}</div>
          <button type="button" class="cal-nav" data-nav="1" ${canNext ? '' : 'disabled'} aria-label="Next month">${ICON.chevR}</button>
        </div>
        <div class="cal-months">${month(view)}${month(next)}</div>
        <div class="cal-foot">${foot()}</div>`;
    }
    paint();
  }

  // Update the selection in place, so a tap never rebuilds the calendar under the finger.
  function paint() {
    const rangeEnd = end || (range && start && hover && hover >= start ? hover : null);
    for (const b of panel.querySelectorAll('[data-d]')) {
      const s = b.dataset.d;
      const isStart = Boolean(start && s === start);
      const isEnd = range ? Boolean(rangeEnd && s === rangeEnd) : isStart;
      b.classList.toggle('start', isStart);
      b.classList.toggle('end', isEnd);
      b.classList.toggle('in-range', Boolean(range && start && rangeEnd && s > start && s < rangeEnd));
      b.classList.toggle('preview', Boolean(!end && isEnd && !isStart));
    }
    const top = panel.querySelector('.cal-top > .cal-tabs, .cal-top > .cal-hint');
    if (top) top.outerHTML = head();
    panel.querySelector('.cal-foot').innerHTML = foot();
  }

  function pick(d) {
    if (!range) {
      start = d;
      o.onChange(start, null);
      paint();
      if (o.onDone) setTimeout(o.onDone, 150);
      return;
    }
    if (picking === 'start' || !start || d < start) {
      // A new departure. Keep the return if it still comes after it.
      start = d;
      if (end && end < start) end = null;
      picking = 'end';
      hover = null;
      o.onChange(start, end);
      return paint();
    }
    end = d;
    picking = 'start';
    hover = null;
    o.onChange(start, end);
    paint();
    // Both dates are set: close after a moment so the person sees the range.
    if (o.onDone) setTimeout(o.onDone, 300);
  }

  el.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1);
      return render();
    }
    const tab = e.target.closest('[data-pick]');
    if (tab) {
      if (tab.dataset.pick === 'end' && !start) return;
      picking = tab.dataset.pick;
      return paint();
    }
    if (e.target.closest('[data-clear]')) {
      start = end = hover = null;
      picking = 'start';
      o.onChange(null, null);
      return paint();
    }
    if (e.target.closest('[data-done]')) return o.onDone && o.onDone();
    const day = e.target.closest('[data-d]');
    if (day && !day.disabled) pick(day.dataset.d);
  });

  // Preview the range under a mouse only. On touch screens a hover that changes the page
  // makes iOS Safari swallow the tap, so the return date needed two taps.
  el.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || !range || !start || end) return;
    const day = e.target.closest('[data-d]');
    const d = day && !day.disabled ? day.dataset.d : null;
    if (d !== hover) {
      hover = d;
      paint();
    }
  });

  render();

  // Open the sheet at the month of the departure.
  if (sheet) {
    requestAnimationFrame(() => {
      const box = panel.querySelector('.cal-scroll');
      const target = panel.querySelector(`[data-m="${ymd(view).slice(0, 7)}"]`);
      if (box && target) box.scrollTop = target.offsetTop - box.offsetTop;
    });
  }
  return el;
}
