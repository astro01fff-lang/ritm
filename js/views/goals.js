// Цели команды и личные цели. Прогресс считается автоматически по привязанным задачам.
import * as api from '../api.js';
import { state, actions, hooks, memberById, goalById, isLead, columnById } from '../store.js';
import {
  esc, $, $$, icon, avatar, fullName, shortName, openModal, confirmDialog, toast, todayISO, periodRange, fmtPeriod,
  plural, PERIOD_LABELS,
} from '../ui.js';

function progressOf(g) {
  const p = state.goalProgress[g.id] || { total: 0, done: 0 };
  return { ...p, pct: p.total ? Math.round((p.done / p.total) * 100) : 0 };
}

function goalCard(g) {
  const p = progressOf(g);
  const tasks = state.tasks.filter((t) => t.goal_id === g.id);
  const editable = isLead() || g.owner_id === state.me.id;
  const hidden = p.total - tasks.length;
  const owner = g.owner_id ? memberById(g.owner_id) : null;
  return `
    <article class="goal ${p.pct === 100 && p.total ? 'is-complete' : ''}">
      <header class="goal-head">
        <div>
          <h3>${esc(g.title)}</h3>
          <p class="muted small">${esc(fmtPeriod(periodTypeOf(g), g.period_start, g.period_end))}${owner && owner.id !== state.me.id ? ` · ${esc(fullName(owner))}` : ''}</p>
        </div>
        ${editable ? `<button class="icon-btn" data-act="goalMenu" data-id="${g.id}" aria-label="Изменить цель">${icon('edit', 16)}</button>` : ''}
      </header>
      ${g.description ? `<p class="goal-desc">${esc(g.description)}</p>` : ''}
      <div class="goal-progress">
        <b class="goal-pct">${p.pct}<small>%</small></b>
        <div class="goal-bar-wrap">
          <div class="bar bar-lg"><i style="width:${p.pct}%"></i></div>
          <span class="muted small">${p.total ? `${p.done} из ${p.total} ${plural(p.total, 'задачи', 'задач', 'задач')} выполнено` : 'Привяжите задачи, чтобы считать прогресс'}</span>
        </div>
      </div>
      ${tasks.length ? `<ul class="goal-tasks">
        ${tasks.slice(0, 8).map((t) => `<li data-act="openTask" data-id="${t.id}" class="${t.completed_at ? 'done' : ''}" tabindex="0">
          <span class="gt-check">${t.completed_at ? icon('check', 13) : ''}</span>
          <span class="gt-title">${esc(t.title)}</span>
          ${avatar(memberById(t.assignee_id), 20)}
        </li>`).join('')}
        ${tasks.length > 8 ? `<li class="muted small">и ещё ${tasks.length - 8}</li>` : ''}
      </ul>` : ''}
      ${hidden > 0 ? `<p class="muted small">Ещё ${hidden} ${plural(hidden, 'задача', 'задачи', 'задач')} в личных планах коллег</p>` : ''}
      ${editable ? `<button class="btn btn-ghost btn-sm" data-act="goalLink" data-id="${g.id}">${icon('link', 16)} Привязать задачи</button>` : ''}
    </article>`;
}

function periodTypeOf(g) {
  const [ms, me] = periodRange('month', g.period_start);
  if (g.period_start === ms && g.period_end === me) return 'month';
  const [qs, qe] = periodRange('quarter', g.period_start);
  if (g.period_start === qs && g.period_end === qe) return 'quarter';
  const [ws, we] = periodRange('week', g.period_start);
  if (g.period_start === ws && g.period_end === we) return 'week';
  return 'custom';
}

