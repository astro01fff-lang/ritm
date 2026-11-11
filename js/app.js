// Точка входа: вход, каркас приложения, навигация, загрузка данных и обновления в реальном времени.
import * as api from './api.js';
import { state, actions, inputs, hooks, isAdmin, isLead, unreadCount, taskById } from './store.js';
import { esc, $, $$, icon, avatar, fullName, toast, timeAgo, debounce } from './ui.js';
import { openTask, closeTask, renderDrawer, reloadDrawer } from './task.js';
import * as board from './views/board.js';
import * as mine from './views/mine.js';
import * as teamtasks from './views/teamtasks.js';
import * as goals from './views/goals.js';
import * as summary from './views/summary.js';
import * as team from './views/team.js';
import * as settings from './views/settings.js';
import * as archive from './views/archive.js';
import { timerButton, initTimer } from './timer.js';

const PRODUCT = 'Ритм';

const VIEWS = {
  board: { view: board, title: 'Доска', icon: 'board' },
  mine: { view: mine, title: 'Мои задачи', icon: 'checkCircle' },
  'team-tasks': { view: teamtasks, title: 'Командные', icon: 'users' },
  goals: { view: goals, title: 'Цели', icon: 'target' },
  summary: { view: summary, title: 'Итоги', icon: 'chart' },
  archive: { view: archive, title: 'Архив', icon: 'archive' },
  team: { view: team, title: 'Команда', icon: 'team' },
  settings: { view: settings, title: 'Настройки', icon: 'settings' },
};
const MOBILE_NAV = ['board', 'mine', 'team-tasks', 'goals', 'summary'];

const root = document.getElementById('app');

// ====================================================================== делегирование событий

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (!e.target.closest('.popover, [data-popover-toggle]')) closePopovers();
    return;
  }
  const stop = e.target.closest('[data-stop]');
  if (stop && el.contains(stop) && stop !== el) return;
  if (el.closest('.popover') === null && !el.matches('[data-popover-toggle]')) closePopovers();
  const fnc = actions[el.dataset.act];
  if (fnc) { e.preventDefault(); fnc(el, e); }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act][tabindex]') && !e.target.matches('button, input, select, textarea')) {
    e.preventDefault();
    actions[e.target.dataset.act]?.(e.target, e);
  }
  if (e.key === 'Escape' && state.openTaskId && !document.querySelector('.modal-wrap')) closeTask();
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && state.me && !document.querySelector('.modal-wrap')) {
    e.preventDefault(); actions.newTask?.(document.body);
  }
});

const isTextLike = (el) => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'search', 'number', ''].includes(el.type));
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-on]');
  if (el && isTextLike(el)) inputs[el.dataset.on]?.(el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-on]');
  if (el && !isTextLike(el)) inputs[el.dataset.on]?.(el, e);
});

// ====================================================================== навигация

function routeFromHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, arg] = h.split('/');
  if (name === 'task' && arg) return { route: state.route || 'board', task: arg };
  return { route: VIEWS[name] ? name : 'board' };
}

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#/join/')) { location.reload(); return; }
  if (!state.me) return;
  const r = routeFromHash();
  if (r.task) { openTask(r.task); return; }
  if (r.route !== state.route) {
    if (state.openTaskId) closeTask();
    state.route = r.route; renderShell(); window.scrollTo(0, 0);
  }
});

actions.go = (el) => { location.hash = `#/${el.dataset.route}`; };

// ====================================================================== отрисовка

