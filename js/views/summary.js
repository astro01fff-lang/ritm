// «Итоги»: что сделано за период, сколько времени ушло, прогресс целей. Экспорт в CSV.
import { state, actions, inputs, hooks, memberById, columnById, deptById, catById, isLead, activeMembers, isOverdue, hiddenFromMe } from '../store.js';
import {
  esc, icon, avatar, fullName, today, toISO, addDays, parseISO, startOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, overlaps, fmtPeriod, fmtShort, fmtMinutes, fmtHours, plural, downloadCSV,
  weekdayShort, fmtDate, toast,
} from '../ui.js';
import { inRange } from './mine.js';

const SCOPES = { week: 'Неделя', month: 'Месяц', quarter: 'Квартал', custom: 'Свой период' };

function range() {
  const { scope, offset, from, to } = state.summary;
  const t = today();
  if (scope === 'week') { const s = addDays(startOfWeek(t), offset * 7); return [toISO(s), toISO(addDays(s, 6))]; }
  if (scope === 'month') { const m = new Date(t.getFullYear(), t.getMonth() + offset, 1); return [toISO(startOfMonth(m)), toISO(endOfMonth(m))]; }
  if (scope === 'quarter') { const q = new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3 + offset * 3, 1); return [toISO(startOfQuarter(q)), toISO(endOfQuarter(q))]; }
  const s = from || toISO(addDays(t, -13)); const e = to && to >= s ? to : toISO(t);
  return [s, e];
}

const completedDay = (t) => (t.completed_at ? toISO(new Date(t.completed_at)) : null);

function compute([s, e]) {
  const todayStr = toISO(today());
  const people = isLead() ? activeMembers() : activeMembers().filter((m) => m.id === state.me.id);
  const doneIn = (t) => { const d = completedDay(t); return d && d >= s && d <= e; };
  const openRelevant = (t) => !t.completed_at && (inRange(t, [s, e]) || (t.deadline && t.deadline <= e));
  const overdueAt = (t) => !t.completed_at && t.deadline && t.deadline < todayStr && t.deadline <= e;

  const rows = people.map((p) => {
    const mine = state.tasks.filter((t) => t.assignee_id === p.id);
    const done = mine.filter(doneIn);
    const open = mine.filter(openRelevant);
    const overdue = mine.filter(overdueAt);
    const minutes = done.reduce((a, t) => a + (t.spent_minutes || 0), 0);
    const unlogged = done.filter((t) => t.spent_minutes == null).length;
    const goals = state.goals.filter((g) => g.owner_id === p.id && overlaps(g.period_start, g.period_end, s, e));
    return { p, done, open, overdue, minutes, unlogged, goals, total: done.length + open.length };
  });

  const scopeTasks = isLead() ? state.tasks : state.tasks.filter((t) => t.assignee_id === state.me.id);
  const done = scopeTasks.filter(doneIn);
  const minutes = done.reduce((a, t) => a + (t.spent_minutes || 0), 0);
  const inWork = scopeTasks.filter((t) => !t.completed_at && inRange(t, [s, e]));
  const overdue = scopeTasks.filter(overdueAt);
  const leadTimes = done.map((t) => (new Date(t.completed_at) - new Date(t.created_at)) / 86400000).filter((x) => x >= 0);
  const avgDays = leadTimes.length ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : null;

  // по дням (или по неделям для длинных периодов)
  const days = Math.round((parseISO(e) - parseISO(s)) / 86400000) + 1;
  const byWeek = days > 35;
  const buckets = [];
  if (!byWeek) {
    for (let i = 0; i < days; i++) {
      const d = addDays(parseISO(s), i); const iso = toISO(d);
      buckets.push({ label: days <= 7 ? weekdayShort(d) : String(d.getDate()), title: fmtDate(iso), from: iso, to: iso });
    }
  } else {
    let cur = startOfWeek(parseISO(s));
    while (toISO(cur) <= e) {
      const from = toISO(cur), to = toISO(addDays(cur, 6));
      buckets.push({ label: fmtShort(cur), title: `${fmtShort(cur)} – ${fmtShort(addDays(cur, 6))}`, from, to });
      cur = addDays(cur, 7);
    }
  }
  for (const b of buckets) {
    const list = done.filter((t) => { const d = completedDay(t); return d >= b.from && d <= b.to; });
    b.n = list.length; b.min = list.reduce((a, t) => a + (t.spent_minutes || 0), 0);
  }

  const teamGoals = state.goals.filter((g) => !g.owner_id && overlaps(g.period_start, g.period_end, s, e));
  const groups = {};
  for (const t of state.tasks) {
    if (!t.group_id) continue;
    if (!(inRange(t, [s, e]) || (completedDay(t) && completedDay(t) >= s && completedDay(t) <= e))) continue;
    (groups[t.group_id] ||= []).push(t);
  }
  const groupList = Object.values(groups).map((g) => state.tasks.filter((t) => t.group_id === g[0].group_id));

  // разбивка по отделам и категориям: выполненное за период и открытое по плану
  const breakdown = (list, field, noneLabel) => {
    const keys = [...list.map((x) => ({ id: x.id, name: x.name, color: x.color })), { id: null, name: noneLabel, color: null }];
    return keys.map((k) => {
      const d = done.filter((t) => (t[field] || null) === k.id);
      const o = scopeTasks.filter((t) => !t.completed_at && (t[field] || null) === k.id && inRange(t, [s, e]));
      return { ...k, done: d.length, open: o.length, minutes: d.reduce((a, t) => a + (t.spent_minutes || 0), 0) };
    }).filter((x) => x.done || x.open);
  };
  const byDept = breakdown(state.departments, 'department_id', 'Без отдела');
  const byCat = breakdown(state.categories, 'category_id', 'Без категории');
  return { rows, done, minutes, inWork, overdue, avgDays, buckets, byWeek, teamGoals, groupList, byDept, byCat };
}

