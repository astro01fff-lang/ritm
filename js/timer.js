// Таймер концентрации: 10, 15, 20, 30 или 50 минут фокуса, перерывы 5–15 минут.
// Состояние хранится в браузере, поэтому таймер переживает переключение вкладок и перезагрузку.
import * as api from './api.js';
import { state, actions, inputs, hooks, taskById } from './store.js';
import { esc, $, icon, openModal, toast, pad, fmtMinutes } from './ui.js';

const WORK = [10, 15, 20, 30, 50];
const BREAK = [5, 10, 15];
const KEY = 'tracker-focus';

let t = load();
let ticker = null;

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v.total === 'number') return v;
  } catch { /* ignore */ }
  return { mode: 'work', total: 20 * 60, remaining: 20 * 60, endsAt: null, taskId: null, startedAt: null, minutes: 20 };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ } }

const running = () => !!t.endsAt;
const left = () => (running() ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.remaining);
const fmt = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;

// ---------------------------------------------------------------- отрисовка

export function timerButton() {
  const on = running() || t.remaining < t.total;
  return `<button class="timer-btn ${running() ? 'is-running' : ''} ${t.mode === 'break' ? 'is-break' : ''}" data-act="toggleTimer" data-popover-toggle aria-label="Таймер концентрации">
    ${icon('clock', 19)}${on ? `<span id="timer-chip">${fmt(left())}</span>` : '<span class="hide-sm">Фокус</span>'}
  </button>`;
}

function myOpenTasks() {
  return state.tasks.filter((x) => x.assignee_id === state.me?.id && !x.completed_at);
}