function renderShell() {
  const me = state.me;
  const unread = unreadCount();
  root.innerHTML = `
    <div class="app">
      <aside class="side">
        <a class="brand" href="#/board" aria-label="${PRODUCT}">${logo()}<span>${PRODUCT}</span></a>
        <nav class="nav" aria-label="Разделы">
          ${Object.entries(VIEWS).map(([k, v]) => `
            <a href="#/${k}" class="nav-item ${state.route === k ? 'on' : ''}" ${state.route === k ? 'aria-current="page"' : ''}>${icon(v.icon, 19)}<span>${v.title}</span></a>`).join('')}
        </nav>
        <div class="side-foot">
          <button class="nav-item" data-act="toggleTheme">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun', 19)}<span>${document.documentElement.dataset.theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}</span></button>
        </div>
      </aside>
      <div class="main-wrap">
        <header class="top">
          <a class="brand brand-mobile" href="#/board" aria-label="${PRODUCT}">${logo()}</a>
          <div class="team-chip" title="Команда">${icon('team', 16)}<span>${esc(state.team.name)}</span></div>
          <div class="top-actions">
            ${isAdmin() ? `<button class="btn btn-ghost btn-sm hide-sm" data-act="addMember">${icon('plus', 16)} Добавить участника</button>` : ''}
            ${timerButton()}
            <button class="icon-btn bell" data-act="toggleNotifications" data-popover-toggle aria-label="Уведомления${unread ? `, непрочитанных: ${unread}` : ''}">
              ${icon('bell', 20)}${unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}
            </button>
            <button class="avatar-btn" data-act="toggleMenu" data-popover-toggle aria-label="Меню профиля">${avatar(me, 34)}</button>
          </div>
          <div class="popover notif-pop" id="notif-pop" hidden></div>
          <div class="popover timer-pop" id="timer-pop" hidden></div>
          <div class="popover menu-pop" id="menu-pop" hidden>
            <div class="menu-who">${avatar(me, 36)}<div><b>${esc(fullName(me))}</b><span class="muted small">${esc(me.position || '')}</span></div></div>
            <a href="#/settings" class="menu-item">${icon('settings', 17)} Настройки</a>
            <a href="#/team" class="menu-item">${icon('team', 17)} Команда</a>
            <a href="#/archive" class="menu-item">${icon('archive', 17)} Архив</a>
            <button class="menu-item" data-act="toggleTheme">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun', 17)} Сменить тему</button>
            <button class="menu-item" data-act="signOut">${icon('logout', 17)} Выйти</button>
          </div>
        </header>
        <main id="main" class="main" tabindex="-1"></main>
      </div>
      <nav class="bottom-nav" aria-label="Разделы">
        ${MOBILE_NAV.map((k) => `<a href="#/${k}" class="${state.route === k ? 'on' : ''}">${icon(VIEWS[k].icon, 21)}<span>${VIEWS[k].title}</span></a>`).join('')}
      </nav>
    </div>
    <div id="drawer"></div>`;
  renderView();
  if (state.openTaskId) renderDrawer();
}

function renderView() {
  const main = $('#main');
  if (!main) return;
  const active = document.activeElement;
  const key = active && main.contains(active) ? active.dataset.focusKey : null;
  const sel = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const boardEl = $('#board', main);
  const scrollX = boardEl?.scrollLeft || 0;
  const colScroll = boardEl ? $$('[data-col-list]', boardEl).map((l) => [l.dataset.colList, l.scrollTop]) : [];

  const v = VIEWS[state.route]?.view || board;
  main.innerHTML = state.loaded ? v.render() : skeleton();
  if (state.loaded && v.mount) v.mount(main);

  const nb = $('#board', main);
  if (nb) {
    nb.scrollLeft = scrollX;
    for (const [id, top] of colScroll) { const l = $(`[data-col-list="${id}"]`, nb); if (l) l.scrollTop = top; }
  }
  if (key) {
    const el = $(`[data-focus-key="${key}"]`, main);
    if (el) { el.focus(); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } } }
  }
  updateBadge();
}

function updateBadge() {
  const bell = $('.bell');
  if (!bell) return;
  const n = unreadCount();
  const b = $('.badge', bell);
  if (n && b) b.textContent = n > 99 ? '99+' : n;
  else if (n && !b) bell.insertAdjacentHTML('beforeend', `<span class="badge">${n}</span>`);
  else if (!n && b) b.remove();
  if (!$('#notif-pop')?.hidden) renderNotifications();
}

