// Общие помощники интерфейса: экранирование, даты, периоды, модальные окна, тосты, иконки.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------------------------------------------------------------- даты

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const MONTHS_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const WEEKDAYS_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

export const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const todayISO = () => toISO(today());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const startOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
export const endOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
export const weekdayShort = (d) => WEEKDAYS_SHORT[(d.getDay() + 6) % 7];

export function fmtDate(iso, withYear = false) {
  const d = typeof iso === 'string' ? parseISO(iso) : iso;
  if (!d) return '';
  const y = withYear || d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}
export function fmtShort(iso) {
  const d = typeof iso === 'string' ? parseISO(iso) : iso;
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : '';
}
export function fmtDeadline(iso) {
  if (!iso) return '';
  const diff = Math.round((parseISO(iso) - today()) / 86400000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  return fmtShort(iso);
}
export function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} дн назад`;
  return fmtShort(new Date(ts));
}
export function fmtMinutes(m) {
  if (m == null) return '';
  const h = Math.floor(m / 60), mm = m % 60;
  if (!h) return `${mm} мин`;
  return mm ? `${h} ч ${mm} мин` : `${h} ч`;
}
export function fmtHours(m) {
  if (!m) return '0 ч';
  const h = m / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1).replace('.', ',')} ч`;
}
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// ---------------------------------------------------------------- периоды

