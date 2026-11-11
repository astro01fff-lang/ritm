// Создание задачи, подробная карточка, отметка выполнения и указание времени.
import * as api from './api.js';
import {
  state, actions, inputs, hooks, memberById, columnById, taskById, goalById, activeMembers, isLead,
  canEdit, canDelete, canReassign, doneColumn, firstColumn, isOverdue, groupCopies, deptById, catById, highFivesFor,
  myDepartments, departmentsFor,
} from './store.js';
import {
  esc, $, $$, icon, avatar, fullName, shortName, openModal, confirmDialog, toast, debounce,
  todayISO, periodRange, fmtPeriod, fmtDate, fmtDateTime, fmtMinutes, timeAgo, PERIOD_LABELS, PRIORITY_LABELS,
} from './ui.js';

// ====================================================================== время

const QUICK_TIMES = [[15, '15 мин'], [30, '30 мин'], [60, '1 ч'], [120, '2 ч'], [240, 'Полдня'], [480, 'День']];

export function askTime(task, { title = 'Сколько примерно заняло?', skipLabel = 'Пропустить' } = {}) {
  return new Promise((resolve) => {
    let saved = false;
    const cur = task.spent_minutes;
    const m = openModal(`
      <div class="time-ask">
        <div class="time-ask-mark">${icon('checkCircle', 28)}</div>
        <h3 class="modal-title">${esc(title)}</h3>
        <p class="muted time-ask-task">${esc(task.title)}</p>
        <div class="time-quick">
          ${QUICK_TIMES.map(([v, l]) => `<button type="button" class="time-chip ${cur === v ? 'on' : ''}" data-min="${v}">${l}</button>`).join('')}
        </div>
        <form class="time-custom">
          <label>Своё время</label>
          <div class="time-custom-row">
            <input type="number" min="0" max="999" name="h" placeholder="0" value="${cur != null && !QUICK_TIMES.some(([v]) => v === cur) ? Math.floor(cur / 60) : ''}" aria-label="Часы"> <span>ч</span>
            <input type="number" min="0" max="59" name="m" placeholder="0" value="${cur != null && !QUICK_TIMES.some(([v]) => v === cur) ? cur % 60 : ''}" aria-label="Минуты"> <span>мин</span>
            <button class="btn btn-primary" type="submit">Сохранить</button>
          </div>
        </form>
        <button class="btn btn-ghost btn-block" data-close>${esc(skipLabel)}</button>
      </div>`, { onClose: () => { if (!saved) resolve(null); } });

    const save = async (minutes) => {
      saved = true; m.close();
      const t = taskById(task.id); if (t) t.spent_minutes = minutes;
      hooks.render(); hooks.renderDrawer();
      try { await api.updateTask(task.id, { spent_minutes: minutes }); toast(`Записано: ${fmtMinutes(minutes)}`, 'ok'); }
      catch (e) { toast(e.message, 'error'); hooks.refresh(); }
      resolve(minutes);
    };
    $$('[data-min]', m.el).forEach((b) => b.addEventListener('click', () => save(Number(b.dataset.min))));
    $('.time-custom', m.el).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const minutes = (Number(f.get('h')) || 0) * 60 + (Number(f.get('m')) || 0);
      if (!minutes) { toast('Укажите часы или минуты', 'error'); return; }
      save(minutes);
    });
  });
}

// ====================================================================== перемещение и выполнение

function endPosition(columnId, excludeId) {
  const ps = state.tasks.filter((t) => t.column_id === columnId && t.id !== excludeId).map((t) => t.position);
  return (ps.length ? Math.max(...ps) : 0) + 1000;
}

// Переместить задачу; если она попала в «выполненные» — спросить время
export async function moveTask(task, columnId, position) {
  const col = columnById(columnId);
  const wasDone = !!task.completed_at;
  const patch = { column_id: columnId, position: position ?? endPosition(columnId, task.id) };
  Object.assign(task, patch);
  task.completed_at = col?.is_done ? (task.completed_at || new Date().toISOString()) : null;
  hooks.render(); hooks.renderDrawer();
  try {
    const saved = await api.updateTask(task.id, patch);
    Object.assign(task, saved);
  } catch (e) {
    toast(e.message, 'error'); hooks.refresh(); return;
  }
  if (col?.is_done && !wasDone) {
    celebrate();
    await askTime(task);
  }
}

export function completeTask(task) {
  const done = doneColumn();
  if (!done) { toast('Нет колонки для выполненных задач. Отметьте её в меню колонки', 'error'); return; }
  return moveTask(task, done.id);
}

export function reopenTask(task) {
  const back = state.columns.find((c) => !c.is_done && /работ/i.test(c.name)) || firstColumn();
  return moveTask(task, back.id);
}

function celebrate() {
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}"></i>`).join('');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ====================================================================== создание

function periodFields(prefix, type, start, end) {
  const [s, e] = type === 'none' ? [null, null] : periodRange(type, start || todayISO(), end);
  return `
    <div class="period-picker" data-prefix="${prefix}">
      <select name="period_type" data-on="periodType" aria-label="Период">
        ${Object.entries(PERIOD_LABELS).map(([k, l]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <input type="date" name="period_anchor" value="${esc(s || todayISO())}" data-on="periodType" ${type === 'none' ? 'hidden' : ''} aria-label="Дата начала">
      <input type="date" name="period_end" value="${esc(e || '')}" data-on="periodType" ${type === 'custom' ? '' : 'hidden'} aria-label="Дата окончания">
      <span class="period-label muted">${type === 'none' ? '' : esc(fmtPeriod(type, s, e))}</span>
    </div>`;
}

