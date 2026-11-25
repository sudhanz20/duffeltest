// A small date-range calendar: two months side by side, past dates disabled.
import { ymd, parseYmd, addDays, today, fmtDay, ICON, esc } from './util.js';

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

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
  const el = document.createElement('div');
  el.className = `popover cal${o.inline ? ' inline-cal' : ''}`;
  el.addEventListener('click', (e) => e.stopPropagation());
  const min = o.min ? parseYmd(o.min) : today();
  const max = o.max ? parseYmd(o.max) : addDays(today(), 330);
  let start = o.start || null;
  let end = o.mode === 'range' ? o.end || null : null;
  let hover = null;
  const first = start ? parseYmd(start) : min;
  let view = new Date(first.getFullYear(), first.getMonth(), 1);

  function month(base) {
    const y = base.getFullYear();
    const m = base.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
    const days = new Date(y, m + 1, 0).getDate();
    const t = ymd(today());
    let cells = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < lead; i++) cells += '<div></div>';
    const rangeEnd = end || (start && hover && hover > start ? hover : null);
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d);
      const s = ymd(date);
      const off = date < min || date > max;
      const cls = ['cal-day'];
      if (s === t) cls.push('today');
      if (start && s === start) cls.push('start');
      if (o.mode === 'range' && rangeEnd) {
        if (s === rangeEnd) cls.push('end');
        if (start && s > start && s < rangeEnd) cls.push('in-range');
      }
      if (o.mode === 'single' && s === start) cls.push('end');
      cells += `<button type="button" class="${cls.join(' ')}" data-d="${s}" ${off ? 'disabled' : ''}><span>${d}</span></button>`;
    }
    const title = base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return `<div class="cal-month"><h4>${esc(title)}</h4><div class="cal-grid">${cells}</div></div>`;
  }

  function hint() {
    if (o.mode === 'single') return start ? fmtDay(start, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Choose a date';
    if (!start) return 'Choose your departure date';
    if (!end) return 'Now choose your return date';
    const nights = Math.round((parseYmd(end) - parseYmd(start)) / 864e5);
    return `${fmtDay(start)} → ${fmtDay(end)} · ${nights} night${nights === 1 ? '' : 's'}`;
  }

  function render() {
    const next = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    const canPrev = view > new Date(min.getFullYear(), min.getMonth(), 1);
    const canNext = next <= new Date(max.getFullYear(), max.getMonth(), 1);
    el.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" ${canPrev ? '' : 'disabled'} aria-label="Previous month">${ICON.chevL}</button>
        <span class="small muted">${esc(hint())}</span>
        <button type="button" class="cal-nav" data-nav="1" ${canNext ? '' : 'disabled'} aria-label="Next month">${ICON.chevR}</button>
      </div>
      <div class="cal-months">${month(view)}${month(next)}</div>
      <div class="cal-foot">
        <button type="button" class="btn-link" data-clear>Clear</button>
        ${o.onDone ? '<button type="button" class="btn btn-primary btn-sm" data-done>Done</button>' : ''}
      </div>`;
  }

  el.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1);
      return render();
    }
    if (e.target.closest('[data-clear]')) {
      start = end = null;
      o.onChange(null, null);
      return render();
    }
    if (e.target.closest('[data-done]')) return o.onDone && o.onDone();
    const day = e.target.closest('[data-d]');
    if (!day || day.disabled) return;
    const d = day.dataset.d;
    if (o.mode === 'single') {
      start = d;
      o.onChange(start, null);
      render();
      if (o.onDone) setTimeout(o.onDone, 120);
      return;
    }
    if (!start || end || d < start) {
      start = d;
      end = null;
    } else {
      end = d;
    }
    o.onChange(start, end);
    render();
    if (start && end && o.onDone) setTimeout(o.onDone, 220);
  });

  el.addEventListener('mouseover', (e) => {
    if (o.mode !== 'range' || !start || end) return;
    const day = e.target.closest('[data-d]');
    const d = day && !day.disabled ? day.dataset.d : null;
    if (d !== hover) {
      hover = d;
      render();
    }
  });

  render();
  return el;
}
