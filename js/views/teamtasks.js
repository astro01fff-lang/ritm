// «Командные задачи»: общие задачи и задачи, назначенные нескольким людям.
import * as api from '../api.js';
import { state, actions, hooks, memberById, columnById, taskById, isLead, isOverdue } from '../store.js';
import { esc, icon, avatar, shortName, fullName, fmtDeadline, fmtPeriod, fmtMinutes, toast } from '../ui.js';
import { filterBar, filterTasks, card } from './board.js';
import { askPushMessage } from '../task.js';

export function render() {
  const visible = filterTasks(state.tasks);
  const groups = {};
  for (const t of visible) if (t.group_id) (groups[t.group_id] ||= []).push(t);
  const groupList = Object.values(groups).filter((g) => g.length > 1 || isLead())
    .map((g) => {
      const all = state.tasks.filter((t) => t.group_id === g[0].group_id);
      return { head: all[0], all };
    })
    .sort((a, b) => (a.head.deadline || '9999').localeCompare(b.head.deadline || '9999'));
  const free = visible.filter((t) => t.kind === 'team' && !t.assignee_id && !t.completed_at && !t.group_id);
  const team = visible.filter((t) => t.kind === 'team' && t.assignee_id && !t.group_id);
  const openTeam = team.filter((t) => !t.completed_at);
  const doneTeam = team.filter((t) => t.completed_at);

  const nothing = !groupList.length && !free.length && !team.length;
  return `
    <div class="view-head">
      <div><h1>Командные задачи</h1><p class="muted">Общие задачи и задачи, поставленные сразу нескольким людям</p></div>
      <button class="btn btn-primary" data-act="newTask" data-kind="team">${icon('plus', 18)} Командная задача</button>
    </div>
    ${filterBar()}

    ${nothing ? `
      <div class="empty">
        <div class="empty-art">${icon('users', 40)}</div>
        <h2>Командных задач пока нет</h2>
        <p class="muted">${isLead() ? 'Поставьте задачу всей команде — у каждого появится своя копия, а вы увидите, кто уже сделал.' : 'Здесь появятся задачи, которые видит вся команда.'}</p>
        <button class="btn btn-primary" data-act="newTask" data-kind="team">${icon('plus', 18)} Создать командную задачу</button>
      </div>` : ''}

    ${groupList.length ? `
      <h2 class="list-h">Назначено нескольким <span>${groupList.length}</span></h2>
      <div class="groups">
        ${groupList.map(({ head, all }) => {
          const done = all.filter((t) => t.completed_at).length;
          const pct = Math.round((done / all.length) * 100);
          const minutes = all.reduce((a, t) => a + (t.spent_minutes || 0), 0);
          return `
          <article class="group-card">
            <header>
              <h3>${esc(head.title)}</h3>
              <div class="group-meta">
                ${head.deadline ? `<span class="${all.some(isOverdue) ? 'bad' : ''}">${icon('calendar', 14)} ${esc(fmtDeadline(head.deadline))}</span>` : ''}
                ${head.period_type !== 'none' ? `<span>${esc(fmtPeriod(head.period_type, head.period_start, head.period_end))}</span>` : ''}
                <span>поставил(а) ${esc(shortName(memberById(head.author_id)))}</span>
                ${minutes ? `<span>${icon('clock', 14)} всего ${esc(fmtMinutes(minutes))}</span>` : ''}
              </div>
            </header>
            <div class="group-progress"><div class="bar"><i style="width:${pct}%"></i></div><b>${done} из ${all.length}</b></div>
            ${isLead() && done < all.length ? `<button class="btn btn-ghost btn-sm group-push" data-act="pushGroup" data-group="${head.group_id}">👋 Напомнить тем, кто не сделал (${all.length - done})</button>` : ''}
            <ul class="group-people">
              ${all.map((t) => `<li data-act="openTask" data-id="${t.id}" tabindex="0" class="${t.completed_at ? 'ok' : ''}">
                ${avatar(memberById(t.assignee_id), 26)}
                <span class="gp-name">${esc(fullName(memberById(t.assignee_id)))}</span>
                <span class="gp-status">${t.completed_at ? `${icon('check', 14)} ${t.spent_minutes ? esc(fmtMinutes(t.spent_minutes)) : 'готово'}` : esc(columnById(t.column_id)?.name || '')}</span>
              </li>`).join('')}
            </ul>
          </article>`;
        }).join('')}
      </div>` : ''}

    ${free.length ? `
      <h2 class="list-h">Можно взять <span>${free.length}</span></h2>
      <div class="card-grid">
        ${free.map((t) => `<div class="card-wrap">${card(t)}<button class="btn btn-ghost btn-sm take-btn" data-act="takeFree" data-id="${t.id}">Взять себе</button></div>`).join('')}
      </div>` : ''}

    ${openTeam.length ? `<h2 class="list-h">В работе у команды <span>${openTeam.length}</span></h2>
      <div class="card-grid">${openTeam.map((t) => card(t)).join('')}</div>` : ''}
    ${doneTeam.length ? `<h2 class="list-h">Выполнено <span>${doneTeam.length}</span></h2>
      <div class="card-grid">${doneTeam.map((t) => card(t, { compact: true })).join('')}</div>` : ''}
  `;
}

actions.pushGroup = async (el) => {
  const pending = state.tasks.filter((t) => t.group_id === el.dataset.group && !t.completed_at && t.assignee_id && t.assignee_id !== state.me.id);
  if (!pending.length) { toast('Напоминать некому', 'info'); return; }
  const msg = await askPushMessage(`Напомнить ${pending.length} ${pending.length === 1 ? 'человеку' : 'людям'}`);
  if (msg == null) return;
  let ok = 0, skipped = 0;
  for (const t of pending) {
    try { await api.sendPush(t, state.me.id, msg); ok++; } catch { skipped++; }
  }
  toast(skipped ? `Напомнили: ${ok}. Пропущено ${skipped} — им уже напоминали недавно` : `Напомнили: ${ok}`, ok ? 'ok' : 'info', 4000);
};

actions.takeFree = async (el) => {
  const t = taskById(el.dataset.id); if (!t) return;
  t.assignee_id = state.me.id; hooks.render();
  try { await api.updateTask(t.id, { assignee_id: state.me.id }); toast('Задача ваша', 'ok'); }
  catch (e) { toast(e.message, 'error'); hooks.refresh(); }
};