export function render() {
  const today = todayISO();
  const team = state.goals.filter((g) => !g.owner_id);
  const mine = state.goals.filter((g) => g.owner_id === state.me.id);
  const others = isLead() ? state.goals.filter((g) => g.owner_id && g.owner_id !== state.me.id) : [];
  const sortGoals = (list) => list.sort((a, b) => (a.period_end < today) - (b.period_end < today) || a.period_end.localeCompare(b.period_end));
  const section = (title, list, emptyText, kind) => `
    <h2 class="list-h">${title} <span>${list.length}</span></h2>
    ${list.length ? `<div class="goals">${sortGoals(list).map(goalCard).join('')}</div>` : `<div class="empty-inline">${emptyText}
      ${kind ? `<button class="btn btn-ghost btn-sm" data-act="newGoal" data-kind="${kind}">${icon('plus', 16)} Создать</button>` : ''}</div>`}`;

  return `
    <div class="view-head">
      <div><h1>Цели</h1><p class="muted">Прогресс считается по выполненным задачам, привязанным к цели</p></div>
      <button class="btn btn-primary" data-act="newGoal">${icon('plus', 18)} Цель</button>
    </div>
    ${section('Цели команды', team, isLead() ? 'Общих целей пока нет. Поставьте команде цель на месяц или квартал.' : 'Руководитель ещё не поставил общих целей.', isLead() ? 'team' : '')}
    ${section('Мои цели', mine, 'Личных целей нет. Поставьте себе цель — например, закрыть все встречи 1:1 до конца месяца.', 'personal')}
    ${others.length ? section('Личные цели сотрудников', others, '', '') : ''}
  `;
}

function goalForm(g = {}, kind = 'personal') {
  const lead = isLead();
  const type = g.id ? periodTypeOf(g) : 'month';
  const [s, e] = g.id ? [g.period_start, g.period_end] : periodRange('month', todayISO());
  return `
    <form class="goal-form">
      <div class="modal-head"><h3 class="modal-title">${g.id ? 'Цель' : 'Новая цель'}</h3>
        <button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <input class="input-title" name="title" maxlength="200" placeholder="Чего хотим достичь?" value="${esc(g.title || '')}">
      <textarea name="description" rows="2" maxlength="4000" placeholder="Как поймём, что цель достигнута">${esc(g.description || '')}</textarea>
      <div class="form-grid">
        ${!g.id ? `
        <label class="fl">Чья цель</label>
        <div class="seg">
          <label><input type="radio" name="owner" value="personal" ${kind !== 'team' || !lead ? 'checked' : ''}><span>Моя</span></label>
          ${lead ? `<label><input type="radio" name="owner" value="team" ${kind === 'team' ? 'checked' : ''}><span>Команды</span></label>` : ''}
        </div>` : ''}
        <label class="fl">Период</label>
        <div class="period-picker">
          <select name="ptype">${['week', 'month', 'quarter', 'custom'].map((k) => `<option value="${k}" ${k === type ? 'selected' : ''}>${PERIOD_LABELS[k]}</option>`).join('')}</select>
          <input type="date" name="pstart" value="${esc(s)}" aria-label="Начало">
          <input type="date" name="pend" value="${esc(e)}" ${type === 'custom' ? '' : 'hidden'} aria-label="Окончание">
          <span class="period-label muted">${esc(fmtPeriod(type, s, e))}</span>
        </div>
      </div>
      <p class="form-error" role="alert"></p>
      <div class="modal-actions ${g.id ? 'spread' : ''}">
        ${g.id ? `<button type="button" class="btn btn-danger-ghost" data-del>${icon('trash', 16)} Удалить цель</button>` : `<button type="button" class="btn btn-ghost" data-close>Отмена</button>`}
        <button class="btn btn-primary">${g.id ? 'Сохранить' : 'Создать цель'}</button>
      </div>
    </form>`;
}

function wirePeriod(form) {
  const upd = () => {
    const type = form.ptype.value;
    form.pend.hidden = type !== 'custom';
    const [s, e] = periodRange(type, form.pstart.value || todayISO(), form.pend.value);
    if (type === 'custom' && !form.pend.value) form.pend.value = e;
    $('.period-label', form).textContent = fmtPeriod(type, s, e);
  };
  form.ptype.addEventListener('change', upd);
  form.pstart.addEventListener('change', upd);
  form.pend.addEventListener('change', upd);
  return () => periodRange(form.ptype.value, form.pstart.value || todayISO(), form.pend.value);
}