function chart(buckets, byWeek) {
  const max = Math.max(1, ...buckets.map((b) => b.n));
  const todayStr = toISO(today());
  return `
    <div class="chart" role="img" aria-label="Выполненные задачи по ${byWeek ? 'неделям' : 'дням'}">
      ${buckets.map((b) => `
        <div class="chart-col ${b.from <= todayStr && b.to >= todayStr ? 'is-today' : ''}" title="${esc(b.title)}: ${b.n} ${plural(b.n, 'задача', 'задачи', 'задач')}${b.min ? `, ${fmtMinutes(b.min)}` : ''}">
          <span class="chart-n">${b.n || ''}</span>
          <div class="chart-bar"><i style="height:${(b.n / max) * 100}%"></i></div>
          <span class="chart-l">${esc(b.label)}</span>
        </div>`).join('')}
    </div>`;
}

function breakdownPanel(title, rows) {
  if (!rows.length) return '';
  const maxMin = Math.max(1, ...rows.map((r) => r.minutes));
  return `
    <section class="panel">
      <h2 class="panel-h">${title}</h2>
      <table class="bd">
        <thead><tr><th></th><th>Выполнено</th><th>В плане</th><th class="bd-time-h">Время</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td><span class="bd-name">${r.color ? `<i style="--c:${esc(r.color)}"></i>` : '<i class="bd-none"></i>'}${esc(r.name)}</span></td>
            <td><b>${r.done}</b></td>
            <td>${r.open}</td>
            <td class="bd-time"><div class="bar"><i style="width:${(r.minutes / maxMin) * 100}%"></i></div><span>${fmtHours(r.minutes)}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </section>`;
}

function goalRow(g) {
  const p = state.goalProgress[g.id] || { total: 0, done: 0 };
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return `<li><span class="sg-title">${esc(g.title)}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct}%</b><span class="muted small">${p.done}/${p.total}</span></li>`;
}