export const PERIOD_LABELS = { day: 'День', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', custom: 'Свои даты', none: 'Без периода' };

// Диапазон периода по типу и опорной дате
export function periodRange(type, anchorISO, endISO) {
  const a = parseISO(anchorISO) || today();
  switch (type) {
    case 'day': return [toISO(a), toISO(a)];
    case 'week': { const s = startOfWeek(a); return [toISO(s), toISO(addDays(s, 6))]; }
    case 'month': return [toISO(startOfMonth(a)), toISO(endOfMonth(a))];
    case 'quarter': return [toISO(startOfQuarter(a)), toISO(endOfQuarter(a))];
    case 'custom': { const e = endISO && endISO >= toISO(a) ? endISO : toISO(a); return [toISO(a), e]; }
    default: return [null, null];
  }
}

export function fmtPeriod(type, start, end) {
  if (!type || type === 'none' || !start) return 'Без периода';
  const s = parseISO(start), e = parseISO(end || start);
  if (type === 'day') return fmtDate(start);
  if (type === 'month') return `${MONTHS_NOM[s.getMonth()]} ${s.getFullYear()}`;
  if (type === 'quarter') return `${Math.floor(s.getMonth() / 3) + 1} квартал ${s.getFullYear()}`;
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${e.getDate()} ${MONTHS[e.getMonth()]}`;
  return `${fmtShort(s)} – ${fmtShort(e)}`;
}

export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && aEnd >= bStart;

// ---------------------------------------------------------------- люди

export function initials(p) {
  if (!p) return '?';
  return ((p.first_name || '')[0] || '') + ((p.last_name || '')[0] || '') || '?';
}
export const fullName = (p) => (p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Без имени' : 'Не назначен');
export const shortName = (p) => (p ? `${p.first_name || ''} ${(p.last_name || '')[0] ? p.last_name[0] + '.' : ''}`.trim() : 'Не назначен');

export function avatar(p, size = 28) {
  if (!p) return `<span class="avatar avatar-empty" style="--s:${size}px" title="Не назначен">${icon('user', 14)}</span>`;
  return `<span class="avatar" style="--s:${size}px;--c:${esc(p.avatar_color || '#F28BB5')}" title="${esc(fullName(p))}">${esc(initials(p))}</span>`;
}

export const ROLE_LABELS = { admin: 'Администратор', manager: 'Руководитель', member: 'Участник' };
export const PRIORITY_LABELS = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };

// ---------------------------------------------------------------- иконки

const ICONS = {
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.6c2.3-.3 4.3.9 5 3.6"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  team: '<circle cx="12" cy="7.5" r="3"/><path d="M6.5 19c.6-3.3 2.7-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="4.5" cy="10" r="2"/><circle cx="19.5" cy="10" r="2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1112 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  comment: '<path d="M4.5 5.5h15v10h-8l-4.5 4v-4h-2.5z"/>',
  clip: '<path d="M15.5 7.5l-6.8 6.8a2 2 0 002.8 2.8l7.2-7.2a4 4 0 00-5.6-5.6L5.8 11.6a6 6 0 008.5 8.5l5-5"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="17.5" r="1.2"/>',
  more: '<circle cx="5.5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18.5" cy="12" r="1.5"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  flag: '<path d="M6 21V4M6 4.5h11l-2 4 2 4H6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  moon: '<path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z"/>',
  logout: '<path d="M14 4.5H6.5v15H14M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
  edit: '<path d="M4.5 19.5l1-4.5L15.8 4.7a1.8 1.8 0 012.5 0l1 1a1.8 1.8 0 010 2.5L9 18.5z"/>',
  history: '<path d="M4 12a8 8 0 102.3-5.6M4 4.5v4h4"/><path d="M12 8v4.5l3 1.5"/>',
  sparkle: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2"/><path d="M5 9v9.5a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5V9M10 13h4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>',
};
export function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// ---------------------------------------------------------------- тосты

export function toast(text, kind = 'info', ms = 3200) {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = text;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------------------------------------------------------------- модальные окна

let modalStack = [];

export function openModal(html, { wide = false, onMount, onClose, dismissable = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const ctx = {
    el: wrap.querySelector('.modal'),
    close: () => {
      if (!wrap.isConnected) return;
      wrap.classList.remove('in');
      modalStack = modalStack.filter((m) => m !== ctx);
      setTimeout(() => wrap.remove(), 180);
      onClose && onClose();
    },
  };
  modalStack.push(ctx);
  if (dismissable) {
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) ctx.close(); });
  }
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) ctx.close(); });
  requestAnimationFrame(() => wrap.classList.add('in'));
  onMount && onMount(ctx);
  const first = ctx.el.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return ctx;
}

export function topModal() { return modalStack[modalStack.length - 1]; }

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) { e.stopPropagation(); topModal().close(); }
});

export function confirmDialog({ title, text = '', ok = 'Удалить', danger = true }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(`
      <h3 class="modal-title">${esc(title)}</h3>
      ${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>
      </div>`, { onClose: () => { if (!done) resolve(false); } });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { done = true; resolve(true); m.close(); });
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}

export function debounce(fn, ms) {
  let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function downloadCSV(filename, rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const TIMEZONES = [
  ['Europe/Kaliningrad', 'Калининград (UTC+2)'], ['Europe/Moscow', 'Москва (UTC+3)'], ['Europe/Samara', 'Самара (UTC+4)'],
  ['Asia/Yekaterinburg', 'Екатеринбург (UTC+5)'], ['Asia/Omsk', 'Омск (UTC+6)'], ['Asia/Novosibirsk', 'Новосибирск (UTC+7)'],
  ['Asia/Krasnoyarsk', 'Красноярск (UTC+7)'], ['Asia/Irkutsk', 'Иркутск (UTC+8)'], ['Asia/Yakutsk', 'Якутск (UTC+9)'],
  ['Asia/Vladivostok', 'Владивосток (UTC+10)'], ['Asia/Magadan', 'Магадан (UTC+11)'], ['Asia/Kamchatka', 'Камчатка (UTC+12)'],
  ['Europe/Minsk', 'Минск (UTC+3)'], ['Asia/Almaty', 'Алматы (UTC+5)'], ['Asia/Tashkent', 'Ташкент (UTC+5)'],
  ['Asia/Tbilisi', 'Тбилиси (UTC+4)'], ['Asia/Yerevan', 'Ереван (UTC+4)'], ['Asia/Dubai', 'Дубай (UTC+4)'],
  ['Europe/Istanbul', 'Стамбул (UTC+3)'], ['Europe/Berlin', 'Берлин (UTC+1/+2)'], ['Europe/London', 'Лондон (UTC+0/+1)'],
];

export const AVATAR_COLORS = ['#F28BB5', '#8BC6F2', '#B5F28B', '#F2C98B', '#C49BF2', '#8BF2DF', '#F29B8B', '#E8E08B'];