actions.newGoal = (el) => {
  const m = openModal(goalForm({}, el.dataset.kind), { wide: false });
  const form = $('form', m.el);
  const readPeriod = wirePeriod(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) { $('.form-error', form).textContent = 'Назовите цель'; return; }
    const [s, end] = readPeriod();
    const team = form.owner?.value === 'team';
    try {
      await api.createGoal({
        team_id: state.team.id, owner_id: team ? null : state.me.id, title,
        description: form.description.value.trim(), period_start: s, period_end: end, created_by: state.me.id,
      });
      m.close(); toast('Цель создана', 'ok'); hooks.refresh();
    } catch (ex) { $('.form-error', form).textContent = ex.message; }
  });
};

actions.goalMenu = (el) => {
  const g = goalById(el.dataset.id); if (!g) return;
  const m = openModal(goalForm(g));
  const form = $('form', m.el);
  const readPeriod = wirePeriod(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) { $('.form-error', form).textContent = 'Назовите цель'; return; }
    const [s, end] = readPeriod();
    try {
      await api.updateGoal(g.id, { title, description: form.description.value.trim(), period_start: s, period_end: end });
      m.close(); toast('Цель сохранена', 'ok'); hooks.refresh();
    } catch (ex) { $('.form-error', form).textContent = ex.message; }
  });
  $('[data-del]', form).addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Удалить цель?', text: 'Задачи останутся, просто отвяжутся от цели.' }))) return;
    try { await api.deleteGoal(g.id); m.close(); toast('Цель удалена', 'ok'); hooks.refresh(); }
    catch (ex) { toast(ex.message, 'error'); }
  });
};

actions.goalLink = (el) => {
  const g = goalById(el.dataset.id); if (!g) return;
  const editable = state.tasks.filter((t) => isLead() || t.assignee_id === state.me.id || t.author_id === state.me.id);
  const list = editable.sort((a, b) => (b.goal_id === g.id) - (a.goal_id === g.id) || (!!a.completed_at - !!b.completed_at));
  const m = openModal(`
    <form>
      <div class="modal-head"><h3 class="modal-title">Задачи цели</h3>
        <button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <p class="muted">${esc(g.title)}</p>
      <label class="search">${icon('search', 16)}<input type="search" placeholder="Найти задачу" data-link-q></label>
      <ul class="link-list">
        ${list.map((t) => `<li data-title="${esc(t.title.toLowerCase())}">
          <label class="check-row">
            <input type="checkbox" value="${t.id}" ${t.goal_id === g.id ? 'checked' : ''}>
            <span>${esc(t.title)}<br><small class="muted">${esc(shortName(memberById(t.assignee_id)))} · ${esc(columnById(t.column_id)?.name || '')}${t.goal_id && t.goal_id !== g.id ? ' · привязана к другой цели' : ''}</small></span>
          </label></li>`).join('') || '<li class="muted">Нет задач, которые вы можете изменить</li>'}
      </ul>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary">Сохранить</button></div>
    </form>`, { wide: true });
  const form = $('form', m.el);
  $('[data-link-q]', form).addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('.link-list li', form).forEach((li) => { li.hidden = q && !li.dataset.title?.includes(q); });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const changes = $$('input[type=checkbox]', form).map((c) => {
      const t = state.tasks.find((x) => x.id === c.value);
      if (c.checked && t.goal_id !== g.id) return [t.id, g.id];
      if (!c.checked && t.goal_id === g.id) return [t.id, null];
      return null;
    }).filter(Boolean);
    try {
      for (const [id, goal] of changes) await api.updateTask(id, { goal_id: goal });
      m.close(); if (changes.length) toast('Задачи обновлены', 'ok'); hooks.refresh();
    } catch (ex) { toast(ex.message, 'error'); hooks.refresh(); }
  });
};