export function render() {
  const r = range();
  const { scope, offset } = state.summary;
  const d = compute(r);
  const lead = isLead();
  const title = scope === 'custom' ? fmtPeriod('custom', r[0], r[1]) : fmtPeriod(scope, r[0], r[1]);

  return `
    <div class="view-head">
      <div><h1>Итоги</h1><p class="muted">${lead ? 'Нагрузка и результаты команды за период' : 'Ваши результаты за период'}</p></div>
      <div class="head-actions">
        <button class="btn btn-ghost" data-act="exportPeople">${icon('download', 16)} Сводка CSV</button>
        <button class="btn btn-ghost" data-act="exportTasks">${icon('download', 16)} Задачи CSV</button>
      </div>
    </div>

    <div class="scope-bar">
      <div class="tabs" role="tablist">
        ${Object.entries(SCOPES).map(([k, l]) => `<button role="tab" class="tab ${k === scope ? 'on' : ''}" data-act="sumScope" data-scope="${k}" aria-selected="${k === scope}">${l}</button>`).join('')}
      </div>
      ${scope === 'custom' ? `
        <div class="pager">
          <input type="date" value="${r[0]}" data-on="sumFrom" aria-label="С"> <span class="muted">—</span>
          <input type="date" value="${r[1]}" data-on="sumTo" aria-label="По">
        </div>` : `
        <div class="pager">
          <button class="icon-btn" data-act="sumShift" data-d="-1" aria-label="Назад">${icon('left')}</button>
          <span class="pager-label">${esc(title)}</span>
          <button class="icon-btn" data-act="sumShift" data-d="1" aria-label="Вперёд">${icon('right')}</button>
          ${offset ? `<button class="btn btn-ghost btn-sm" data-act="sumShift" data-d="0">К текущему</button>` : ''}
        </div>`}
    </div>

    <div class="kpis">
      <div class="kpi kpi-main"><b>${d.done.length}</b><span>${plural(d.done.length, 'задача выполнена', 'задачи выполнены', 'задач выполнено')}</span></div>
      <div class="kpi"><b>${fmtHours(d.minutes)}</b><span>потрачено времени</span></div>
      <div class="kpi"><b>${d.inWork.length}</b><span>в работе по плану</span></div>
      <div class="kpi ${d.overdue.length ? 'kpi-bad' : ''}"><b>${d.overdue.length}</b><span>просрочено</span></div>
      <div class="kpi"><b>${d.avgDays == null ? '—' : d.avgDays < 1 ? '< 1' : d.avgDays.toFixed(1).replace('.', ',')}</b><span>${d.avgDays != null && d.avgDays >= 1 ? 'дн. ' : ''}в среднем на задачу</span></div>
    </div>

    <section class="panel">
      <h2 class="panel-h">Выполнено по ${d.byWeek ? 'неделям' : 'дням'}</h2>
      ${d.done.length ? chart(d.buckets, d.byWeek) : `<div class="empty-inline">За этот период выполненных задач нет.</div>`}
    </section>

    <div class="bd-grid">
      ${breakdownPanel('По отделам', d.byDept)}
      ${breakdownPanel('По категориям', d.byCat)}
    </div>

    <h2 class="list-h">${lead ? 'По сотрудникам' : 'Мои итоги'}</h2>
    <div class="people">
      ${d.rows.map((x) => hiddenFromMe(x.p.id) ? `
        <div class="person person-hidden">
          <div class="person-id">${avatar(x.p, 36)}<div><b>${esc(fullName(x.p))}</b><span class="muted small">${esc(x.p.position || '')}</span></div></div>
          <span class="muted small">${icon('lock', 14)} Личные задачи скрыты</span>
        </div>` : `
        <details class="person" ${!lead ? 'open' : ''}>
          <summary>
            <div class="person-id">${avatar(x.p, 36)}<div><b>${esc(fullName(x.p))}</b><span class="muted small">${esc(x.p.position || '')}</span></div></div>
            <div class="person-stats">
              <div><b>${x.done.length}<small>/${x.total}</small></b><span>выполнено</span></div>
              <div><b>${fmtHours(x.minutes)}</b><span>время</span></div>
              <div class="${x.overdue.length ? 'bad' : ''}"><b>${x.overdue.length}</b><span>просрочено</span></div>
            </div>
          </summary>
          <div class="person-body">
            ${x.unlogged ? `<p class="muted small">Без указанного времени: ${x.unlogged} ${plural(x.unlogged, 'задача', 'задачи', 'задач')}</p>` : ''}
            ${x.done.length ? `<h4>Выполнено</h4><ul class="mini-rows">${x.done.sort((a, b) => (b.spent_minutes || 0) - (a.spent_minutes || 0)).map((t) => `
              <li data-act="openTask" data-id="${t.id}" tabindex="0"><span>${esc(t.title)}</span><span class="muted small">${esc(fmtShort(new Date(t.completed_at)))}</span><b>${t.spent_minutes ? esc(fmtMinutes(t.spent_minutes)) : '—'}</b></li>`).join('')}</ul>` : ''}
            ${x.open.length ? `<h4>Не завершено</h4><ul class="mini-rows">${x.open.map((t) => `
              <li data-act="openTask" data-id="${t.id}" tabindex="0"><span>${esc(t.title)}</span><span class="muted small">${esc(columnById(t.column_id)?.name || '')}</span><b class="${isOverdue(t) ? 'bad' : ''}">${t.deadline ? esc(fmtShort(t.deadline)) : ''}</b></li>`).join('')}</ul>` : ''}
            ${x.goals.length ? `<h4>Личные цели</h4><ul class="sum-goals">${x.goals.map(goalRow).join('')}</ul>` : ''}
            ${!x.done.length && !x.open.length ? '<p class="muted small">Задач в этом периоде нет.</p>' : ''}
          </div>
        </details>`).join('')}
    </div>

    ${d.teamGoals.length ? `<section class="panel"><h2 class="panel-h">Цели команды</h2><ul class="sum-goals">${d.teamGoals.map(goalRow).join('')}</ul></section>` : ''}

    ${d.groupList.length ? `<section class="panel"><h2 class="panel-h">Задачи, назначенные нескольким</h2>
      <ul class="sum-goals">${d.groupList.map((g) => {
        const done = g.filter((t) => t.completed_at).length; const pct = Math.round((done / g.length) * 100);
        return `<li data-act="openTask" data-id="${g[0].id}" tabindex="0" class="clickable"><span class="sg-title">${esc(g[0].title)}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${done} из ${g.length}</b><span></span></li>`;
      }).join('')}</ul></section>` : ''}

    <p class="note muted small">Время — то, что люди указали при выполнении задач. Рейтинга нет: итоги нужны, чтобы видеть нагрузку, а не сравнивать людей.</p>
  `;
}