function readPeriod(root) {
  const type = $('[name=period_type]', root).value;
  if (type === 'none') return { period_type: 'none', period_start: null, period_end: null };
  const [s, e] = periodRange(type, $('[name=period_anchor]', root).value || todayISO(), $('[name=period_end]', root).value);
  return { period_type: type, period_start: s, period_end: e };
}

inputs.periodType = (el) => {
  const root = el.closest('.period-picker');
  const type = $('[name=period_type]', root).value;
  $('[name=period_anchor]', root).hidden = type === 'none';
  $('[name=period_end]', root).hidden = type !== 'custom';
  const p = readPeriod(root);
  if (type === 'custom' && !$('[name=period_end]', root).value) $('[name=period_end]', root).value = p.period_end || '';
  $('.period-label', root).textContent = type === 'none' ? '' : fmtPeriod(p.period_type, p.period_start, p.period_end);
  if (el.closest('.drawer')) saveDrawerPeriod(root);
};

export function openCreateTask(preset = {}) {
  const me = state.me;
  const lead = isLead();
  const col = preset.column_id || firstColumn()?.id;
  const kind = preset.kind || 'personal';
  const selected = new Set(preset.assignees || [me.id]);
  const members = activeMembers();
  const goals = state.goals;

  const m = openModal(`
    <form class="task-form" novalidate>
      <div class="modal-head">
        <h3 class="modal-title">Новая задача</h3>
        <button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button>
      </div>
      <input class="input-title" name="title" placeholder="Что нужно сделать?" maxlength="300" autofocus>
      <textarea name="description" rows="3" placeholder="Описание, ссылки, детали"></textarea>

      <div class="form-grid">
        <label class="fl">Тип</label>
        <div class="seg" role="radiogroup">
          <label><input type="radio" name="kind" value="personal" ${kind === 'personal' ? 'checked' : ''}><span>Личная</span></label>
          <label><input type="radio" name="kind" value="team" ${kind === 'team' ? 'checked' : ''}><span>Командная</span></label>
        </div>

        <label class="fl">Исполнители</label>
        <div class="assignee-pick">
          <button type="button" class="chip chip-all" data-pick-all>Все</button>
          ${members.map((x) => `
            <label class="chip pick ${selected.has(x.id) ? 'on' : ''}" ${x.id !== me.id ? 'data-other' : ''}>
              <input type="checkbox" name="assignee" value="${x.id}" ${selected.has(x.id) ? 'checked' : ''}>
              ${avatar(x, 20)}<span>${x.id === me.id ? 'Я' : esc(shortName(x))}</span>
            </label>`).join('')}
          <p class="hint assignee-hint"></p>
        </div>

        <label class="fl">Период</label>
        ${periodFields('c', preset.period_type || 'week', preset.period_start)}

        <label class="fl" for="f-deadline">Дедлайн</label>
        <input id="f-deadline" type="date" name="deadline" value="${esc(preset.deadline || '')}">

        <label class="fl">Приоритет</label>
        <div class="seg seg-prio">
          ${['low', 'medium', 'high'].map((p) => `<label><input type="radio" name="priority" value="${p}" ${p === 'medium' ? 'checked' : ''}><span class="sp-${p}">${PRIORITY_LABELS[p]}</span></label>`).join('')}
        </div>

        <label class="fl" for="f-col">Колонка</label>
        <select id="f-col" name="column_id">
          ${state.columns.map((c) => `<option value="${c.id}" ${c.id === col ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>

        <label class="fl" for="f-cat">Категория</label>
        <select id="f-cat" name="category_id">
          <option value="">Без категории</option>
          ${state.categories.map((x) => `<option value="${x.id}" ${x.id === preset.category_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>

        <label class="fl" for="f-dep">Отдел</label>
        <select id="f-dep" name="department_id">
          <option value="">${myDepartments().length ? 'Без отдела' : 'Своих отделов пока нет'}</option>
          ${myDepartments().map((x) => `<option value="${x.id}" ${x.id === preset.department_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>

        <label class="fl" for="f-goal">Цель</label>
        <select id="f-goal" name="goal_id">
          <option value="">Без цели</option>
          ${goals.map((g) => `<option value="${g.id}" ${g.id === preset.goal_id ? 'selected' : ''}>${esc(g.title)}${g.owner_id ? '' : ' (команда)'}</option>`).join('')}
        </select>
      </div>

      <div class="form-block">
        <div class="block-head"><span>Подзадачи</span></div>
        <div class="sub-new-list"></div>
        <div class="sub-add-row">
          <input class="sub-new-input" placeholder="Добавить подзадачу и нажать Enter" maxlength="300">
          <button type="button" class="btn btn-ghost btn-sm" data-sub-add>${icon('plus', 16)} Добавить</button>
        </div>
      </div>

      <div class="form-block">
        <div class="block-head"><span>Вложения</span></div>
        <label class="file-drop">${icon('clip', 16)} <span class="file-names">Прикрепить файлы до 20 МБ</span>
          <input type="file" name="files" multiple hidden>
        </label>
      </div>

      <p class="form-error" role="alert"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-close>Отмена</button>
        <button type="submit" class="btn btn-primary" data-submit>Создать задачу</button>
      </div>
    </form>`, { wide: true });

  const form = $('form', m.el);
  const subs = [];
  const renderSubs = () => {
    $('.sub-new-list', form).innerHTML = subs.map((s, i) => `
      <div class="sub-new"><span class="sub-dot"></span><span>${esc(s)}</span>
      <button type="button" class="icon-btn icon-btn-sm" data-sub-del="${i}" aria-label="Убрать">${icon('close', 14)}</button></div>`).join('');
  };
  const addSub = () => {
    const inp = $('.sub-new-input', form);
    const v = inp.value.trim(); if (!v) return;
    subs.push(v); inp.value = ''; renderSubs(); inp.focus();
  };
  $('.sub-new-input', form).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
  $('[data-sub-add]', form).addEventListener('click', addSub);
  form.addEventListener('click', (e) => {
    const d = e.target.closest('[data-sub-del]');
    if (d) { subs.splice(Number(d.dataset.subDel), 1); renderSubs(); }
  });

  const sync = () => {
    const kindNow = $('[name=kind]:checked', form).value;
    // личную задачу участник ставит только себе; командную — кому угодно
    const othersAllowed = lead || kindNow === 'team';
    $$('[data-other]', form).forEach((l) => {
      l.hidden = !othersAllowed;
      if (!othersAllowed) $('input', l).checked = false;
    });
    const allBtn = $('[data-pick-all]', form); if (allBtn) allBtn.hidden = !othersAllowed;
    const checked = $$('[name=assignee]:checked', form);
    $$('.pick', form).forEach((l) => l.classList.toggle('on', $('input', l).checked));
    const kindVal = $('[name=kind]:checked', form).value;
    const n = checked.length;
    const hint = $('.assignee-hint', form);
    if (n > 1) hint.textContent = `У каждого появится своя копия задачи со своим статусом и временем (${n} шт.)`;
    else if (n === 0) hint.textContent = kindVal === 'team' ? 'Без исполнителя — задачу сможет взять любой участник' : 'Выберите исполнителя или сделайте задачу командной';
    else hint.textContent = !lead && kindVal === 'personal' ? 'Личную задачу можно поставить только себе. Чтобы поставить коллеге, выберите «Командная»' : '';
    $('[data-submit]', form).textContent = n > 1 ? `Создать ${n} задачи` : 'Создать задачу';
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'files') {
      const files = Array.from(e.target.files);
      $('.file-names', form).textContent = files.length ? files.map((f) => f.name).join(', ') : 'Прикрепить файлы до 20 МБ';
    }
    sync();
  });
  const all = $('[data-pick-all]', form);
  if (all) all.addEventListener('click', () => {
    const boxes = $$('[name=assignee]', form);
    const allOn = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; });
    sync();
  });
  sync();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    const f = new FormData(form);
    const title = String(f.get('title') || '').trim();
    const kindVal = f.get('kind');
    const assignees = f.getAll('assignee');
    if (!title) { err.textContent = 'Напишите, что нужно сделать'; $('[name=title]', form).focus(); return; }
    if (!assignees.length && kindVal !== 'team') { err.textContent = 'Выберите исполнителя или сделайте задачу командной'; return; }
    const period = readPeriod($('.period-picker', form));
    const columnId = String(f.get('column_id'));
    const base = {
      team_id: state.team.id, author_id: me.id, kind: kindVal, title,
      description: String(f.get('description') || '').trim(),
      ...period,
      deadline: f.get('deadline') || null,
      priority: f.get('priority') || 'medium',
      column_id: columnId,
      position: endPosition(columnId),
      category_id: f.get('category_id') || null,
      department_id: f.get('department_id') || null,
      goal_id: f.get('goal_id') || null,
    };
    const btn = $('[data-submit]', form);
    btn.disabled = true; btn.classList.add('loading');
    try {
      const created = await api.createTasks(base, assignees, subs);
      const files = Array.from($('[name=files]', form).files || []);
      for (const t of created) for (const file of files) await api.uploadAttachment(t.id, me.id, file);
      m.close();
      toast(created.length > 1 ? `Создано задач: ${created.length}` : 'Задача создана', 'ok');
      await hooks.refresh();
      const done = columnById(columnId)?.is_done;
      if (done && created.length === 1) askTime(taskById(created[0].id) || created[0]);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
}

// ====================================================================== подробная карточка

let drawerData = { taskId: null, subtasks: [], comments: [], attachments: [], history: [], pushes: [], loading: false };

export async function openTask(id) {
  state.openTaskId = id;
  drawerData = { taskId: id, subtasks: [], comments: [], attachments: [], history: [], pushes: [], loading: true };
  renderDrawer();
  await reloadDrawer();
}

export function closeTask() {
  state.openTaskId = null;
  const host = $('#drawer');
  host.classList.remove('in');
  setTimeout(() => { if (!state.openTaskId) host.innerHTML = ''; }, 200);
  if (location.hash.startsWith('#/task/')) history.replaceState(null, '', location.pathname + location.search);
}

export async function reloadDrawer() {
  const id = state.openTaskId; if (!id) return;
  try {
    const [subtasks, comments, attachments, history, pushes] = await Promise.all([
      api.loadSubtasks(id), api.loadComments(id), api.loadAttachments(id), api.loadHistory(id), api.loadPushes(id),
    ]);
    if (state.openTaskId !== id) return;
    drawerData = { taskId: id, subtasks, comments, attachments, history, pushes, loading: false };
  } catch (e) {
    drawerData.loading = false;
    toast(e.message, 'error');
  }
  renderDrawer();
}

const FIELD_NAMES = {
  title: 'название', description: 'описание', column: 'статус', assignee: 'исполнителя', deadline: 'дедлайн',
  priority: 'приоритет', period: 'период', spent: 'время', kind: 'тип', category: 'категорию', goal: 'цель', department: 'отдел',
};

function historyLine(h) {
  const who = esc(shortName(memberById(h.actor_id)) || 'Система');
  if (h.action === 'created') return `${who} создал(а) задачу`;
  const d = h.details || {};
  const parts = [];
  if (d.column) parts.push(`перенёс(ла) в «${esc(d.column[1])}»`);
  if (d.assignee) parts.push(`назначил(а) ${esc(d.assignee[1] || 'никого')}`);
  if (d.spent) parts.push(`указал(а) время: ${esc(fmtMinutes(d.spent[1]) || '—')}`);
  if (d.deadline) parts.push(`дедлайн: ${esc(d.deadline[1] ? fmtDate(d.deadline[1]) : 'убран')}`);
  if (d.priority) parts.push(`приоритет: ${esc(PRIORITY_LABELS[d.priority[1]] || '')}`);
  if (d.category) parts.push(`категория: ${esc(d.category[1] || 'нет')}`);
  if (d.department) parts.push(`отдел: ${esc(d.department[1] || 'нет')}`);
  const other = Object.keys(d).filter((k) => !['column', 'assignee', 'spent', 'deadline', 'priority', 'category', 'department'].includes(k));
  if (other.length) parts.push(`изменил(а) ${other.map((k) => FIELD_NAMES[k] || k).join(', ')}`);
  const lead = h.action === 'completed' ? ' выполнил(а) задачу' : h.action === 'reopened' ? ' вернул(а) в работу' : '';
  return `${who}${lead}${parts.length ? (lead ? '; ' : ' ') + parts.join('; ') : ''}`;
}

export function renderDrawer() {
  const host = $('#drawer');
  if (!host) return;
  const t = taskById(state.openTaskId);
  if (!state.openTaskId) return;
  if (!t) {
    if (state.loaded) { closeTask(); toast('Задача удалена или недоступна', 'info'); }
    return;
  }
  // сохраняем фокус и прокрутку при перерисовке
  const active = document.activeElement;
  const focusKey = active && host.contains(active) ? active.dataset.focusKey : null;
  const selStart = focusKey && 'selectionStart' in active ? active.selectionStart : null;
  const scroll = $('.drawer-body', host)?.scrollTop || 0;
  if (focusKey && (active.tagName === 'TEXTAREA' || active.type === 'text') && active.dataset.dirty) return;

  const editable = canEdit(t);
  const dis = editable ? '' : 'disabled';
  const lead = isLead();
  const members = activeMembers();
  const col = columnById(t.column_id);
  const copies = groupCopies(t.group_id);
  const { subtasks, comments, attachments, history, loading } = drawerData;
  const subDone = subtasks.filter((s) => s.done).length;

  host.innerHTML = `
    <div class="drawer-scrim" data-act="closeTask"></div>
    <aside class="drawer" role="dialog" aria-label="Задача">
      <header class="drawer-head">
        <select class="status-select ${t.completed_at ? 'is-done' : ''}" data-on="drawerColumn" ${dis} aria-label="Статус">
          ${state.columns.map((c) => `<option value="${c.id}" ${c.id === t.column_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <div class="drawer-head-actions">
          ${!t.completed_at && t.assignee_id === state.me.id ? `<button class="btn btn-ghost btn-sm" data-act="focusOnTask" data-id="${t.id}" title="Запустить таймер концентрации на эту задачу">${icon('clock', 16)} Фокус</button>` : ''}
          ${editable && t.completed_at && !t.archived_at ? `<button class="btn btn-ghost btn-sm" data-act="archiveOpen" title="Убрать с доски в архив">${icon('archive', 16)} В архив</button>` : ''}
          ${t.archived_at ? `<span class="archived-badge">${icon('archive', 14)} В архиве</span>` : ''}
          ${editable ? (t.completed_at
            ? `<button class="btn btn-ghost btn-sm" data-act="reopenOpen">Вернуть в работу</button>`
            : `<button class="btn btn-primary btn-sm" data-act="completeOpen">${icon('check', 16)} Выполнено</button>`) : ''}
          ${canDelete(t) ? `<button class="icon-btn" data-act="deleteOpen" aria-label="Удалить задачу" title="Удалить">${icon('trash')}</button>` : ''}
          <button class="icon-btn" data-act="closeTask" aria-label="Закрыть">${icon('close')}</button>
        </div>
      </header>
      <div class="drawer-body">
        <textarea class="title-edit" rows="1" data-field="title" data-focus-key="title" maxlength="300" ${dis}>${esc(t.title)}</textarea>
        ${isOverdue(t) ? `<p class="overdue-note">${icon('flag', 14)} Дедлайн прошёл ${esc(fmtDate(t.deadline))}</p>` : ''}
        ${kudosBar(t)}

        <dl class="meta-grid">
          <dt>Исполнитель</dt>
          <dd>${canReassign(t) && editable ? `
            <select data-field="assignee_id" data-focus-key="assignee">
              ${t.kind === 'team' ? `<option value="">Не назначен</option>` : ''}
              ${members.map((x) => `<option value="${x.id}" ${x.id === t.assignee_id ? 'selected' : ''}>${esc(fullName(x))}</option>`).join('')}
            </select>` : `<span class="who">${avatar(memberById(t.assignee_id), 22)} ${esc(fullName(memberById(t.assignee_id)))}</span>
              ${t.kind === 'team' && !t.assignee_id ? `<button class="btn btn-ghost btn-sm" data-act="takeTask">Взять себе</button>` : ''}`}
          </dd>

          <dt>Поставил(а)</dt>
          <dd><span class="who">${avatar(memberById(t.author_id), 22)} ${esc(fullName(memberById(t.author_id)))}</span>
            <span class="muted small">${esc(fmtDate(t.created_at.slice(0, 10)))}</span></dd>

          <dt>Тип</dt>
          <dd><select data-field="kind" data-focus-key="kind" ${dis}>
            <option value="personal" ${t.kind === 'personal' ? 'selected' : ''}>Личная</option>
            <option value="team" ${t.kind === 'team' ? 'selected' : ''}>Командная — видят все</option>
          </select></dd>

          <dt>Период</dt>
          <dd class="${editable ? '' : 'is-readonly'}">${periodFields('d', t.period_type, t.period_start, t.period_end)}</dd>

          <dt>Дедлайн</dt>
          <dd><input type="date" data-field="deadline" data-focus-key="deadline" value="${esc(t.deadline || '')}" ${dis}></dd>

          <dt>Приоритет</dt>
          <dd><div class="seg seg-prio seg-sm">
            ${['low', 'medium', 'high'].map((p) => `<label><input type="radio" name="d-prio" data-field="priority" value="${p}" ${t.priority === p ? 'checked' : ''} ${dis}><span class="sp-${p}">${PRIORITY_LABELS[p]}</span></label>`).join('')}
          </div></dd>

          <dt>Категория</dt>
          <dd><select data-field="category_id" data-focus-key="category" ${dis}>
            <option value="">Без категории</option>
            ${state.categories.map((c) => `<option value="${c.id}" ${c.id === t.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></dd>

          <dt>Отдел</dt>
          <dd><select data-field="department_id" data-focus-key="department" ${dis}>
            <option value="">Без отдела</option>
            ${departmentsFor(t.assignee_id).map((d) => `<option value="${d.id}" ${d.id === t.department_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
            ${t.department_id && !departmentsFor(t.assignee_id).some((d) => d.id === t.department_id) ? `<option value="${t.department_id}" selected>${esc(deptById(t.department_id)?.name || 'Отдел коллеги')}</option>` : ''}
          </select></dd>

          <dt>Цель</dt>
          <dd><select data-field="goal_id" data-focus-key="goal" ${dis}>
            <option value="">Без цели</option>
            ${state.goals.map((g) => `<option value="${g.id}" ${g.id === t.goal_id ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}
            ${t.goal_id && !goalById(t.goal_id) ? `<option value="${t.goal_id}" selected>Цель недоступна</option>` : ''}
          </select></dd>

          <dt>Потрачено</dt>
          <dd class="spent-row">
            <span class="${t.spent_minutes ? 'spent-val' : 'muted'}">${t.spent_minutes ? esc(fmtMinutes(t.spent_minutes)) : (t.completed_at ? 'не указано' : 'укажете при выполнении')}</span>
            ${editable ? `<button class="btn btn-ghost btn-sm" data-act="editTime">${t.spent_minutes ? 'Изменить' : 'Указать'}</button>` : ''}
          </dd>
        </dl>

        <section class="d-section">
          <h4>Описание</h4>
          <textarea class="desc-edit" data-field="description" data-focus-key="description" rows="4" placeholder="${editable ? 'Добавьте детали, ссылки, ожидаемый результат' : 'Описания нет'}" ${dis}>${esc(t.description)}</textarea>
        </section>

        ${copies.length > 1 ? `
        <section class="d-section">
          <h4>Назначена ${copies.length} ${copies.length < 5 ? 'людям' : 'людям'} <span class="muted">выполнили ${copies.filter((c) => c.completed_at).length} из ${copies.length}</span></h4>
          <ul class="copies">
            ${copies.map((c) => `<li class="${c.id === t.id ? 'is-current' : ''}" data-act="openTask" data-id="${c.id}">
              ${avatar(memberById(c.assignee_id), 22)} <span>${esc(fullName(memberById(c.assignee_id)))}</span>
              <span class="copy-status ${c.completed_at ? 'ok' : ''}">${c.completed_at ? `${icon('check', 14)} ${c.spent_minutes ? esc(fmtMinutes(c.spent_minutes)) : 'готово'}` : esc(columnById(c.column_id)?.name || '')}</span>
            </li>`).join('')}
          </ul>
        </section>` : ''}

        <section class="d-section">
          <h4>Подзадачи ${subtasks.length ? `<span class="muted">${subDone} из ${subtasks.length}</span>` : ''}</h4>
          ${subtasks.length ? `<div class="bar"><i style="width:${Math.round(subDone / subtasks.length * 100)}%"></i></div>` : ''}
          <ul class="subtasks">
            ${subtasks.map((s) => `<li class="${s.done ? 'done' : ''}">
              <label class="check"><input type="checkbox" data-on="subToggle" data-id="${s.id}" ${s.done ? 'checked' : ''} ${dis}><span></span></label>
              <span class="sub-title">${esc(s.title)}</span>
              ${editable ? `<button class="icon-btn icon-btn-sm" data-act="subDelete" data-id="${s.id}" aria-label="Удалить подзадачу">${icon('close', 14)}</button>` : ''}
            </li>`).join('')}
          </ul>
          ${editable ? `<form class="inline-add" data-form="subAdd"><input name="title" placeholder="Новая подзадача" maxlength="300" data-focus-key="subnew"><button class="btn btn-ghost btn-sm">${icon('plus', 16)}</button></form>` : ''}
        </section>

        <section class="d-section">
          <h4>Вложения ${attachments.length ? `<span class="muted">${attachments.length}</span>` : ''}</h4>
          <ul class="files">
            ${attachments.map((a) => `<li>
              ${icon('clip', 16)}
              <button class="link-btn" data-act="openFile" data-id="${a.id}">${esc(a.file_name)}</button>
              <span class="muted small">${(a.size_bytes / 1024 / 1024).toFixed(a.size_bytes > 1048576 ? 1 : 2)} МБ</span>
              ${a.uploaded_by === state.me.id || lead ? `<button class="icon-btn icon-btn-sm" data-act="fileDelete" data-id="${a.id}" aria-label="Удалить файл">${icon('trash', 14)}</button>` : ''}
            </li>`).join('')}
          </ul>
          <label class="file-drop file-drop-sm">${icon('plus', 16)} Прикрепить файл
            <input type="file" multiple hidden data-on="fileUpload"></label>
        </section>

        <section class="d-section">
          <h4>Комментарии ${comments.length ? `<span class="muted">${comments.length}</span>` : ''}</h4>
          <ul class="comments">
            ${comments.map((c) => `<li>
              ${avatar(memberById(c.author_id), 26)}
              <div><div class="c-head"><b>${esc(shortName(memberById(c.author_id)))}</b> <span class="muted small">${esc(timeAgo(c.created_at))}</span>
                ${c.author_id === state.me.id ? `<button class="link-btn small" data-act="commentDelete" data-id="${c.id}">удалить</button>` : ''}</div>
              <p>${esc(c.body).replace(/\n/g, '<br>')}</p></div>
            </li>`).join('') || (loading ? '' : '<li class="muted small empty-line">Пока без комментариев</li>')}
          </ul>
          <form class="comment-form" data-form="commentAdd">
            <textarea name="body" rows="2" placeholder="Написать комментарий" maxlength="5000" data-focus-key="comment"></textarea>
            <button class="btn btn-primary btn-sm">Отправить</button>
          </form>
        </section>

        <details class="d-section history">
          <summary><h4>${icon('history', 16)} История изменений</h4></summary>
          <ul>
            ${history.map((h) => `<li><span class="muted small">${esc(fmtDateTime(h.created_at))}</span> ${historyLine(h)}</li>`).join('')}
          </ul>
        </details>
      </div>
    </aside>`;

  requestAnimationFrame(() => host.classList.add('in'));
  const body = $('.drawer-body', host);
  body.scrollTop = scroll;
  autoGrow($('.title-edit', host));
  if (focusKey) {
    const el = $(`[data-focus-key="${focusKey}"]`, host);
    if (el) { el.focus(); if (selStart != null && 'setSelectionRange' in el) { try { el.setSelectionRange(selStart, selStart); } catch { /* ignore */ } } }
  }
}

function kudosBar(t) {
  const me = state.me.id;
  if (!t.assignee_id) return '';
  if (t.completed_at) {
    const fives = highFivesFor(t.id);
    const mine = fives.find((h) => h.from_id === me);
    const names = fives.map((h) => shortName(memberById(h.from_id))).join(', ');
    if (t.assignee_id === me && !fives.length) return '';
    return `
      <div class="kudos">
        ${t.assignee_id !== me ? (mine
          ? `<button class="kudos-btn on" data-act="takeFive" data-id="${mine.id}" title="Забрать хай-файв">🙌 Вы дали пять</button>`
          : `<button class="kudos-btn" data-act="giveFive">🙌 Дать пять</button>`) : ''}
        ${fives.length ? `<span class="kudos-who">${fives.slice(0, 5).map((h) => avatar(memberById(h.from_id), 22)).join('')}
          <span class="muted small">${t.assignee_id === me ? 'Вам дали пять: ' : ''}${esc(names)}</span></span>` : ''}
      </div>`;
  }
  if (t.assignee_id === me) return '';
  const last = drawerData.pushes.find((p) => p.from_id === me);
  return `
    <div class="kudos">
      <button class="kudos-btn" data-act="pushOpen">👋 Напомнить ${esc(shortName(memberById(t.assignee_id)))}</button>
      ${last ? `<span class="muted small">Вы напоминали ${esc(timeAgo(last.created_at))}</span>` : ''}
    </div>`;
}

const PUSH_PRESETS = ['Как продвигается?', 'Нужна помощь?', 'Дедлайн скоро — успеваем?', 'Жду, когда будет готово 🙏'];

// Окно выбора текста напоминания. Возвращает текст или null.
export function askPushMessage(title) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(`
      <form class="push-form">
        <div class="modal-head"><h3 class="modal-title">${esc(title)}</h3>
          <button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
        <div class="push-presets">
          ${PUSH_PRESETS.map((p, i) => `<label class="push-preset"><input type="radio" name="preset" value="${esc(p)}" ${i === 0 ? 'checked' : ''}><span>${esc(p)}</span></label>`).join('')}
        </div>
        <label class="fl" for="push-text">Или свой текст</label>
        <input id="push-text" name="text" maxlength="200" placeholder="Например, загляни в комментарии">
        <p class="muted small">Придёт уведомлением. Об одной задаче можно напоминать не чаще раза в 3 часа.</p>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary">👋 Напомнить</button></div>
      </form>`, { onClose: () => { if (!done) resolve(null); } });
    const form = $('form', m.el);
    form.text.addEventListener('input', () => { $$('[name=preset]', form).forEach((r) => { r.checked = false; }); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = form.text.value.trim() || form.querySelector('[name=preset]:checked')?.value || PUSH_PRESETS[0];
      done = true; m.close(); resolve(msg);
    });
  });
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ---------------------------------------------------------------- автосохранение полей карточки

const textSavers = {};
function saveField(field, value) {
  const t = taskById(state.openTaskId); if (!t) return;
  if (field === 'title' && !String(value).trim()) { toast('Название не может быть пустым', 'error'); return; }
  const patch = { [field]: value };
  Object.assign(t, patch);
  hooks.render();
  api.updateTask(t.id, patch).then((saved) => {
    Object.assign(t, saved);
    hooks.render();
    if (!['title', 'description'].includes(field)) reloadDrawer();
  }).catch((e) => { toast(e.message, 'error'); hooks.refresh(); });
}

function saveDrawerPeriod(root) {
  const p = readPeriod(root);
  const t = taskById(state.openTaskId); if (!t) return;
  Object.assign(t, p); hooks.render();
  api.updateTask(t.id, p).catch((e) => { toast(e.message, 'error'); hooks.refresh(); });
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.closest('.drawer') || !el.dataset.field) return;
  if (el.classList.contains('title-edit')) autoGrow(el);
  if (el.tagName === 'TEXTAREA' || el.type === 'text' || (el.tagName === 'INPUT' && !el.type) || el.getAttribute('list')) {
    el.dataset.dirty = '1';
    const f = el.dataset.field;
    textSavers[f] = textSavers[f] || debounce((v, node) => { delete node.dataset.dirty; saveField(f, v); }, 800);
    textSavers[f](f === 'title' ? el.value.replace(/\n/g, ' ') : el.value, el);
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.closest('.drawer') || !el.dataset.field) return;
  if (el.tagName === 'TEXTAREA' || el.getAttribute('list')) {
    const f = el.dataset.field;
    if (textSavers[f]) textSavers[f].flush(f === 'title' ? el.value.replace(/\n/g, ' ') : el.value, el);
    return;
  }
  const f = el.dataset.field;
  saveField(f, el.value === '' ? null : el.value);
});

document.addEventListener('keydown', (e) => {
  if (e.target.classList?.contains('title-edit') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});

inputs.drawerColumn = (el) => {
  const t = taskById(state.openTaskId);
  if (t && el.value !== t.column_id) moveTask(t, el.value);
};

inputs.subToggle = async (el) => {
  const s = drawerData.subtasks.find((x) => x.id === el.dataset.id); if (!s) return;
  s.done = el.checked;
  const t = taskById(state.openTaskId);
  if (t) { t.sub_done = drawerData.subtasks.filter((x) => x.done).length; }
  renderDrawer(); hooks.render();
  try { await api.updateSubtask(s.id, { done: s.done }); } catch (e) { toast(e.message, 'error'); reloadDrawer(); }
};

inputs.fileUpload = async (el) => {
  const files = Array.from(el.files || []); if (!files.length) return;
  const t = taskById(state.openTaskId);
  toast(`Загружаю ${files.length > 1 ? 'файлы' : 'файл'}…`);
  try {
    for (const f of files) await api.uploadAttachment(t.id, state.me.id, f);
    t.attachments_count = (t.attachments_count || 0) + files.length;
    toast('Файл прикреплён', 'ok');
  } catch (e) { toast(e.message, 'error'); }
  reloadDrawer(); hooks.render();
};

// ---------------------------------------------------------------- действия карточки

actions.openTask = (el) => openTask(el.dataset.id);
actions.closeTask = () => closeTask();
actions.newTask = (el) => openCreateTask({
  column_id: el.dataset.column, kind: el.dataset.kind,
  department_id: el.dataset.department || (state.filters.department.length > 10 ? state.filters.department : undefined),
  category_id: el.dataset.category || (state.filters.category.length > 10 ? state.filters.category : undefined),
  period_type: el.dataset.period, period_start: el.dataset.periodStart,
});
actions.completeOpen = () => { const t = taskById(state.openTaskId); if (t) completeTask(t); };
actions.reopenOpen = () => { const t = taskById(state.openTaskId); if (t) reopenTask(t); };
actions.archiveOpen = async () => {
  const t = taskById(state.openTaskId); if (!t) return;
  t.archived_at = new Date().toISOString();
  hooks.render();
  try { await api.archiveTasks([t.id]); toast('Задача в архиве', 'ok'); closeTask(); }
  catch (e) { toast(e.message, 'error'); hooks.refresh(); }
};
actions.editTime = () => {
  const t = taskById(state.openTaskId);
  if (t) askTime(t, { title: 'Сколько времени ушло на задачу?', skipLabel: 'Отмена' });
};
actions.takeTask = () => saveField('assignee_id', state.me.id);
actions.giveFive = async () => {
  const t = taskById(state.openTaskId); if (!t) return;
  try {
    const row = await api.giveHighFive(t, state.me.id);
    state.highFives.push(row);
    renderDrawer(); hooks.render(); toast(`🙌 ${shortName(memberById(t.assignee_id))} получит ваш хай-файв`, 'ok');
  } catch (e) { toast(e.message, 'error'); }
};
actions.takeFive = async (el) => {
  try {
    await api.takeBackHighFive(el.dataset.id);
    state.highFives = state.highFives.filter((h) => h.id !== el.dataset.id);
    renderDrawer(); hooks.render();
  } catch (e) { toast(e.message, 'error'); }
};
actions.pushOpen = async () => {
  const t = taskById(state.openTaskId); if (!t) return;
  const msg = await askPushMessage(`Напомнить ${fullName(memberById(t.assignee_id))}`);
  if (msg == null) return;
  try { await api.sendPush(t, state.me.id, msg); toast('Напоминание отправлено', 'ok'); reloadDrawer(); }
  catch (e) { toast(e.message, 'error'); }
};
actions.deleteOpen = async () => {
  const t = taskById(state.openTaskId); if (!t) return;
  const ok = await confirmDialog({ title: 'Удалить задачу?', text: `«${t.title}» будет удалена вместе с подзадачами, комментариями и файлами.` });
  if (!ok) return;
  try {
    await api.deleteTask(t.id);
    state.tasks = state.tasks.filter((x) => x.id !== t.id);
    closeTask(); hooks.render(); toast('Задача удалена', 'ok');
  } catch (e) { toast(e.message, 'error'); }
};
actions.subDelete = async (el) => {
  try { await api.deleteSubtask(el.dataset.id); } catch (e) { toast(e.message, 'error'); }
  await reloadDrawer(); hooks.refresh();
};
actions.openFile = async (el) => {
  const a = drawerData.attachments.find((x) => x.id === el.dataset.id); if (!a) return;
  const w = window.open('', '_blank');
  try { const url = await api.attachmentUrl(a.storage_path); if (w) w.location = url; else location.href = url; }
  catch (e) { if (w) w.close(); toast(e.message, 'error'); }
};
actions.fileDelete = async (el) => {
  const a = drawerData.attachments.find((x) => x.id === el.dataset.id); if (!a) return;
  if (!(await confirmDialog({ title: 'Удалить файл?', text: a.file_name }))) return;
  try {
    await api.deleteAttachment(a);
    const t = taskById(state.openTaskId); if (t) t.attachments_count = Math.max(0, (t.attachments_count || 1) - 1);
    toast('Файл удалён', 'ok');
  } catch (e) { toast(e.message, 'error'); }
  reloadDrawer(); hooks.render();
};
actions.commentDelete = async (el) => {
  try { await api.deleteComment(el.dataset.id); } catch (e) { toast(e.message, 'error'); }
  reloadDrawer(); hooks.refresh();
};

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form || !form.closest('.drawer')) return;
  e.preventDefault();
  const t = taskById(state.openTaskId); if (!t) return;
  const input = form.querySelector('input, textarea');
  const v = input.value.trim(); if (!v) return;
  input.value = '';
  try {
    if (form.dataset.form === 'subAdd') {
      const pos = (drawerData.subtasks.at(-1)?.position || 0) + 1000;
      await api.addSubtask(t.id, v, pos);
      t.sub_total = (t.sub_total || 0) + 1;
    } else if (form.dataset.form === 'commentAdd') {
      await api.addComment(t.id, state.me.id, v);
      t.comments_count = (t.comments_count || 0) + 1;
    }
  } catch (ex) { toast(ex.message, 'error'); input.value = v; }
  await reloadDrawer(); hooks.render();
  const again = $(`.drawer [data-form="${form.dataset.form}"] input, .drawer [data-form="${form.dataset.form}"] textarea`);
  if (again) again.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.closest('[data-form="commentAdd"]')) {
    e.preventDefault();
    e.target.closest('form').requestSubmit();
  }
});
