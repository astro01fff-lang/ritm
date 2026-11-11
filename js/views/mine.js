// «Мои задачи»: план на день, неделю или месяц.
import * as api from '../api.js';
import { state, actions, inputs, hooks, columnById, taskById, isOverdue, firstColumn, highFivesFor } from '../store.js';
import {
  esc, $, icon, toast, today, toISO, addDays, startOfWeek, startOfMonth, endOfMonth, overlaps, parseISO,
  fmtPeriod, fmtDeadline, fmtMinutes, fmtHours, weekdayShort, periodRange, plural, PRIORITY_LABELS,
} from '../ui.js';
import { completeTask, reopenTask } from '../task.js';
import { catTag, deptTag } from './board.js';

const SCOPES = { day: 'Сегодня', week: 'Неделя', month: 'Месяц' };

export function scopeRange(scope, offset) {
  const t = today();
  if (scope === 'day') { const d = addDays(t, offset); return [toISO(d), toISO(d)]; }
  if (scope === 'week') { const s = addDays(startOfWeek(t), offset * 7); return [toISO(s), toISO(addDays(s, 6))]; }
  const m = new Date(t.getFullYear(), t.getMonth() + offset, 1);
  return [toISO(startOfMonth(m)), toISO(endOfMonth(m))];
}

function scopeTitle(scope, offset, [s, e]) {
  if (scope === 'day') return offset === 0 ? 'Сегодня' : offset === 1 ? 'Завтра' : offset === -1 ? 'Вчера' : fmtPeriod('day', s, e);
  if (scope === 'week') return offset === 0 ? `Эта неделя, ${fmtPeriod('week', s, e)}` : fmtPeriod('week', s, e);
  return fmtPeriod('month', s, e);
}

export function inRange(t, [s, e]) {
  const inPeriod = t.period_start && overlaps(t.period_start, t.period_end || t.period_start, s, e);
  const inDeadline = t.deadline && t.deadline >= s && t.deadline <= e;
  return inPeriod || inDeadline;
}
const doneIn = (t, [s, e]) => t.completed_at && toISO(new Date(t.completed_at)) >= s && toISO(new Date(t.completed_at)) <= e;

function row(t) {
  const col = columnById(t.column_id);
  return `
    <li class="row ${t.completed_at ? 'is-done' : ''}" data-act="openTask" data-id="${t.id}" tabindex="0">
      <label class="check check-lg" data-stop title="${t.completed_at ? 'Вернуть в работу' : 'Отметить выполненной'}">
        <input type="checkbox" data-on="toggleDone" data-id="${t.id}" ${t.completed_at ? 'checked' : ''} aria-label="Выполнено"><span></span>
      </label>
      <div class="row-main">
        <div class="row-title">${esc(t.title)}</div>
        <div class="row-meta">
          <span class="dot prio-dot-${t.priority}" title="Приоритет: ${PRIORITY_LABELS[t.priority]}"></span>
          ${catTag(t)}${deptTag(t)}
          ${!t.completed_at ? `<span>${esc(col?.name || '')}</span>` : ''}
          ${t.deadline ? `<span class="${isOverdue(t) ? 'bad' : ''}">${icon('calendar', 13)} ${esc(fmtDeadline(t.deadline))}</span>` : ''}
          ${t.period_type !== 'none' ? `<span>${esc(fmtPeriod(t.period_type, t.period_start, t.period_end))}</span>` : ''}
          ${t.sub_total ? `<span>${icon('list', 13)} ${t.sub_done}/${t.sub_total}</span>` : ''}
          ${t.kind === 'team' ? `<span>${icon('users', 13)} командная</span>` : ''}
          ${highFivesFor(t.id).length ? `<span title="Хай-файвы">🙌 ${highFivesFor(t.id).length}</span>` : ''}
        </div>
      </div>
      ${t.spent_minutes ? `<span class="row-time">${esc(fmtMinutes(t.spent_minutes))}</span>` : ''}
    </li>`;
}