function skeleton() {
  return `
    <div class="view-head"><div><div class="sk sk-h"></div><div class="sk sk-t"></div></div></div>
    <div class="board">${[0, 1, 2, 3].map(() => `<section class="col"><div class="sk sk-t"></div>${[0, 1, 2].map(() => '<div class="sk sk-card"></div>').join('')}</section>`).join('')}</div>`;
}

function logo() {
  return `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="9" fill="var(--accent)"/>
    <path d="M7 17h4l2.5-6 4 11 2.5-5h5" fill="none" stroke="var(--on-accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

hooks.render = () => renderView();
hooks.renderDrawer = () => renderDrawer();

// ====================================================================== всплывающие панели

function closePopovers() {
  $$('.popover').forEach((p) => { p.hidden = true; });
}

actions.toggleMenu = () => {
  const p = $('#menu-pop'); const open = p.hidden;
  closePopovers(); p.hidden = !open;
};

actions.toggleNotifications = () => {
  const p = $('#notif-pop'); const open = p.hidden;
  closePopovers();
  if (open) { renderNotifications(); p.hidden = false; }
};

function renderNotifications() {
  const p = $('#notif-pop'); if (!p) return;
  const list = state.notifications;
  p.innerHTML = `
    <div class="notif-head"><b>Уведомления</b>
      ${unreadCount() ? `<button class="link-btn small" data-act="readAll">Прочитать все</button>` : ''}</div>
    <ul class="notif-list">
      ${list.length ? list.map((n) => `
        <li class="${n.read_at ? '' : 'unread'}" data-act="openNotification" data-id="${n.id}" tabindex="0">
          <span class="n-dot n-${n.type}"></span>
          <div><b>${esc(n.title)}</b><p>${esc(n.body)}</p><span class="muted small">${esc(timeAgo(n.created_at))}</span></div>
        </li>`).join('') : `<li class="notif-empty">${icon('bell', 28)}<span>Здесь появятся новые задачи, комментарии и напоминания о дедлайнах</span></li>`}
    </ul>
    <a href="#/settings" class="notif-foot small">Настроить уведомления</a>`;
}

actions.readAll = async () => {
  state.notifications.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); });
  updateBadge(); renderNotifications();
  try { await api.markAllRead(state.me.id); } catch (e) { toast(e.message, 'error'); }
};

actions.openNotification = async (el) => {
  const n = state.notifications.find((x) => x.id === el.dataset.id); if (!n) return;
  closePopovers();
  if (!n.read_at) {
    n.read_at = new Date().toISOString(); updateBadge();
    api.markRead(n.id).catch(() => {});
  }
  if (n.task_id) {
    if (taskById(n.task_id)) openTask(n.task_id);
    else toast('Задача удалена или недоступна', 'info');
  }
};

actions.toggleTheme = async () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  settings.applyTheme(next);
  renderShell();
  try { const saved = await api.updateProfile(state.me.id, { theme: next }); Object.assign(state.me, saved); } catch { /* ignore */ }
};

// ====================================================================== данные

let refreshing = null;
let again = false;

async function loadAll() {
  const [members, columns, departments, categories, tasks, goalsList, goalProgress, notifications, highFives, focus, meRow] = await Promise.all([
    api.loadMembers(), api.loadColumns(), api.loadRefs('departments'), api.loadRefs('categories'), api.loadTasks(),
    api.loadGoals(), api.loadGoalProgress(), api.loadNotifications(), api.loadHighFives(), api.loadFocus(), api.loadMe(),
  ]);
  if (!meRow) { showClosed(); return false; }
  Object.assign(state, { members, columns, departments, categories, tasks, goals: goalsList, goalProgress, notifications, highFives, focus });
  state.me = meRow.profile; state.team = meRow.team;
  state.loaded = true;
  return true;
}

hooks.refresh = async () => {
  if (refreshing) { again = true; return refreshing; }
  refreshing = (async () => {
    try {
      const ok = await loadAll();
      if (ok) { renderView(); renderDrawer(); }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      refreshing = null;
      if (again) { again = false; hooks.refresh(); }
    }
  })();
  return refreshing;
};

const liveRefresh = debounce(() => hooks.refresh(), 400);
const liveDrawer = debounce(() => reloadDrawer(), 400);

function startLive() {
  api.subscribe(state.me.id, (table, payload) => {
    liveRefresh();
    const taskId = payload.new?.task_id || payload.old?.task_id || (table === 'tasks' ? payload.new?.id : null);
    if (state.openTaskId && (taskId === state.openTaskId || ['subtasks', 'task_comments', 'task_attachments'].includes(table))) liveDrawer();
  }, (n) => {
    if (!state.notifications.some((x) => x.id === n.id)) state.notifications.unshift(n);
    updateBadge();
    if (n.type === 'high_five') { toast(`🙌 ${n.title}: ${n.body}`, 'ok', 5000); highFiveBurst(); }
    else if (n.type === 'push') toast(`👋 ${n.title}. ${n.body}`, 'info', 6000);
    else toast(`${n.title}: ${n.body}`, 'info', 4500);
  });
  // на случай, если вкладка долго была в фоне
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') hooks.refresh(); });
}

function highFiveBurst() {
  const el = document.createElement('div');
  el.className = 'hf-burst'; el.textContent = '🙌';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// ====================================================================== экраны входа
// Вход = персональная ссылка + пароль. Ссылка запоминается на устройстве,
// поэтому в следующий раз достаточно пароля. Без пароля сессия не выдаётся.

const REMEMBER = 'tracker-link';
const PW_AT = 'tracker-pw-at';
const REAUTH_DAYS = 14; // через сколько дней снова спрашивать пароль

const remembered = () => { try { return JSON.parse(localStorage.getItem(REMEMBER) || 'null'); } catch { return null; } };
const remember = (v) => { try { v ? localStorage.setItem(REMEMBER, JSON.stringify(v)) : localStorage.removeItem(REMEMBER); } catch { /* ignore */ } };
const markPassword = () => { try { localStorage.setItem(PW_AT, String(Date.now())); } catch { /* ignore */ } };
const passwordFresh = () => {
  try { const t = Number(localStorage.getItem(PW_AT) || 0); return Date.now() - t < REAUTH_DAYS * 86400000; } catch { return false; }
};

function authShell(inner) {
  root.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <div class="auth-brand">${logo()}<span>${PRODUCT}</span></div>
        ${inner}
      </div>
    </div>`;
}

