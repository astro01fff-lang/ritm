// «Настройки»: профиль, тема, уведомления.
import * as api from '../api.js';
import { state, actions, inputs, hooks } from '../store.js';
import { esc, $, icon, avatar, toast, TIMEZONES, AVATAR_COLORS, ROLE_LABELS, fmtDate } from '../ui.js';

const NOTIFY_TYPES = [
  ['assigned', 'Мне назначили задачу'],
  ['reassigned', 'Меня сделали исполнителем'],
  ['comment', 'Новый комментарий в моей задаче'],
  ['due_soon', 'Дедлайн сегодня или завтра'],
  ['overdue', 'Задача просрочена'],
  ['completed', 'Поставленную мной задачу выполнили'],
  ['high_five', 'Мне дали пять 🙌'],
  ['push', 'Коллега напомнил о задаче 👋'],
];

export function render() {
  const me = state.me;
  const prefs = me.notify_prefs || {};
  const tzKnown = TIMEZONES.some(([v]) => v === me.timezone);
  return `
    <div class="view-head"><div><h1>Настройки</h1><p class="muted">Изменения сохраняются сразу</p></div></div>

    <section class="panel settings">
      <h2 class="panel-h">Профиль</h2>
      <div class="profile-top">
        ${avatar(me, 64)}
        <div>
          <b class="profile-name">${esc(`${me.first_name} ${me.last_name}`.trim())}</b>
          <span class="muted">${ROLE_LABELS[me.role]} в команде «${esc(state.team.name)}»</span>
          <span class="muted small">В трекере с ${esc(fmtDate(me.created_at.slice(0, 10), true))}</span>
        </div>
      </div>
      <div class="form-grid">
        <label class="fl" for="s-first">Имя</label><input id="s-first" data-on="profile" data-key="first_name" value="${esc(me.first_name)}" maxlength="80">
        <label class="fl" for="s-last">Фамилия</label><input id="s-last" data-on="profile" data-key="last_name" value="${esc(me.last_name)}" maxlength="80">
        <label class="fl" for="s-pos">Должность</label><input id="s-pos" data-on="profile" data-key="position" value="${esc(me.position)}" maxlength="120">
        <label class="fl" for="s-city">Город</label><input id="s-city" data-on="profile" data-key="city" value="${esc(me.city)}" maxlength="80">
        <label class="fl" for="s-tz">Часовой пояс</label>
        <select id="s-tz" data-on="profile" data-key="timezone">
          ${!tzKnown ? `<option value="${esc(me.timezone)}" selected>${esc(me.timezone)}</option>` : ''}
          ${TIMEZONES.map(([v, l]) => `<option value="${v}" ${v === me.timezone ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <label class="fl">Цвет аватара</label>
        <div class="swatches">
          ${AVATAR_COLORS.map((c) => `<button class="swatch ${c === me.avatar_color ? 'on' : ''}" style="--c:${c}" data-act="avatarColor" data-color="${c}" aria-label="Цвет ${c}"></button>`).join('')}
        </div>
      </div>
    </section>

    <section class="panel settings">
      <h2 class="panel-h">Оформление</h2>
      <div class="seg seg-wide">
        <label><input type="radio" name="theme" value="dark" data-on="theme" ${me.theme !== 'light' ? 'checked' : ''}><span>${icon('moon', 16)} Тёмная</span></label>
        <label><input type="radio" name="theme" value="light" data-on="theme" ${me.theme === 'light' ? 'checked' : ''}><span>${icon('sun', 16)} Светлая</span></label>
      </div>
    </section>

    <section class="panel settings">
      <h2 class="panel-h">Уведомления</h2>
      <ul class="switches">
        ${NOTIFY_TYPES.map(([k, l]) => `<li><label class="switch-row"><span>${l}</span>
          <input type="checkbox" role="switch" data-on="notifyPref" data-key="${k}" ${prefs[k] === false ? '' : 'checked'}><i class="switch"></i></label></li>`).join('')}
      </ul>
    </section>

    <section class="panel settings">
      <h2 class="panel-h">Вход и пароль</h2>
      <p class="muted">Вы входите по персональной ссылке и паролю. На этом устройстве ссылка запомнена, поэтому здесь достаточно пароля. Раз в 14 дней трекер спросит пароль снова.</p>
      <form class="pw-change" data-pw-change>
        <div class="form-grid">
          <label class="fl" for="pw-new">Новый пароль</label>
          <div class="pw-wrap"><input id="pw-new" type="password" name="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="Не короче 8 символов">
            <button type="button" class="pw-eye" data-pw-toggle aria-label="Показать пароль">${icon('eye', 18)}</button></div>
          <label class="fl" for="pw-rep">Повторите</label>
          <div class="pw-wrap"><input id="pw-rep" type="password" name="repeat" autocomplete="new-password" maxlength="72">
            <button type="button" class="pw-eye" data-pw-toggle aria-label="Показать пароль">${icon('eye', 18)}</button></div>
        </div>
        <p class="form-error" role="alert"></p>
        <div class="row-actions">
          <button class="btn btn-primary">${icon('lock', 16)} Сменить пароль</button>
          <button type="button" class="btn btn-ghost" data-act="signOut">${icon('logout', 16)} Выйти на этом устройстве</button>
        </div>
      </form>
    </section>`;
}

const pending = {};
inputs.profile = (el) => {
  const key = el.dataset.key;
  const value = el.value.trim();
  if (key === 'first_name' && !value) return;
  clearTimeout(pending[key]);
  pending[key] = setTimeout(async () => {
    try {
      const saved = await api.updateProfile(state.me.id, { [key]: value });
      Object.assign(state.me, saved);
      const m = state.members.find((x) => x.id === state.me.id); if (m) Object.assign(m, saved);
      hooks.render();
      toast('Сохранено', 'ok', 1500);
    } catch (e) { toast(e.message, 'error'); }
  }, el.tagName === 'SELECT' ? 0 : 700);
};

actions.avatarColor = async (el) => {
  try {
    const saved = await api.updateProfile(state.me.id, { avatar_color: el.dataset.color });
    Object.assign(state.me, saved);
    const m = state.members.find((x) => x.id === state.me.id); if (m) Object.assign(m, saved);
    hooks.render();
  } catch (e) { toast(e.message, 'error'); }
};

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  try { localStorage.setItem('tracker-theme', document.documentElement.dataset.theme); } catch { /* ignore */ }
}

inputs.theme = async (el) => {
  applyTheme(el.value);
  try { const saved = await api.updateProfile(state.me.id, { theme: el.value }); Object.assign(state.me, saved); }
  catch (e) { toast(e.message, 'error'); }
};

inputs.notifyPref = async (el) => {
  const prefs = { ...(state.me.notify_prefs || {}), [el.dataset.key]: el.checked };
  try { const saved = await api.updateProfile(state.me.id, { notify_prefs: prefs }); Object.assign(state.me, saved); toast('Сохранено', 'ok', 1500); }
  catch (e) { toast(e.message, 'error'); el.checked = !el.checked; }
};

actions.signOut = async () => {
  await api.signOut();
  location.hash = '';
  location.reload();
};

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-pw-change]'); if (!form) return;
  e.preventDefault();
  const err = $('.form-error', form);
  err.textContent = '';
  if (form.password.value.length < 8) { err.textContent = 'Пароль должен быть не короче 8 символов'; return; }
  if (form.password.value !== form.repeat.value) { err.textContent = 'Пароли не совпадают'; return; }
  try {
    await api.changePassword(form.password.value);
    form.reset();
    toast('Пароль изменён', 'ok');
  } catch (ex) { err.textContent = ex.message; }
});