function weekStrip(range, mine) {
  const s = parseISO(range[0]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
  const todayStr = toISO(today());
  const per = days.map((d) => {
    const iso = toISO(d);
    const done = mine.filter((t) => t.completed_at && toISO(new Date(t.completed_at)) === iso);
    return { iso, d, n: done.length, min: done.reduce((a, t) => a + (t.spent_minutes || 0), 0) };
  });
  const max = Math.max(1, ...per.map((p) => p.n));
  return `
    <div class="pulse" aria-label="Выполнено по дням">
      ${per.map((p) => `
        <div class="pulse-day ${p.iso === todayStr ? 'is-today' : ''} ${p.iso > todayStr ? 'is-future' : ''}">
          <div class="pulse-bar"><i style="height:${p.n ? 18 + (p.n / max) * 82 : 0}%"></i></div>
          <b>${p.n || ''}</b>
          <span>${weekdayShort(p.d)}</span>
          <small>${p.min ? fmtHours(p.min) : ''}</small>
        </div>`).join('')}
    </div>`;
}

export function render() {
  const { scope, offset } = state.mine;
  const range = scopeRange(scope, offset);
  const mine = state.tasks.filter((t) => t.assignee_id === state.me.id);
  const isCurrent = offset === 0;
  const overdue = isCurrent ? mine.filter((t) => isOverdue(t) && !inRange(t, range)) : [];
  const planned = mine.filter((t) => !t.completed_at && inRange(t, range))
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || ['high', 'medium', 'low'].indexOf(a.priority) - ['high', 'medium', 'low'].indexOf(b.priority));
  const noDate = isCurrent ? mine.filter((t) => !t.completed_at && t.period_type === 'none' && !t.deadline) : [];
  const done = mine.filter((t) => doneIn(t, range)).sort((a, b) => b.completed_at.localeCompare(a.completed_at));
  const minutes = done.reduce((a, t) => a + (t.spent_minutes || 0), 0);
  const focusMin = (state.focus || []).filter((f) => f.mode === 'work' && toISO(new Date(f.started_at)) >= range[0] && toISO(new Date(f.started_at)) <= range[1]).reduce((a, f) => a + f.minutes, 0);
  const totalPlan = planned.length + done.length;
  const pct = totalPlan ? Math.round((done.length / totalPlan) * 100) : 0;
  const [ps, pe] = periodRange(scope, range[0]);

  return `
    <div class="view-head">
      <div><h1>Мои задачи</h1><p class="muted">Ваш план и то, что уже сделано</p></div>
      <button class="btn btn-primary" data-act="newTask" data-period="${scope}" data-period-start="${range[0]}">${icon('plus', 18)} Задача</button>
    </div>

    <div class="scope-bar">
      <div class="tabs" role="tablist">
        ${Object.entries(SCOPES).map(([k, l]) => `<button role="tab" class="tab ${k === scope ? 'on' : ''}" data-act="mineScope" data-scope="${k}" aria-selected="${k === scope}">${l}</button>`).join('')}
      </div>
      <div class="pager">
        <button class="icon-btn" data-act="mineShift" data-d="-1" aria-label="Назад">${icon('left')}</button>
        <span class="pager-label">${esc(scopeTitle(scope, offset, range))}</span>
        <button class="icon-btn" data-act="mineShift" data-d="1" aria-label="Вперёд">${icon('right')}</button>
        ${offset ? `<button class="btn btn-ghost btn-sm" data-act="mineShift" data-d="0">К текущему</button>` : ''}
      </div>
    </div>

    <div class="mine-summary">
      <div class="big-stat"><b>${done.length}</b><span>${plural(done.length, 'задача выполнена', 'задачи выполнены', 'задач выполнено')}</span></div>
      <div class="big-stat"><b>${planned.length}</b><span>в плане</span></div>
      <div class="big-stat"><b>${fmtHours(minutes)}</b><span>потрачено</span></div>
      ${focusMin ? `<div class="big-stat"><b>${fmtHours(focusMin)}</b><span>в фокусе</span></div>` : ''}
      <div class="ring" style="--p:${pct}" aria-label="Прогресс ${pct}%"><span>${pct}%</span></div>
    </div>

    ${scope === 'week' ? weekStrip(range, mine) : ''}

    <form class="quick-add" data-quick="1">
      ${icon('plus', 18)}
      <input name="title" maxlength="300" placeholder="Быстро добавить задачу: ${esc(scope === 'day' ? 'на этот день' : scope === 'week' ? 'на эту неделю' : 'на этот месяц')} — и Enter" data-focus-key="quick" aria-label="Новая задача">
      <input type="hidden" name="ptype" value="${scope}"><input type="hidden" name="ps" value="${ps}"><input type="hidden" name="pe" value="${pe}">
    </form>

    ${overdue.length ? `<h2 class="list-h bad">Просрочено <span>${overdue.length}</span></h2><ul class="rows">${overdue.map(row).join('')}</ul>` : ''}

    <h2 class="list-h">В плане <span>${planned.length}</span></h2>
    ${planned.length ? `<ul class="rows">${planned.map(row).join('')}</ul>`
      : `<div class="empty-inline">${done.length ? 'Всё из плана сделано.' : 'На этот период задач нет.'} Добавьте задачу через поле выше.</div>`}

    ${noDate.length ? `<h2 class="list-h">Без срока <span>${noDate.length}</span></h2><ul class="rows">${noDate.map(row).join('')}</ul>` : ''}

    ${done.length ? `<h2 class="list-h">Выполнено <span>${done.length}</span></h2><ul class="rows">${done.map(row).join('')}</ul>` : ''}
  `;
}

actions.mineScope = (el) => { state.mine = { scope: el.dataset.scope, offset: 0 }; hooks.render(); };
actions.mineShift = (el) => { const d = Number(el.dataset.d); state.mine.offset = d === 0 ? 0 : state.mine.offset + d; hooks.render(); };

inputs.toggleDone = (el) => {
  const t = taskById(el.dataset.id); if (!t) return;
  if (el.checked) completeTask(t); else reopenTask(t);
};

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-quick]');
  if (!f) return;
  e.preventDefault();
  const title = f.title.value.trim(); if (!title) return;
  f.title.value = '';
  const col = firstColumn();
  const pos = Math.max(0, ...state.tasks.filter((t) => t.column_id === col.id).map((t) => t.position)) + 1000;
  try {
    await api.createTasks({
      team_id: state.team.id, author_id: state.me.id, kind: 'personal', title, description: '',
      period_type: f.ptype.value, period_start: f.ps.value, period_end: f.pe.value,
      priority: 'medium', column_id: col.id, position: pos, category: '', deadline: null, goal_id: null,
    }, [state.me.id]);
    toast('Задача добавлена', 'ok');
    await hooks.refresh();
    $('form[data-quick] input[name=title]')?.focus();
  } catch (ex) { toast(ex.message, 'error'); f.title.value = title; }
});