function pwField(name, label, autocomplete, extra = '') {
  return `
    <label class="fl" for="pw-${name}">${label}</label>
    <div class="pw-wrap">
      <input id="pw-${name}" type="password" name="${name}" autocomplete="${autocomplete}" required minlength="8" maxlength="72" ${extra}>
      <button type="button" class="pw-eye" data-pw-toggle aria-label="Показать пароль">${icon('eye', 18)}</button>
    </div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pw-toggle]'); if (!b) return;
  const inp = b.previousElementSibling;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  b.setAttribute('aria-label', inp.type === 'password' ? 'Показать пароль' : 'Скрыть пароль');
});

function showConfigMissing() {
  authShell(`
    <h1>Почти готово</h1>
    <p>Сайт ещё не подключён к базе. Откройте файл <code>js/config.js</code> и впишите адрес проекта Supabase и публичный ключ — как в инструкции.</p>`);
}

function showLoginHint(message) {
  authShell(`
    <h1>${message ? 'Не получилось войти' : 'Вход в трекер'}</h1>
    ${message ? `<p class="auth-error">${esc(message)}</p>` : ''}
    <p>Чтобы войти, откройте свою персональную ссылку — её выдаёт администратор команды. Затем введите пароль.</p>
    <p class="muted">Если ссылка перестала работать или вы забыли пароль, попросите администратора выпустить новую ссылку.</p>`);
}

function showClosed() {
  authShell(`
    <h1>Доступ закрыт</h1>
    <p>Ваш доступ к команде отозван или вы удалены из неё. Если это ошибка, попросите администратора выпустить вам новую ссылку.</p>
    <button class="btn btn-ghost" data-act="signOut">Выйти</button>`);
}

actions.signOut = async () => {
  try { await api.signOut(); } catch { /* ignore */ }
  try { localStorage.removeItem(PW_AT); } catch { /* ignore */ }
  location.hash = '';
  location.reload();
};

// Первый вход по ссылке: придумать пароль
function showSetPassword(token, name) {
  authShell(`
    <h1>Здравствуйте${name ? `, ${esc(name)}` : ''}!</h1>
    <p class="muted">Придумайте пароль для входа в трекер. Дальше вы будете входить по своей ссылке и этому паролю.</p>
    <form class="setup-form">
      ${pwField('password', 'Пароль, не короче 8 символов', 'new-password', 'autofocus')}
      ${pwField('repeat', 'Повторите пароль', 'new-password')}
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary btn-block">Сохранить пароль и войти</button>
    </form>`);
  const form = $('.setup-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    if (form.password.value.length < 8) { err.textContent = 'Пароль должен быть не короче 8 символов'; return; }
    if (form.password.value !== form.repeat.value) { err.textContent = 'Пароли не совпадают'; return; }
    const btn = $('button.btn-primary', form); btn.disabled = true; btn.classList.add('loading');
    try {
      await api.setPasswordAndSignIn(token, form.password.value);
      markPassword();
      await startApp();
      toast('Пароль сохранён', 'ok');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
  setTimeout(() => form.password.focus(), 30);
}

// Обычный вход: ссылка уже известна, нужен пароль
function showPasswordLogin(token, name, email) {
  authShell(`
    <h1>${name ? `Здравствуйте, ${esc(name)}` : 'Вход'}</h1>
    <p class="muted">Введите пароль, чтобы открыть трекер.</p>
    <form class="setup-form">
      <input type="text" name="username" value="${esc(email)}" autocomplete="username" hidden>
      ${pwField('password', 'Пароль', 'current-password', 'autofocus')}
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary btn-block">Войти</button>
    </form>
    <p class="muted small auth-foot">Забыли пароль? Попросите администратора выпустить вам новую ссылку — по ней вы зададите новый пароль.</p>
    <button class="link-btn small" data-act="forgetDevice">Это не я — войти по другой ссылке</button>`);
  const form = $('.setup-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button.btn-primary', form); btn.disabled = true; btn.classList.add('loading');
    try {
      await api.signInWithPassword(email, form.password.value);
      markPassword();
      await startApp();
    } catch (ex) {
      $('.form-error', form).textContent = ex.message;
      form.password.select();
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
  setTimeout(() => form.password.focus(), 30);
}

actions.forgetDevice = async () => {
  remember(null);
  try { await api.signOut(); } catch { /* ignore */ }
  showLoginHint();
};

function showSetup() {
  authShell(`
    <h1>Создайте команду</h1>
    <p class="muted">Это первый запуск. Вы станете администратором и получите свою персональную ссылку входа.</p>
    <form class="setup-form">
      <label class="fl" for="su-secret">Код установки</label>
      <input id="su-secret" name="secret" autocomplete="off" required placeholder="Из настроек серверной функции (SETUP_SECRET)">
      <label class="fl" for="su-team">Название команды</label>
      <input id="su-team" name="teamName" maxlength="120" required autocomplete="off" placeholder="Например, HR и корпкультура">
      <div class="two">
        <div><label class="fl" for="su-first">Ваше имя</label><input id="su-first" name="firstName" maxlength="80" required autocomplete="off"></div>
        <div><label class="fl" for="su-last">Фамилия</label><input id="su-last" name="lastName" maxlength="80" autocomplete="off"></div>
      </div>
      <label class="fl" for="su-pos">Должность</label>
      <input id="su-pos" name="position" maxlength="120" autocomplete="off">
      ${pwField('password', 'Пароль для входа, не короче 8 символов', 'new-password')}
      ${pwField('repeat', 'Повторите пароль', 'new-password')}
      <p class="form-error" role="alert"></p>
      <button class="btn btn-primary btn-block">Создать команду</button>
    </form>`);
  const form = $('.setup-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    const p = Object.fromEntries(new FormData(form));
    if (p.password.length < 8) { err.textContent = 'Пароль должен быть не короче 8 символов'; return; }
    if (p.password !== p.repeat) { err.textContent = 'Пароли не совпадают'; return; }
    delete p.repeat;
    const btn = $('button.btn-primary', form); btn.disabled = true; btn.classList.add('loading');
    try {
      const { token, email } = await api.bootstrap(p);
      await api.signInWithPassword(email, p.password);
      remember({ token, name: p.firstName });
      markPassword();
      await startApp();
      team.showLink('', token, {
        title: 'Ваша ссылка для входа',
        note: 'Сохраните её в закладках или заметках. Для входа с другого устройства понадобятся эта ссылка и ваш пароль. Затем добавьте коллег в разделе «Команда».',
      });
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
}

// ====================================================================== запуск

async function startApp() {
  const me = await api.loadMe();
  if (!me) { showClosed(); return; }
  state.me = me.profile; state.team = me.team;
  settings.applyTheme(state.me.theme);
  const r = routeFromHash();
  state.route = r.route;
  try { const b = JSON.parse(localStorage.getItem('tracker-board') || 'null'); if (b) Object.assign(state.board, b); } catch { /* ignore */ }
  renderShell();
  await Promise.all([api.checkDeadlines(), api.autoArchive()]);
  await hooks.refresh();
  startLive();
  initTimer();
  if (r.task) openTask(r.task);
  // дедлайны проверяем раз в час, пока вкладка открыта
  setInterval(async () => { await api.checkDeadlines(); }, 3600 * 1000);
}

// Ссылка → пароль: решаем, какой экран показать
async function enterWithLink(token) {
  authShell(`<h1>Проверяем ссылку…</h1><div class="sk sk-t"></div>`);
  const info = await api.resolveLink(token);
  remember({ token, name: info.name });
  if (info.needsPassword) showSetPassword(token, info.name);
  else showPasswordLogin(token, info.name, info.email);
}

async function boot() {
  try { settings.applyTheme(localStorage.getItem('tracker-theme') || 'dark'); } catch { settings.applyTheme('dark'); }
  if (!api.configured) { showConfigMissing(); return; }

  const join = location.hash.match(/^#\/join\/([A-Za-z0-9_-]+)/);
  if (join) {
    history.replaceState(null, '', location.pathname + location.search + '#/mine');
    // новая ссылка важнее старой сессии на этом устройстве
    try { await api.signOut(); } catch { /* ignore */ }
    try { localStorage.removeItem(PW_AT); } catch { /* ignore */ }
    try { await enterWithLink(join[1]); }
    catch (e) { remember(null); showLoginHint(e.message); }
    return;
  }

  let session = null;
  try { session = await api.getSession(); } catch { /* ignore */ }
  if (session && passwordFresh()) {
    try { await startApp(); } catch (e) { showLoginHint(e.message); }
    return;
  }
  if (session) { try { await api.signOut(); } catch { /* ignore */ } }

  const saved = remembered();
  if (saved?.token) {
    try { await enterWithLink(saved.token); }
    catch (e) { remember(null); showLoginHint(e.message); }
    return;
  }

  try {
    const st = await api.setupStatus();
    if (st.needsSetup) { showSetup(); return; }
  } catch (e) {
    showLoginHint(e.message);
    return;
  }
  showLoginHint();
}

boot();