function popoverHTML() {
  const presets = t.mode === 'work' ? WORK : BREAK;
  const task = t.taskId ? taskById(t.taskId) : null;
  const pct = t.total ? Math.round(((t.total - left()) / t.total) * 100) : 0;
  return `
    <div class="timer-pop-in">
      <div class="tabs tabs-sm timer-modes" role="tablist">
        <button role="tab" class="tab ${t.mode === 'work' ? 'on' : ''}" data-act="timerMode" data-mode="work" ${running() ? 'disabled' : ''}>Фокус</button>
        <button role="tab" class="tab ${t.mode === 'break' ? 'on' : ''}" data-act="timerMode" data-mode="break" ${running() ? 'disabled' : ''}>Перерыв</button>
      </div>
      <div class="timer-face" style="--p:${pct}">
        <div class="timer-digits" id="timer-digits" aria-live="off">${fmt(left())}</div>
        <div class="timer-sub muted small">${t.mode === 'work' ? (task ? esc(task.title) : 'Без привязки к задаче') : 'Отдохните, разомнитесь'}</div>
      </div>
      <div class="timer-presets">
        ${presets.map((m) => `<button class="time-chip ${t.minutes === m ? 'on' : ''}" data-act="timerPreset" data-min="${m}" ${running() ? 'disabled' : ''}>${m} мин</button>`).join('')}
      </div>
      ${t.mode === 'work' ? `
        <label class="fl" for="timer-task">Задача</label>
        <select id="timer-task" data-on="timerTask" ${running() ? 'disabled' : ''}>
          <option value="">Без задачи</option>
          ${myOpenTasks().map((x) => `<option value="${x.id}" ${x.id === t.taskId ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}
        </select>` : ''}
      <div class="timer-actions">
        <button class="btn btn-ghost" data-act="timerReset" ${!running() && t.remaining === t.total ? 'disabled' : ''}>Сбросить</button>
        <button class="btn btn-primary" data-act="timerStartPause">${running() ? 'Пауза' : t.remaining < t.total ? 'Продолжить' : 'Старт'}</button>
      </div>
      ${focusToday()}
    </div>`;
}

function focusToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const list = (state.focus || []).filter((f) => f.mode === 'work' && new Date(f.started_at) >= d);
  if (!list.length) return '';
  const min = list.reduce((a, f) => a + f.minutes, 0);
  return `<p class="timer-today muted small">Сегодня: ${list.length} ${list.length === 1 ? 'сессия' : list.length < 5 ? 'сессии' : 'сессий'}, ${fmtMinutes(min)} в фокусе</p>`;
}

function renderPopover() {
  const p = $('#timer-pop');
  if (p && !p.hidden) p.innerHTML = popoverHTML();
}

function renderButton() {
  const b = $('.timer-btn');
  if (b) b.outerHTML = timerButton();
}

function tick() {
  const sec = left();
  const chip = $('#timer-chip'); if (chip) chip.textContent = fmt(sec);
  const dig = $('#timer-digits'); if (dig) dig.textContent = fmt(sec);
  const face = $('.timer-face'); if (face) face.style.setProperty('--p', t.total ? Math.round(((t.total - sec) / t.total) * 100) : 0);
  if (running()) document.title = `${fmt(sec)} ${t.mode === 'work' ? 'Фокус' : 'Перерыв'} — Ритм`;
  if (running() && sec <= 0) finish();
}

function startTicker() {
  clearInterval(ticker);
  if (running()) ticker = setInterval(tick, 1000);
}

export function initTimer() {
  if (running() && left() <= 0) setTimeout(finish, 500);
  startTicker();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
}

// ---------------------------------------------------------------- управление

function setPreset(min) {
  t.minutes = min; t.total = min * 60; t.remaining = t.total; t.endsAt = null; t.startedAt = null;
  save(); renderPopover(); renderButton();
}

export function startFocus(taskId, minutes) {
  t = { mode: 'work', minutes: minutes || t.minutes || 20, total: 0, remaining: 0, endsAt: null, taskId: taskId || null, startedAt: null };
  if (!WORK.includes(t.minutes)) t.minutes = 20;
  t.total = t.minutes * 60; t.remaining = t.total;
  start();
}

function start() {
  askNotifyPermission();
  t.endsAt = Date.now() + t.remaining * 1000;
  t.startedAt = t.startedAt || new Date().toISOString();
  save(); startTicker(); renderPopover(); renderButton();
}

function pause() {
  t.remaining = left(); t.endsAt = null;
  save(); clearInterval(ticker); document.title = 'Ритм — задачи команды';
  renderPopover(); renderButton();
}

function reset() {
  t.remaining = t.total; t.endsAt = null; t.startedAt = null;
  save(); clearInterval(ticker); document.title = 'Ритм — задачи команды';
  renderPopover(); renderButton();
}

function askNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch { /* ignore */ }
}

function systemNotify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(title, { body });
    }
  } catch { /* ignore */ }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((d, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = [660, 880, 990][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.2);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.22);
    });
  } catch { /* звук недоступен */ }
}

let finishing = false;
async function finish() {
  if (finishing) return;
  finishing = true;
  const done = { ...t };
  clearInterval(ticker);
  document.title = 'Ритм — задачи команды';
  // следующий шаг: после фокуса предлагаем перерыв, после перерыва — фокус
  t = done.mode === 'work'
    ? { mode: 'break', minutes: 5, total: 300, remaining: 300, endsAt: null, taskId: done.taskId, startedAt: null }
    : { mode: 'work', minutes: WORK.includes(done.prevWork) ? done.prevWork : 20, total: 0, remaining: 0, endsAt: null, taskId: done.taskId, startedAt: null };
  if (t.mode === 'work') { t.total = t.minutes * 60; t.remaining = t.total; } else { t.prevWork = done.minutes; }
  save(); renderButton(); renderPopover();
  beep();

  if (done.mode === 'work') {
    systemNotify('Фокус-сессия завершена', `${done.minutes} мин. Время отдохнуть`);
    try {
      const row = await api.saveFocus({
        team_id: state.team.id, user_id: state.me.id, task_id: done.taskId, minutes: done.minutes, mode: 'work', started_at: done.startedAt || new Date().toISOString(),
      });
      state.focus = [row, ...(state.focus || [])];
    } catch (e) { toast(e.message, 'error'); }
    const task = done.taskId ? taskById(done.taskId) : null;
    const m = openModal(`
      <div class="time-ask">
        <div class="time-ask-mark">${icon('clock', 28)}</div>
        <h3 class="modal-title">Фокус-сессия завершена</h3>
        <p class="muted">${done.minutes} минут${task ? ` на «${esc(task.title)}»` : ''}. Самое время для короткого перерыва.</p>
        <div class="timer-done-actions">
          ${task && !task.completed_at ? `<button class="btn btn-ghost btn-block" data-x="log">Добавить ${done.minutes} мин к времени задачи</button>` : ''}
          <button class="btn btn-primary btn-block" data-x="break">Перерыв 5 минут</button>
          <button class="btn btn-ghost btn-block" data-x="again">Ещё ${done.minutes} минут фокуса</button>
          <button class="btn btn-ghost btn-block" data-close>Закрыть</button>
        </div>
      </div>`, { onClose: () => { finishing = false; } });
    m.el.addEventListener('click', async (e) => {
      const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
      if (x === 'log') {
        const cur = taskById(done.taskId);
        const minutes = (cur?.spent_minutes || 0) + done.minutes;
        try { await api.updateTask(done.taskId, { spent_minutes: minutes }); if (cur) cur.spent_minutes = minutes; hooks.render(); toast(`Записано: ${fmtMinutes(minutes)} всего`, 'ok'); }
        catch (ex) { toast(ex.message, 'error'); }
        e.target.closest('[data-x]').remove();
        return;
      }
      if (x === 'break') { m.close(); start(); }
      if (x === 'again') { m.close(); startFocus(done.taskId, done.minutes); }
    });
  } else {
    systemNotify('Перерыв закончился', 'Можно возвращаться к задачам');
    const m = openModal(`
      <div class="time-ask">
        <div class="time-ask-mark">${icon('sun', 28)}</div>
        <h3 class="modal-title">Перерыв закончился</h3>
        <p class="muted">Готовы к следующей сессии?</p>
        <div class="timer-done-actions">
          <button class="btn btn-primary btn-block" data-x="go">Начать ${t.minutes} минут фокуса</button>
          <button class="btn btn-ghost btn-block" data-close>Позже</button>
        </div>
      </div>`, { onClose: () => { finishing = false; } });
    m.el.querySelector('[data-x=go]').addEventListener('click', () => { m.close(); start(); });
  }
}

// ---------------------------------------------------------------- действия

actions.toggleTimer = () => {
  const p = $('#timer-pop'); const open = p.hidden;
  document.querySelectorAll('.popover').forEach((x) => { x.hidden = true; });
  if (open) { p.hidden = false; p.innerHTML = popoverHTML(); }
};
actions.timerMode = (el) => {
  if (running()) return;
  const mode = el.dataset.mode;
  const min = mode === 'work' ? (WORK.includes(t.prevWork) ? t.prevWork : 20) : 5;
  if (mode === 'break' && t.mode === 'work') t.prevWork = t.minutes;
  t.mode = mode; setPreset(min);
};
actions.timerPreset = (el) => { if (!running()) setPreset(Number(el.dataset.min)); };
actions.timerStartPause = () => (running() ? pause() : start());
actions.timerReset = () => reset();
actions.focusOnTask = (el) => {
  if (running()) { toast('Таймер уже идёт. Остановите его, чтобы начать новую сессию', 'info'); return; }
  startFocus(el.dataset.id, t.mode === 'work' ? t.minutes : 20);
  toast('Фокус-сессия началась', 'ok', 1800);
};
inputs.timerTask = (el) => { t.taskId = el.value || null; save(); renderPopover(); };
