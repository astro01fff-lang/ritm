// Kanban-доска: колонки по статусам, отделам или категориям; карточки, фильтры, перетаскивание.
import * as api from '../api.js';
import {
  state, actions, inputs, hooks, memberById, columnById, taskById, deptById, catById, activeMembers, isLead, canEdit,
  isOverdue, groupCopies, highFivesFor, myDepartments, deptKey,
} from '../store.js';
import {
  esc, $, $$, icon, avatar, shortName, fmtDeadline, fmtMinutes, toast, confirmDialog, openModal,
  today, toISO, startOfWeek, addDays, startOfMonth, endOfMonth, overlaps, PRIORITY_LABELS, AVATAR_COLORS,
} from '../ui.js';
import { moveTask, completeTask, reopenTask } from '../task.js';

// ---------------------------------------------------------------- фильтры

export function filterTasks(tasks, f = state.filters, { archived = false } = {}) {
  const norm = (x) => String(x).toLowerCase().replace(/ё/g, 'е');
  const q = norm(f.q.trim());
  let range = null;
  const t0 = today();
  if (f.period === 'today') range = [toISO(t0), toISO(t0)];
  if (f.period === 'week') { const s = startOfWeek(t0); range = [toISO(s), toISO(addDays(s, 6))]; }
  if (f.period === 'month') range = [toISO(startOfMonth(t0)), toISO(endOfMonth(t0))];
  return tasks.filter((t) => {
    if (!archived && t.archived_at) return false;
    if (q) {
      const hay = norm(`${t.title} ${t.description} ${catById(t.category_id)?.name || ''} ${deptById(t.department_id)?.name || ''}`);
      if (!hay.includes(q)) return false;
    }
    if (f.assignee === 'me' && t.assignee_id !== state.me.id) return false;
    if (f.assignee === 'none' && t.assignee_id) return false;
    if (!['all', 'me', 'none'].includes(f.assignee) && t.assignee_id !== f.assignee) return false;
    if (f.priority !== 'all' && t.priority !== f.priority) return false;
    if (f.category === 'none' ? t.category_id : f.category !== 'all' && t.category_id !== f.category) return false;
    if (f.department === 'none' ? t.department_id : f.department !== 'all' && deptKey(deptById(t.department_id)?.name) !== f.department) return false;
    if (f.kind !== 'all' && t.kind !== f.kind) return false;
    if (f.overdue && !isOverdue(t)) return false;
    if (range) {
      const inPeriod = t.period_start && overlaps(t.period_start, t.period_end || t.period_start, range[0], range[1]);
      const inDeadline = t.deadline && t.deadline >= range[0] && t.deadline <= range[1];
      if (!inPeriod && !inDeadline) return false;
    }
    return true;
  });
}

const DEFAULT_FILTERS = { q: '', assignee: 'all', priority: 'all', category: 'all', department: 'all', period: 'all', kind: 'all', overdue: false };
const filtersActive = () => Object.entries(DEFAULT_FILTERS).some(([k, v]) => state.filters[k] !== v);

export function filterBar({ showAssignee = true } = {}) {
  const f = state.filters;
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  return `
    <div class="filters">
      <label class="search">${icon('search', 16)}<input type="search" placeholder="Поиск по задачам" value="${esc(f.q)}" data-on="filterQ" data-focus-key="filterQ" aria-label="Поиск"></label>
      ${state.departments.length ? `<select data-on="filter" data-key="department" aria-label="Отдел">
        ${opt('all', 'Все отделы', f.department)}${deptNames().map((d) => opt(d.key, d.name, f.department)).join('')}${opt('none', 'Без отдела', f.department)}
      </select>` : ''}
      <select data-on="filter" data-key="category" aria-label="Категория">
        ${opt('all', 'Все категории', f.category)}${state.categories.map((c) => opt(c.id, c.name, f.category)).join('')}${opt('none', 'Без категории', f.category)}
      </select>
      ${showAssignee ? `<select data-on="filter" data-key="assignee" aria-label="Исполнитель">
        ${opt('all', 'Все исполнители', f.assignee)}${opt('me', 'Мои', f.assignee)}${opt('none', 'Без исполнителя', f.assignee)}
        ${activeMembers().filter((m) => m.id !== state.me.id).map((m) => opt(m.id, shortName(m), f.assignee)).join('')}
      </select>` : ''}
      <select data-on="filter" data-key="period" aria-label="Период">
        ${opt('all', 'Любой период', f.period)}${opt('today', 'Сегодня', f.period)}${opt('week', 'Эта неделя', f.period)}${opt('month', 'Этот месяц', f.period)}
      </select>
      <select data-on="filter" data-key="priority" aria-label="Приоритет">
        ${opt('all', 'Любой приоритет', f.priority)}${['high', 'medium', 'low'].map((p) => opt(p, PRIORITY_LABELS[p], f.priority)).join('')}
      </select>
      <select data-on="filter" data-key="kind" aria-label="Тип">
        ${opt('all', 'Личные и командные', f.kind)}${opt('personal', 'Только личные', f.kind)}${opt('team', 'Только командные', f.kind)}
      </select>
      <label class="toggle-chip ${f.overdue ? 'on' : ''}"><input type="checkbox" data-on="filterOverdue" ${f.overdue ? 'checked' : ''}>Просроченные</label>
      ${filtersActive() ? `<button class="btn btn-ghost btn-sm" data-act="resetFilters">Сбросить</button>` : ''}
    </div>`;
}