actions.sumScope = (el) => { state.summary.scope = el.dataset.scope; state.summary.offset = 0; hooks.render(); };
actions.sumShift = (el) => { const d = Number(el.dataset.d); state.summary.offset = d === 0 ? 0 : state.summary.offset + d; hooks.render(); };
inputs.sumFrom = (el) => { state.summary.from = el.value; hooks.render(); };
inputs.sumTo = (el) => { state.summary.to = el.value; hooks.render(); };

actions.exportPeople = () => {
  const r = range(); const d = compute(r);
  const rows = [['Сотрудник', 'Должность', 'Период', 'Выполнено задач', 'Всего задач в периоде', 'Потрачено, ч', 'Просрочено', 'Без указанного времени']];
  for (const x of d.rows) {
    if (hiddenFromMe(x.p.id)) { rows.push([fullName(x.p), x.p.position, `${r[0]} — ${r[1]}`, 'скрыто', '', '', '', '']); continue; }
    rows.push([fullName(x.p), x.p.position, `${r[0]} — ${r[1]}`, x.done.length, x.total, (x.minutes / 60).toFixed(2).replace('.', ','), x.overdue.length, x.unlogged]);
  }
  rows.push([]);
  rows.push(['Отдел', 'Выполнено', 'В плане', 'Потрачено, ч']);
  for (const x of d.byDept) rows.push([x.name, x.done, x.open, (x.minutes / 60).toFixed(2).replace('.', ',')]);
  rows.push([]);
  rows.push(['Категория', 'Выполнено', 'В плане', 'Потрачено, ч']);
  for (const x of d.byCat) rows.push([x.name, x.done, x.open, (x.minutes / 60).toFixed(2).replace('.', ',')]);
  downloadCSV(`itogi_${r[0]}_${r[1]}.csv`, rows);
  toast('Файл сохранён', 'ok');
};

actions.exportTasks = () => {
  const r = range(); const d = compute(r);
  const rows = [['Задача', 'Исполнитель', 'Отдел', 'Категория', 'Статус', 'Тип', 'Приоритет', 'Период', 'Дедлайн', 'Выполнена', 'Потрачено, мин']];
  for (const x of d.rows) {
    for (const t of [...x.done, ...x.open]) {
      rows.push([
        t.title, fullName(x.p), deptById(t.department_id)?.name || '', catById(t.category_id)?.name || '',
        columnById(t.column_id)?.name || '', t.kind === 'team' ? 'Командная' : 'Личная',
        { low: 'Низкий', medium: 'Средний', high: 'Высокий' }[t.priority],
        t.period_type === 'none' ? '' : fmtPeriod(t.period_type, t.period_start, t.period_end),
        t.deadline || '', t.completed_at ? toISO(new Date(t.completed_at)) : '', t.spent_minutes ?? '',
      ]);
    }
  }
  downloadCSV(`zadachi_${r[0]}_${r[1]}.csv`, rows);
  toast('Файл сохранён', 'ok');
};
