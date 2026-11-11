// «Команда»: участники, роли, персональные ссылки входа, демоданные.
import * as api from '../api.js';
import { state, actions, inputs, hooks, memberById, isAdmin, isLead } from '../store.js';
import { openRefEditor } from './board.js';
import {
  esc, $, icon, avatar, fullName, openModal, confirmDialog, toast, copyText, timeAgo, ROLE_LABELS,
} from '../ui.js';

export function render() {
  const admin = isAdmin();
  const members = [...state.members].sort((a, b) =>
    (b.active - a.active) || ['admin', 'manager', 'member'].indexOf(a.role) - ['admin', 'manager', 'member'].indexOf(b.role) || fullName(a).localeCompare(fullName(b), 'ru'));
  const hasDemo = state.members.some((m) => m.is_demo);
  return `
    <div class="view-head">
      <div>
        <h1>${admin ? `<input class="team-name-edit" value="${esc(state.team.name)}" data-on="teamName" aria-label="Название команды" maxlength="120">` : esc(state.team.name)}</h1>
        <p class="muted">${state.members.filter((m) => m.active).length} в команде</p>
      </div>
      ${admin ? `<button class="btn btn-primary" data-act="addMember">${icon('plus', 18)} Добавить участника</button>` : ''}
    </div>

    ${admin ? `<p class="callout">${icon('link', 16)} Каждый входит по своей персональной ссылке и паролю. При первом открытии ссылки человек сам придумывает пароль. Забыл пароль или ссылка попала не туда — выпустите новую ссылку: старые ссылка и пароль перестанут работать, а по новой задаётся новый пароль.</p>` : ''}

    <ul class="members">
      ${members.map((m) => `
        <li class="member ${m.active ? '' : 'is-off'}">
          ${avatar(m, 40)}
          <div class="member-main">
            <b>${esc(fullName(m))}${m.id === state.me.id ? ' <span class="muted">(вы)</span>' : ''}${m.is_demo ? ' <span class="tag">демо</span>' : ''}${m.private_tasks ? ` <span class="tag tag-private" title="Личные задачи видит только ${m.id === state.me.id ? 'вы' : 'он(а) сам(а)'}">${icon('lock', 12)} задачи скрыты</span>` : ''}</b>
            <span class="muted small">${esc(m.position || 'Должность не указана')}${m.city ? `, ${esc(m.city)}` : ''}</span>
            <span class="muted small">${m.active ? (m.last_login_at ? `Заходил(а) ${esc(timeAgo(m.last_login_at))}` : 'Ещё не входил(а)') : 'Доступ отозван'}</span>
          </div>
          ${admin ? `
            <select data-on="memberRole" data-id="${m.id}" aria-label="Роль" ${m.id === state.me.id && state.members.filter((x) => x.role === 'admin' && x.active).length < 2 ? 'disabled' : ''}>
              ${Object.entries(ROLE_LABELS).map(([k, l]) => `<option value="${k}" ${m.role === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <div class="member-actions">
              ${!m.private_tasks && m.role !== 'member' ? `<button class="btn btn-ghost btn-sm" data-act="makePrivate" data-id="${m.id}" title="Личные задачи этого человека не увидит никто, кроме него">${icon('lock', 15)} Скрыть задачи</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-act="newLink" data-id="${m.id}" title="Новая ссылка сбрасывает пароль">${icon('link', 15)} ${m.active ? 'Новая ссылка / сброс пароля' : 'Вернуть доступ'}</button>
              ${m.id !== state.me.id && m.active ? `<button class="btn btn-ghost btn-sm" data-act="revoke" data-id="${m.id}">Отозвать доступ</button>` : ''}
              ${m.id !== state.me.id ? `<button class="icon-btn" data-act="removeMember" data-id="${m.id}" aria-label="Удалить из команды" title="Удалить из команды">${icon('trash', 16)}</button>` : ''}
            </div>` : `<span class="role-badge role-${m.role}">${ROLE_LABELS[m.role]}</span>`}
        </li>`).join('')}
    </ul>

    ${refPanel('department', 'Отделы', state.departments, 'Отделы, с которыми работает команда. На доске их можно сделать колонками.')}
    ${refPanel('category', 'Категории задач', state.categories, 'По категориям удобно фильтровать задачи и собирать квартальные итоги.')}

    <section class="panel roles-help">
      <h2 class="panel-h">Кто что видит</h2>
      <dl>
        <dt>Администратор</dt><dd>Всё, что руководитель, плюс участники, роли, ссылки входа и настройки команды.</dd>
        <dt>Руководитель</dt><dd>Видит все задачи и итоги, ставит задачи любому или всем сразу, создаёт цели команды.</dd>
        <dt>Участник</dt><dd>Свои задачи и командные. Личные задачи коллег не видит. Видит только свои итоги.</dd>
        <dt>${icon('lock', 14)} Задачи скрыты</dt><dd>Личные задачи этого человека не видит никто, даже администраторы. Подходит для руководителя. Командные задачи и задачи, которые вы ему поставили, остаются видны. Отключить скрытие может только он сам в своих настройках.</dd>
      </dl>
    </section>

    ${admin ? `
    <section class="panel">
      <h2 class="panel-h">Демоданные</h2>
      <p class="muted">Добавят 4 тестовых коллег, около 20 задач, цели и комментарии — чтобы посмотреть, как выглядит заполненный трекер. Ваши настоящие задачи не затрагиваются. Если отделов ещё нет, добавятся 4 примера — их можно переименовать.</p>
      <div class="row-actions">
        ${hasDemo
          ? `<button class="btn btn-ghost" data-act="clearDemo">${icon('trash', 16)} Очистить демоданные</button>`
          : `<button class="btn btn-ghost" data-act="seedDemo">${icon('sparkle', 16)} Заполнить демоданными</button>`}
      </div>
    </section>` : ''}
  `;
}

function refPanel(kind, title, list, hint) {
  const lead = isLead();
  const count = (id) => state.tasks.filter((t) => t[kind === 'department' ? 'department_id' : 'category_id'] === id && !t.completed_at).length;
  return `
    <section class="panel">
      <div class="panel-row"><h2 class="panel-h">${title} <span class="muted">${list.length}</span></h2>
        ${lead ? `<button class="btn btn-ghost btn-sm" data-act="refAdd" data-kind="${kind}">${icon('plus', 16)} Добавить</button>` : ''}</div>
      <p class="muted small">${hint}</p>
      ${list.length ? `<ul class="ref-list">
        ${list.map((x) => `<li>
          <${lead ? `button class="ref-chip" data-act="refEdit" data-kind="${kind}" data-id="${x.id}"` : 'span class="ref-chip"'} style="--c:${esc(x.color)}">
            <i></i>${esc(x.name)}${count(x.id) ? `<small>${count(x.id)}</small>` : ''}
          </${lead ? 'button' : 'span'}></li>`).join('')}
      </ul>` : `<p class="muted">Пока пусто.</p>`}
    </section>`;
}

actions.refAdd = (el) => openRefEditor(el.dataset.kind);
actions.refEdit = (el) => {
  const list = el.dataset.kind === 'department' ? state.departments : state.categories;
  const item = list.find((x) => x.id === el.dataset.id);
  if (item) openRefEditor(el.dataset.kind, item);
};

export function showLink(name, token, { title = 'Ссылка для входа', note } = {}) {
  const url = api.linkFor(token);
  const m = openModal(`
    <div class="link-show">
      <div class="modal-head"><h3 class="modal-title">${esc(title)}</h3>
        <button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <p>${note ? esc(note) : `Отправьте эту ссылку <b>${esc(name)}</b> лично. При первом открытии человек придумает пароль и попадёт в трекер.`}</p>
      <div class="link-box"><input readonly value="${esc(url)}" aria-label="Ссылка"><button class="btn btn-primary" data-copy>${icon('copy', 16)} Скопировать</button></div>
      <p class="muted small">Ссылка показывается только сейчас. Если потеряется — выпустите новую в разделе «Команда».</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Готово</button></div>
    </div>`, { dismissable: false });
  const inp = $('input', m.el);
  inp.addEventListener('focus', () => inp.select());
  $('[data-copy]', m.el).addEventListener('click', async () => {
    if (await copyText(url)) toast('Ссылка скопирована', 'ok'); else { inp.select(); toast('Скопируйте ссылку вручную', 'info'); }
  });
  return m;
}

actions.addMember = () => {
  const m = openModal(`
    <form>
      <div class="modal-head"><h3 class="modal-title">Новый участник</h3>
        <button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <div class="form-grid">
        <label class="fl" for="nm-first">Имя</label><input id="nm-first" name="firstName" maxlength="80" required autocomplete="off">
        <label class="fl" for="nm-last">Фамилия</label><input id="nm-last" name="lastName" maxlength="80" autocomplete="off">
        <label class="fl" for="nm-pos">Должность</label><input id="nm-pos" name="position" maxlength="120" autocomplete="off">
        <label class="fl" for="nm-city">Город</label><input id="nm-city" name="city" maxlength="80" autocomplete="off">
        <label class="fl" for="nm-role">Роль</label>
        <select id="nm-role" name="role">${Object.entries(ROLE_LABELS).map(([k, l]) => `<option value="${k}" ${k === 'member' ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <p class="form-error" role="alert"></p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-submit>Добавить и получить ссылку</button></div>
    </form>`);
  const form = $('form', m.el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = Object.fromEntries(new FormData(form));
    if (!p.firstName.trim()) { $('.form-error', form).textContent = 'Укажите имя'; return; }
    const btn = $('[data-submit]', form); btn.disabled = true;
    try {
      const res = await api.createMember(p);
      m.close();
      await hooks.refresh();
      showLink(`${p.firstName} ${p.lastName}`.trim(), res.token);
    } catch (ex) { $('.form-error', form).textContent = ex.message; btn.disabled = false; }
  });
};

actions.newLink = async (el) => {
  const m = memberById(el.dataset.id); if (!m) return;
  const self = m.id === state.me.id;
  const ok = await confirmDialog({
    title: self ? 'Выпустить вам новую ссылку?' : `Новая ссылка для ${fullName(m)}?`,
    text: self ? 'Старые ссылка и пароль перестанут работать. Сейчас вы останетесь в трекере, а при следующем входе по новой ссылке зададите новый пароль.'
      : 'Старые ссылка и пароль перестанут работать, открытые сессии завершатся. По новой ссылке человек задаст новый пароль — так сбрасывают забытый пароль.',
    ok: 'Выпустить ссылку', danger: false,
  });
  if (!ok) return;
  try {
    const res = await api.reissueLink(m.id);
    await hooks.refresh();
    showLink(fullName(m), res.token, self ? { title: 'Ваша новая ссылка', note: 'Сохраните её в закладки или заметки. При следующем входе откройте её и задайте новый пароль.' } : {});
  } catch (e) { toast(e.message, 'error'); }
};

actions.makePrivate = async (el) => {
  const m = memberById(el.dataset.id); if (!m) return;
  const self = m.id === state.me.id;
  const ok = await confirmDialog({
    title: self ? 'Скрыть ваши личные задачи?' : `Скрыть задачи ${fullName(m)}?`,
    text: self ? 'Ваши личные задачи перестанут видеть все, включая администраторов. Вернуть видимость можно в настройках.'
      : 'Его личные задачи перестанут видеть все, включая вас. Командные задачи и задачи, которые вы ему поставите, останутся видны. Вернуть видимость сможет только он сам — вы не сможете.',
    ok: 'Скрыть задачи', danger: false,
  });
  if (!ok) return;
  try { await api.setPrivate(m.id, true); toast('Задачи скрыты', 'ok'); hooks.refresh(); }
  catch (e) { toast(e.message, 'error'); }
};

actions.revoke = async (el) => {
  const m = memberById(el.dataset.id); if (!m) return;
  const ok = await confirmDialog({
    title: `Отозвать доступ у ${fullName(m)}?`,
    text: 'Ссылка перестанет работать, человек выйдет из трекера на всех устройствах. Задачи сохранятся. Вернуть доступ можно, выпустив новую ссылку.',
    ok: 'Отозвать доступ',
  });
  if (!ok) return;
  try { await api.revokeLink(m.id); toast('Доступ отозван', 'ok'); hooks.refresh(); }
  catch (e) { toast(e.message, 'error'); }
};

actions.removeMember = async (el) => {
  const m = memberById(el.dataset.id); if (!m) return;
  const ok = await confirmDialog({
    title: `Удалить ${fullName(m)} из команды?`,
    text: 'Человек потеряет доступ. Его задачи останутся в истории и итогах.',
    ok: 'Удалить из команды',
  });
  if (!ok) return;
  try { await api.removeMember(m.id); toast('Участник удалён', 'ok'); hooks.refresh(); }
  catch (e) { toast(e.message, 'error'); }
};

inputs.memberRole = async (el) => {
  try { await api.setRole(el.dataset.id, el.value); toast('Роль изменена', 'ok'); hooks.refresh(); }
  catch (e) { toast(e.message, 'error'); hooks.refresh(); }
};

inputs.teamName = async (el) => {
  if (el.type !== 'text' && el.tagName !== 'INPUT') return;
  const name = el.value.trim();
  if (!name || name === state.team.name) return;
  clearTimeout(inputs.teamName.t);
  inputs.teamName.t = setTimeout(async () => {
    try { await api.updateTeam(state.team.id, { name }); state.team.name = name; hooks.render(); toast('Название сохранено', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  }, 700);
};

actions.seedDemo = async (el) => {
  el.disabled = true; el.classList.add('loading');
  try {
    const res = await api.seedDemo();
    await hooks.refresh();
    const m = openModal(`
      <div class="modal-head"><h3 class="modal-title">Демоданные добавлены</h3>
        <button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <p>Чтобы посмотреть трекер глазами другого человека, откройте его ссылку в другом браузере или в режиме инкогнито.</p>
      <ul class="demo-links">
        ${res.links.map((l) => `<li><b>${esc(l.name)}</b> <span class="muted small">${ROLE_LABELS[l.role]}</span>
          <button class="btn btn-ghost btn-sm" data-copy-url="${esc(api.linkFor(l.token))}">${icon('copy', 15)} Ссылка</button></li>`).join('')}
      </ul>
      <div class="modal-actions"><button class="btn btn-primary" data-close>Посмотреть доску</button></div>`, {
      onClose: () => { state.route = 'board'; location.hash = '#/board'; },
    });
    m.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-copy-url]');
      if (b && await copyText(b.dataset.copyUrl)) toast('Ссылка скопирована', 'ok');
    });
  } catch (e) { toast(e.message, 'error'); el.disabled = false; el.classList.remove('loading'); }
};

actions.clearDemo = async () => {
  const ok = await confirmDialog({ title: 'Очистить демоданные?', text: 'Удалятся тестовые коллеги, их задачи и демо-цели. Ваши задачи останутся.', ok: 'Очистить' });
  if (!ok) return;
  try { await api.clearDemo(); toast('Демоданные удалены', 'ok'); hooks.refresh(); }
  catch (e) { toast(e.message, 'error'); }
};