inputs.filterQ = (el) => { state.filters.q = el.value; hooks.render(); };
inputs.filter = (el) => { state.filters[el.dataset.key] = el.value; hooks.render(); };
inputs.filterOverdue = (el) => { state.filters.overdue = el.checked; hooks.render(); };
actions.resetFilters = () => { state.filters = { ...DEFAULT_FILTERS }; hooks.render(); };

// Уникальные названия отделов: у каждого свои отделы, а у разных людей названия могут совпадать
export function deptNames() {
  const mine = myDepartments();
  const seen = new Map();
  for (const d of [...mine, ...state.departments.filter((x) => !mine.includes(x))]) {
    const k = deptKey(d.name);
    if (!seen.has(k)) seen.set(k, { key: k, name: d.name, color: d.color, mine: d.owner_id === state.me.id });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- метки

export function catTag(t) {
  const c = catById(t.category_id);
  return c ? `<span class="tag tag-cat" style="--c:${esc(c.color)}"><i></i>${esc(c.name)}</span>` : '';
}
export function deptTag(t) {
  const d = deptById(t.department_id);
  return d ? `<span class="tag tag-dept" style="--c:${esc(d.color)}">${esc(d.name)}</span>` : '';
}

// ---------------------------------------------------------------- карточка

export function card(t, { compact = false, hide = '' } = {}) {
  const who = memberById(t.assignee_id);
  const overdue = isOverdue(t);
  const copies = t.group_id ? groupCopies(t.group_id) : [];
  const groupDone = copies.filter((c) => c.completed_at).length;
  const tags = [
    t.priority !== 'medium' ? `<span class="prio prio-${t.priority}" title="Приоритет: ${PRIORITY_LABELS[t.priority]}">${PRIORITY_LABELS[t.priority]}</span>` : '',
    hide !== 'department' ? deptTag(t) : '',
    hide !== 'category' ? catTag(t) : '',
    t.kind === 'team' ? `<span class="tag tag-team">${icon('users', 13)} Команда</span>` : '',
  ].join('');
  return `
    <article class="card prio-edge-${t.priority} ${t.completed_at ? 'is-done' : ''}" data-act="openTask" data-id="${t.id}" data-drag="${canEdit(t) ? 1 : 0}" tabindex="0">
      ${canEdit(t) ? `<button class="card-check ${t.completed_at ? 'on' : ''}" data-act="${t.completed_at ? 'quickReopen' : 'quickDone'}" data-id="${t.id}"
        aria-label="${t.completed_at ? 'Вернуть в работу' : 'Отметить выполненной'}" title="${t.completed_at ? 'Вернуть в работу' : 'Отметить выполненной'}">${icon('check', 14)}</button>` : ''}
      ${tags ? `<div class="card-top">${tags}</div>` : ''}
      <h3 class="card-title">${t.completed_at ? `<span class="done-tick">${icon('check', 14)}</span>` : ''}${esc(t.title)}</h3>
      ${!compact && t.description ? `<p class="card-desc">${esc(t.description)}</p>` : ''}
      <div class="card-meta">
        ${avatar(who, 24)}
        ${hide !== 'status' ? `<span class="meta meta-status">${esc(columnById(t.column_id)?.name || '')}</span>` : ''}
        ${t.deadline ? `<span class="meta ${overdue ? 'meta-bad' : ''}" title="Дедлайн">${icon('calendar', 14)}${esc(fmtDeadline(t.deadline))}</span>` : ''}
        ${t.sub_total ? `<span class="meta ${t.sub_done === t.sub_total ? 'meta-ok' : ''}" title="Подзадачи">${icon('list', 14)}${t.sub_done}/${t.sub_total}</span>` : ''}
        ${t.comments_count ? `<span class="meta" title="Комментарии">${icon('comment', 14)}${t.comments_count}</span>` : ''}
        ${t.attachments_count ? `<span class="meta" title="Вложения">${icon('clip', 14)}${t.attachments_count}</span>` : ''}
        ${t.spent_minutes ? `<span class="meta" title="Потрачено">${icon('clock', 14)}${esc(fmtMinutes(t.spent_minutes))}</span>` : ''}
        ${highFivesFor(t.id).length ? `<span class="meta meta-hf" title="Хай-файвы">🙌${highFivesFor(t.id).length}</span>` : ''}
        ${copies.length > 1 ? `<span class="meta meta-group" title="Выполнили ${groupDone} из ${copies.length}">${icon('users', 14)}${groupDone}/${copies.length}</span>` : ''}
      </div>
    </article>`;
}

// ---------------------------------------------------------------- колонки доски

const GROUPS = { status: 'Статусы', department: 'Отделы', category: 'Категории' };
const ZOOMS = { normal: 'Обычно', compact: 'Компактно', fit: 'Всё на экране' };
const REF = {
  department: { table: 'departments', list: () => myDepartments(), field: 'department_id', one: 'отдел', none: 'Без отдела', add: 'Новый отдел' },
  category: { table: 'categories', list: () => state.categories, field: 'category_id', one: 'категорию', none: 'Без категории', add: 'Новая категория' },
};

export function lanes(groupBy = state.board.groupBy) {
  if (groupBy === 'status') {
    return state.columns.map((c) => ({ id: c.id, name: c.name, done: c.is_done, field: 'column_id', value: c.id, editable: true }));
  }
  const r = REF[groupBy];
  if (groupBy === 'department') {
    return [
      ...deptNames().map((d) => ({ id: 'd-' + d.key, key: d.key, name: d.name, color: d.color, field: 'department_id', byName: true, editable: d.mine })),
      { id: 'none', name: r.none, field: r.field, value: null, none: true },
    ];
  }
  return [
    ...r.list().map((x) => ({ id: x.id, name: x.name, color: x.color, field: r.field, value: x.id, editable: isLead() })),
    { id: 'none', name: r.none, field: r.field, value: null, none: true },
  ];
}

const inLane = (lane, t) => (lane.byName
  ? deptKey(deptById(t.department_id)?.name) === lane.key && !!t.department_id
  : (t[lane.field] || null) === lane.value);
const laneTasks = (lane, tasks) => tasks.filter((t) => inLane(lane, t)).sort((a, b) => a.position - b.position);

export function render() {
  const g = state.board.groupBy;
  const zoom = ZOOMS[state.board.zoom] ? state.board.zoom : 'normal';
  let tasks = filterTasks(state.tasks);
  const hiddenDone = g !== 'status' && state.board.hideDone ? tasks.filter((t) => t.completed_at).length : 0;
  if (g !== 'status' && state.board.hideDone) tasks = tasks.filter((t) => !t.completed_at);
  const lead = isLead();
  const total = state.tasks.length;
  const active = filtersActive();
  const ls = lanes(g).filter((l) => {
    if (g === 'status') return true;
    const n = laneTasks(l, tasks).length;
    if (l.none && !n) return false;
    // выбран конкретный отдел или категория — показываем только эту колонку
    if (g === 'department' && state.filters.department !== 'all') return state.filters.department === 'none' ? l.none : l.key === state.filters.department;
    if (g === 'category' && state.filters.category !== 'all') return state.filters.category === 'none' ? l.none : l.id === state.filters.category;
    // при поиске и других фильтрах пустые колонки прячем
    return !active || n > 0;
  });
  return `
    <div class="view-head">
      <div>
        <h1>Доска</h1>
        <p class="muted">${total ? `${tasks.length} ${tasks.length === total ? '' : `из ${total} `}задач на доске` : 'Здесь будут задачи всей команды'}</p>
      </div>
      <div class="head-actions">
        <a class="btn btn-ghost" href="#/archive">${icon('archive', 17)} Архив${archivedCount() ? ` <span class="muted">${archivedCount()}</span>` : ''}</a>
        <button class="btn btn-primary" data-act="newTask">${icon('plus', 18)} Задача</button>
      </div>
    </div>
    <div class="group-bar">
      <span class="muted small">Колонки:</span>
      <div class="tabs tabs-sm" role="tablist">
        ${Object.entries(GROUPS).map(([k, l]) => `<button role="tab" class="tab ${k === g ? 'on' : ''}" data-act="groupBy" data-g="${k}" aria-selected="${k === g}">${l}</button>`).join('')}
      </div>
      ${g !== 'status' ? `<label class="toggle-chip toggle-soft ${state.board.hideDone ? 'on' : ''}"><input type="checkbox" data-on="hideDone" ${state.board.hideDone ? 'checked' : ''}>Скрыть выполненные${hiddenDone ? ` (${hiddenDone})` : ''}</label>` : ''}
      <span class="group-bar-gap"></span>
      <span class="muted small">Масштаб:</span>
      <div class="tabs tabs-sm" role="tablist" aria-label="Масштаб доски">
        ${Object.entries(ZOOMS).map(([k, l]) => `<button role="tab" class="tab ${k === zoom ? 'on' : ''}" data-act="boardZoom" data-z="${k}" aria-selected="${k === zoom}">${l}</button>`).join('')}
      </div>
    </div>
    ${filterBar()}
    ${!total ? emptyBoard() : ''}
    ${total && active ? `<p class="found ${tasks.length ? '' : 'found-none'}">${tasks.length
      ? `Найдено: ${tasks.length}`
      : `Ничего не найдено${state.filters.q ? ` по запросу «${esc(state.filters.q)}»` : ''}. Проверьте фильтры или`} <button class="link-btn" data-act="resetFilters">сбросить ${tasks.length ? 'фильтры' : 'их'}</button></p>` : ''}
    ${g === 'department' && !myDepartments().length ? `<div class="empty-inline">У вас пока нет своих отделов. Добавьте отделы, с которыми работаете, — каждый станет колонкой. Их видите только вы${isLead() ? '' : ' и руководитель'}.
      <button class="btn btn-ghost btn-sm" data-act="addLane">${icon('plus', 16)} Добавить отдел</button></div>` : ''}
    <div class="board zoom-${zoom}" id="board">
      ${ls.map((l) => {
        const list = laneTasks(l, tasks);
        const myDep = l.byName ? myDepartments().find((d) => deptKey(d.name) === l.key) : null;
        const preset = g === 'status' ? `data-column="${l.id}"` : g === 'department' ? `data-department="${myDep ? myDep.id : ''}"` : `data-category="${l.none ? '' : l.id}"`;
        return `
        <section class="col ${l.done ? 'col-done' : ''} ${l.none ? 'col-none' : ''}" data-col="${l.id}" data-reorder="${canReorder(l) ? 1 : 0}">
          <header class="col-head" ${canReorder(l) ? 'title="Перетащите заголовок, чтобы переставить колонку"' : ''}>
            ${canReorder(l) ? `<span class="col-grip" aria-hidden="true">${icon('grip', 14)}</span>` : ''}
            ${l.color ? `<span class="lane-dot" style="--c:${esc(l.color)}"></span>` : ''}
            <h2>${esc(l.name)}</h2><span class="count">${list.length}</span>
            ${l.done && list.some((t) => t.completed_at && canEdit(t)) ? `<button class="icon-btn icon-btn-sm" data-act="archiveColumn" data-id="${l.id}" title="Отправить выполненные в архив" aria-label="Отправить выполненные в архив">${icon('archive', 16)}</button>` : ''}
            ${(g === 'status' ? lead : l.editable) ? `<button class="icon-btn icon-btn-sm" data-act="${g === 'status' ? 'columnMenu' : 'laneMenu'}" data-id="${l.id}" aria-label="Настроить колонку">${icon('more', 16)}</button>` : ''}
          </header>
          <div class="col-list" data-col-list="${l.id}">
            ${list.map((t) => card(t, { hide: g })).join('')}
            ${!list.length ? `<div class="col-empty">${l.done ? 'Сюда попадают выполненные задачи' : 'Перетащите задачу сюда'}</div>` : ''}
          </div>
          <button class="col-add" data-act="newTask" ${preset}>${icon('plus', 16)} Добавить задачу</button>
        </section>`;
      }).join('')}
      ${(g === 'department' || lead) ? `<button class="col col-new" data-act="${g === 'status' ? 'addColumn' : 'addLane'}">${icon('plus', 18)} ${g === 'status' ? 'Новая колонка' : REF[g].add}</button>` : ''}
    </div>`;
}

function saveBoardPrefs() {
  try { localStorage.setItem('tracker-board', JSON.stringify(state.board)); } catch { /* ignore */ }
}
const archivedCount = () => state.tasks.filter((t) => t.archived_at).length;

actions.archiveColumn = async (el) => {
  const list = filterTasks(state.tasks).filter((t) => t.column_id === el.dataset.id && t.completed_at && canEdit(t));
  if (!list.length) return;
  const ok = await confirmDialog({
    title: `Отправить в архив ${list.length} ${list.length === 1 ? 'задачу' : list.length < 5 ? 'задачи' : 'задач'}?`,
    text: 'Они исчезнут с доски, но останутся в разделе «Архив» и в итогах. Вернуть можно в любой момент.',
    ok: 'В архив', danger: false,
  });
  if (!ok) return;
  const now = new Date().toISOString();
  list.forEach((t) => { t.archived_at = now; });
  hooks.render();
  try { await api.archiveTasks(list.map((t) => t.id)); toast('Отправлено в архив', 'ok'); }
  catch (e) { toast(e.message, 'error'); hooks.refresh(); }
};

actions.quickDone = (el) => { const t = taskById(el.dataset.id); if (t) completeTask(t); };
actions.quickReopen = (el) => { const t = taskById(el.dataset.id); if (t) reopenTask(t); };

// Переставлять колонки: статусы и категории — руководство (общие для всех), свои отделы — каждый
function canReorder(l) {
  const g = state.board.groupBy;
  if (l.none) return false;
  if (g === 'status' || g === 'category') return isLead();
  if (g === 'department') return myDepartments().some((d) => deptKey(d.name) === l.key);
  return false;
}

actions.boardZoom = (el) => { state.board.zoom = el.dataset.z; saveBoardPrefs(); hooks.render(); };

actions.groupBy = (el) => {
  state.board.groupBy = el.dataset.g; saveBoardPrefs(); hooks.render();
  const b = $('#board'); if (b) b.scrollLeft = 0;
};
inputs.hideDone = (el) => { state.board.hideDone = el.checked; saveBoardPrefs(); hooks.render(); };

function emptyBoard() {
  return `
    <div class="empty">
      <div class="empty-art">${icon('board', 40)}</div>
      <h2>Доска пока пустая</h2>
      <p class="muted">Создайте первую задачу себе на неделю${isLead() ? ' или поставьте задачу команде' : ''}.</p>
      <div class="empty-actions">
        <button class="btn btn-primary" data-act="newTask">${icon('plus', 18)} Создать задачу</button>
        ${state.me.role === 'admin' ? `<button class="btn btn-ghost" data-act="go" data-route="team">Заполнить демоданными</button>` : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- колонки-статусы

actions.addColumn = () => {
  const m = openModal(`
    <form>
      <h3 class="modal-title">Новая колонка</h3>
      <input name="name" maxlength="60" placeholder="Например, Ждёт ответа" required>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary">Создать колонку</button></div>
    </form>`);
  $('form', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim(); if (!name) return;
    const done = state.columns.find((c) => c.is_done);
    const before = done ? state.columns.filter((c) => c.position < done.position).at(-1) : state.columns.at(-1);
    const pos = done ? ((before?.position ?? done.position - 2000) + done.position) / 2 : (state.columns.at(-1)?.position || 0) + 1000;
    try { await api.createColumn(state.team.id, name, pos); m.close(); toast('Колонка создана', 'ok'); hooks.refresh(); }
    catch (ex) { toast(ex.message, 'error'); }
  });
};

actions.columnMenu = (el) => {
  const c = columnById(el.dataset.id); if (!c) return;
  const idx = state.columns.indexOf(c);
  const m = openModal(`
    <form class="col-menu">
      <div class="modal-head"><h3 class="modal-title">Колонка</h3><button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <label class="fl" for="col-name">Название</label>
      <input id="col-name" name="name" maxlength="60" value="${esc(c.name)}">
      <label class="check-row"><input type="checkbox" name="is_done" ${c.is_done ? 'checked' : ''}>
        <span>Колонка выполненных задач<br><small class="muted">Задачи здесь считаются выполненными, при переносе спросим время</small></span></label>
      <div class="col-move">
        <button type="button" class="btn btn-ghost btn-sm" data-move="-1" ${idx === 0 ? 'disabled' : ''}>${icon('left', 16)} Левее</button>
        <button type="button" class="btn btn-ghost btn-sm" data-move="1" ${idx === state.columns.length - 1 ? 'disabled' : ''}>Правее ${icon('right', 16)}</button>
      </div>
      <div class="modal-actions spread">
        <button type="button" class="btn btn-danger-ghost" data-del>${icon('trash', 16)} Удалить колонку</button>
        <button class="btn btn-primary">Сохранить</button>
      </div>
    </form>`);
  const form = $('form', m.el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) { toast('Укажите название', 'error'); return; }
    try {
      if (form.is_done.checked && !c.is_done) {
        for (const o of state.columns.filter((x) => x.is_done && x.id !== c.id)) await api.updateColumn(o.id, { is_done: false });
      }
      await api.updateColumn(c.id, { name, is_done: form.is_done.checked });
      m.close(); toast('Колонка сохранена', 'ok'); hooks.refresh();
    } catch (ex) { toast(ex.message, 'error'); }
  });
  $$('[data-move]', form).forEach((b) => b.addEventListener('click', async () => {
    const other = state.columns[idx + Number(b.dataset.move)]; if (!other) return;
    try {
      await api.updateColumn(c.id, { position: other.position });
      await api.updateColumn(other.id, { position: c.position });
      m.close(); hooks.refresh();
    } catch (ex) { toast(ex.message, 'error'); }
  }));
  $('[data-del]', form).addEventListener('click', async () => {
    if (state.columns.length <= 1) { toast('Должна остаться хотя бы одна колонка', 'error'); return; }
    const n = state.tasks.filter((t) => t.column_id === c.id).length;
    const target = state.columns.find((x) => x.id !== c.id && !x.is_done) || state.columns.find((x) => x.id !== c.id);
    const ok = await confirmDialog({
      title: `Удалить колонку «${c.name}»?`,
      text: n ? `${n} задач(и) из неё переедут в «${target.name}».` : 'Колонка пустая.',
    });
    if (!ok) return;
    try {
      if (n) await api.moveColumnTasks(c.id, target.id);
      await api.deleteColumn(c.id);
      m.close(); toast('Колонка удалена', 'ok'); hooks.refresh();
    } catch (ex) { toast(ex.message, 'error'); }
  });
};

// ---------------------------------------------------------------- отделы и категории

function swatches(current) {
  return `<div class="swatches">${AVATAR_COLORS.concat(['#9BB8F2', '#D9A6F2', '#8C8886']).map((c) => `
    <label class="swatch-pick"><input type="radio" name="color" value="${c}" ${c === current ? 'checked' : ''}><span class="swatch" style="--c:${c}"></span></label>`).join('')}</div>`;
}

export function openRefEditor(kind, item) {
  const r = REF[kind];
  const list = r.list();
  const idx = item ? list.indexOf(item) : -1;
  const title = item ? (kind === 'department' ? 'Отдел' : 'Категория') : (kind === 'department' ? 'Новый отдел' : 'Новая категория');
  const m = openModal(`
    <form class="col-menu">
      <div class="modal-head"><h3 class="modal-title">${title}</h3><button type="button" class="icon-btn" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <label class="fl" for="ref-name">Название</label>
      <input id="ref-name" name="name" maxlength="80" value="${esc(item?.name || '')}" placeholder="${kind === 'department' ? 'Например, Inhouse SMM' : 'Например, Наставничество'}">
      <label class="fl">Цвет</label>
      ${swatches(item?.color || (kind === 'department' ? '#8BC6F2' : '#F28BB5'))}
      ${item ? `<div class="col-move">
        <button type="button" class="btn btn-ghost btn-sm" data-move="-1" ${idx === 0 ? 'disabled' : ''}>${icon('left', 16)} Раньше</button>
        <button type="button" class="btn btn-ghost btn-sm" data-move="1" ${idx === list.length - 1 ? 'disabled' : ''}>Позже ${icon('right', 16)}</button>
      </div>` : ''}
      <p class="form-error" role="alert"></p>
      <div class="modal-actions ${item ? 'spread' : ''}">
        ${item ? `<button type="button" class="btn btn-danger-ghost" data-del>${icon('trash', 16)} Удалить</button>` : `<button type="button" class="btn btn-ghost" data-close>Отмена</button>`}
        <button class="btn btn-primary">${item ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>`);
  const form = $('form', m.el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) { $('.form-error', form).textContent = 'Укажите название'; return; }
    const color = form.color.value || '#F28BB5';
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== item?.id)) {
      $('.form-error', form).textContent = 'Такое название уже есть'; return;
    }
    try {
      if (item) await api.updateRef(r.table, item.id, { name, color });
      else await api.createRef(r.table, { team_id: state.team.id, name, color, position: (list.at(-1)?.position || 0) + 1000, ...(kind === 'department' ? { owner_id: state.me.id } : {}) });
      m.close(); toast(item ? 'Сохранено' : 'Добавлено', 'ok'); hooks.refresh();
    } catch (ex) { $('.form-error', form).textContent = ex.message; }
  });
  $$('[data-move]', form).forEach((b) => b.addEventListener('click', async () => {
    const other = list[idx + Number(b.dataset.move)]; if (!other) return;
    try {
      await api.updateRef(r.table, item.id, { position: other.position });
      await api.updateRef(r.table, other.id, { position: item.position });
      m.close(); hooks.refresh();
    } catch (ex) { toast(ex.message, 'error'); }
  }));
  $('[data-del]', form)?.addEventListener('click', async () => {
    const n = state.tasks.filter((t) => t[r.field] === item.id).length;
    const ok = await confirmDialog({
      title: `Удалить «${item.name}»?`,
      text: n ? `У ${n} задач(и) это поле станет пустым. Сами задачи останутся.` : 'Задач с этим значением нет.',
    });
    if (!ok) return;
    try { await api.deleteRef(r.table, item.id); m.close(); toast('Удалено', 'ok'); hooks.refresh(); }
    catch (ex) { toast(ex.message, 'error'); }
  });
}

actions.addLane = () => openRefEditor(state.board.groupBy === 'status' ? 'department' : state.board.groupBy);
actions.laneMenu = (el) => {
  const kind = state.board.groupBy;
  const item = kind === 'department'
    ? myDepartments().find((d) => 'd-' + deptKey(d.name) === el.dataset.id)
    : REF[kind].list().find((x) => x.id === el.dataset.id);
  if (item) openRefEditor(kind, item);
};

// ---------------------------------------------------------------- перетаскивание (мышь и касание)

let drag = null;

export function mount(root) {
  const board = $('#board', root);
  if (!board) return;
  board.addEventListener('pointerdown', onDown);
  board.addEventListener('pointerdown', onColDown);
}

// ---------------------------------------------------------------- перестановка колонок

let colDrag = null;

function onColDown(e) {
  const head = e.target.closest('.col-head');
  const col = head?.closest('.col[data-reorder="1"]');
  if (!col || e.button > 0 || e.target.closest('button, a, input, select')) return;
  const startX = e.clientX, startY = e.clientY;
  const isTouch = e.pointerType !== 'mouse';
  let started = false, timer = null;

  const begin = () => {
    started = true;
    const rect = col.getBoundingClientRect();
    const ghost = col.cloneNode(true);
    ghost.classList.add('col-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = Math.min(rect.height, 420) + 'px';
    document.body.appendChild(ghost);
    const ph = document.createElement('div');
    ph.className = 'col-ph';
    ph.style.width = rect.width + 'px';
    ph.style.height = Math.min(rect.height, 420) + 'px';
    col.after(ph);
    col.classList.add('drag-src');
    colDrag = { col, ghost, ph, dx: startX - rect.left, dy: startY - rect.top };
    document.body.classList.add('dragging');
    moveCol(startX, startY);
  };
  const move = (ev) => {
    if (!started) {
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (isTouch) { if (dist > 10) cleanup(); return; }
      if (dist > 6) begin(); else return;
    }
    ev.preventDefault();
    moveCol(ev.clientX, ev.clientY);
  };
  const up = async (ev) => {
    cleanup();
    if (!started) return;
    ev.preventDefault();
    await dropCol();
  };
  const cleanup = () => {
    clearTimeout(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  if (isTouch) timer = setTimeout(begin, 280);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

document.addEventListener('touchmove', (e) => { if (colDrag) e.preventDefault(); }, { passive: false });

function moveCol(x, y) {
  const { ghost, ph, col } = colDrag;
  ghost.style.transform = `translate(${x - colDrag.dx}px, ${y - colDrag.dy}px) rotate(1.5deg)`;
  const board = $('#board');
  const others = $$('.col[data-col]', board).filter((c) => c !== col && c.dataset.reorder === '1');
  const before = others.find((c) => { const r = c.getBoundingClientRect(); return x < r.left + r.width / 2; });
  if (before) board.insertBefore(ph, before);
  else {
    const last = others.at(-1);
    if (last) last.after(ph);
  }
  const r = board.getBoundingClientRect();
  if (x > r.right - 60) board.scrollLeft += 16;
  else if (x < r.left + 60) board.scrollLeft -= 16;
}

async function dropCol() {
  const d = colDrag; colDrag = null;
  document.body.classList.remove('dragging');
  d.ghost.remove();
  d.ph.replaceWith(d.col);
  d.col.classList.remove('drag-src');
  // новый порядок перетаскиваемых колонок, как они стоят на экране
  const order = $$('#board .col[data-reorder="1"]').map((c) => c.dataset.col);
  const g = state.board.groupBy;
  try {
    if (g === 'status') await saveOrder(state.columns, (c) => c.id, order, (id, position) => api.updateColumn(id, { position }));
    else if (g === 'category') await saveOrder(state.categories, (c) => c.id, order, (id, position) => api.updateRef('categories', id, { position }));
    else if (g === 'department') await saveOrder(myDepartments(), (dep) => 'd-' + deptKey(dep.name), order, (id, position) => api.updateRef('departments', id, { position }));
  } catch (e) { toast(e.message, 'error'); }
  hooks.refresh();
}

// Раздаём позиции по новому порядку и сохраняем только изменившиеся
async function saveOrder(items, keyOf, order, update) {
  const sorted = [...items].sort((a, b) => {
    const ia = order.indexOf(keyOf(a)), ib = order.indexOf(keyOf(b));
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.position - b.position;
  });
  const jobs = [];
  sorted.forEach((it, i) => {
    const position = (i + 1) * 1000;
    if (it.position !== position) { it.position = position; jobs.push(update(it.id, position)); }
  });
  items.sort((a, b) => a.position - b.position);
  hooks.render();
  await Promise.all(jobs);
}

function onDown(e) {
  const cardEl = e.target.closest('.card');
  if (!cardEl || e.button > 0) return;
  if (e.target.closest('button, a, input, select')) return;
  if (cardEl.dataset.drag !== '1') {
    // чужую задачу двигать нельзя — объясняем, а не молчим
    const sx = e.clientX, sy = e.clientY;
    const warn = (ev) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 12) {
        window.removeEventListener('pointermove', warn);
        toast('Эту задачу может переносить её исполнитель, автор или руководитель', 'info');
      }
    };
    window.addEventListener('pointermove', warn);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', warn), { once: true });
    return;
  }
  const startX = e.clientX, startY = e.clientY;
  const isTouch = e.pointerType !== 'mouse';
  let started = false;
  let timer = null;

  const begin = () => {
    started = true;
    const rect = cardEl.getBoundingClientRect();
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);
    const ph = document.createElement('div');
    ph.className = 'drop-ph';
    ph.style.height = rect.height + 'px';
    cardEl.after(ph);
    cardEl.classList.add('drag-src');
    drag = { id: cardEl.dataset.id, el: cardEl, ghost, ph, dx: startX - rect.left, dy: startY - rect.top, col: null, before: null };
    document.body.classList.add('dragging');
    if (navigator.vibrate && isTouch) navigator.vibrate(12);
    position(startX, startY);
  };

  const move = (ev) => {
    if (!started) {
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (isTouch) { if (dist > 10) cleanup(); return; }
      if (dist > 6) begin(); else return;
    }
    ev.preventDefault();
    position(ev.clientX, ev.clientY);
  };

  const up = async (ev) => {
    cleanup();
    if (!started) return;
    ev.preventDefault();
    const swallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
    await drop();
  };

  const cleanup = () => {
    clearTimeout(timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };

  if (isTouch) timer = setTimeout(begin, 280);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });

function position(x, y) {
  const { ghost, ph } = drag;
  ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px) rotate(2deg)`;
  ghost.style.visibility = 'hidden';
  const under = document.elementFromPoint(x, y);
  ghost.style.visibility = '';
  const list = under?.closest('[data-col-list]') || under?.closest('.col')?.querySelector('[data-col-list]');
  if (list) {
    const cards = $$('.card:not(.drag-src)', list);
    const before = cards.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
    if (before) list.insertBefore(ph, before); else {
      const empty = $('.col-empty', list);
      if (empty) empty.before(ph); else list.appendChild(ph);
    }
    drag.col = list.dataset.colList;
    drag.before = before?.dataset.id || null;
  }
  const board = $('#board');
  if (board) {
    const r = board.getBoundingClientRect();
    if (x > r.right - 60) board.scrollLeft += 14;
    else if (x < r.left + 60) board.scrollLeft -= 14;
  }
  if (list) {
    const lr = list.getBoundingClientRect();
    if (y > lr.bottom - 40) list.scrollTop += 12;
    else if (y < lr.top + 40) list.scrollTop -= 12;
  }
}

async function drop() {
  const d = drag; drag = null;
  document.body.classList.remove('dragging');
  d.ghost.remove();
  d.ph.remove();
  d.el.classList.remove('drag-src');
  if (!d.col) return;
  const task = taskById(d.id); if (!task) return;
  const lane = lanes().find((l) => l.id === d.col); if (!lane) return;
  const visible = laneTasks(lane, filterTasks(state.tasks)).filter((t) => t.id !== d.id);
  const idx = d.before ? visible.findIndex((t) => t.id === d.before) : visible.length;
  const prev = visible[idx - 1], next = visible[idx];
  let pos;
  if (prev && next) pos = (prev.position + next.position) / 2;
  else if (prev) pos = prev.position + 1000;
  else if (next) pos = next.position - 1000;
  else pos = task.position;
  const sameLane = inLane(lane, task);
  if (sameLane && Math.abs(task.position - pos) < 1e-9) return;

  if (lane.field === 'column_id') { await moveTask(task, lane.value, pos); return; }
  // отдел или категория
  let value = lane.value;
  if (lane.byName) {
    // берём отдел с этим названием у исполнителя, затем у автора, затем у себя
    const owners = [task.assignee_id, task.author_id, state.me.id];
    const dep = owners.map((o) => state.departments.find((d) => d.owner_id === o && deptKey(d.name) === lane.key)).find(Boolean);
    if (!dep) { toast(`Добавьте себе отдел «${lane.name}», чтобы переносить в него задачи`, 'info'); hooks.render(); return; }
    value = dep.id;
  }
  const patch = { [lane.field]: value, position: pos };
  Object.assign(task, patch);
  hooks.render();
  try {
    await api.updateTask(task.id, patch);
    if (!sameLane) toast(lane.value ? `Теперь: ${lane.name}` : `${lane.name}`, 'ok', 1600);
  } catch (e) { toast(e.message, 'error'); hooks.refresh(); }
}
