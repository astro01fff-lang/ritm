// «Архив»: выполненные задачи, убранные с доски. Поиск, просмотр, возврат в работу.
import * as api from '../api.js';
import { state, actions, inputs, hooks, memberById, taskById, canEdit } from '../store.js';
import { esc, icon, avatar, shortName, fmtShort, fmtMinutes, toast, plural } from '../ui.js';
import { catTag, deptTag } from './board.js';
import { reopenTask } from '../task.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
let query = '';

export function render() {
  const norm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е');
  const q = norm(query.trim());
  const all = state.tasks.filter((t) => t.archived_at);
  const list = all
    .filter((t) => !q || norm(`${t.title} ${t.description}`).includes(q))
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));

  const groups = new Map();
  for (const t of list) {
    const d = new Date(t.completed_at || t.archived_at);
    const key = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  return `
    <div class="view-head">
      <div><h1>Архив</h1><p class="muted">Выполненные задачи, убранные с доски. Они по-прежнему учитываются в итогах и целях</p></div>
    </div>
    <p class="callout">${icon('archive', 16)} Выполненные задачи уходят сюда сами через 7 дней. Отправить раньше можно кнопкой с коробкой в колонке «Готово» или в карточке задачи.</p>

    ${all.length ? `<div class="filters"><label class="search">${icon('search', 16)}<input type="search" placeholder="Поиск по архиву" value="${esc(query)}" data-on="archiveQ" data-focus-key="archiveQ" aria-label="Поиск по архиву"></label>
      <span class="muted small">${list.length} ${plural(list.length, 'задача', 'задачи', 'задач')}</span></div>` : ''}

    ${!all.length ? `<div class="empty">
        <div class="empty-art">${icon('archive', 40)}</div>
        <h2>Архив пока пустой</h2>
        <p class="muted">Сюда попадут выполненные задачи — автоматически через неделю после выполнения или когда вы отправите их вручную.</p>
      </div>` : ''}
    ${all.length && !list.length ? `<p class="found found-none">Ничего не найдено по запросу «${esc(query)}».</p>` : ''}

    ${[...groups.entries()].map(([month, tasks]) => `
      <h2 class="list-h">${month} <span>${tasks.length}</span></h2>
      <ul class="rows">
        ${tasks.map((t) => `
          <li class="row is-done" data-act="openTask" data-id="${t.id}" tabindex="0">
            ${avatar(memberById(t.assignee_id), 28)}
            <div class="row-main">
              <div class="row-title">${esc(t.title)}</div>
              <div class="row-meta">
                ${catTag(t)}${deptTag(t)}
                <span>${esc(shortName(memberById(t.assignee_id)))}</span>
                <span>выполнена ${esc(fmtShort(new Date(t.completed_at)))}</span>
              </div>
            </div>
            ${t.spent_minutes ? `<span class="row-time">${esc(fmtMinutes(t.spent_minutes))}</span>` : ''}
            ${canEdit(t) ? `<button class="btn btn-ghost btn-sm" data-act="restoreTask" data-id="${t.id}" data-stop>Вернуть в работу</button>` : ''}
          </li>`).join('')}
      </ul>`).join('')}
  `;
}

inputs.archiveQ = (el) => { query = el.value; hooks.render(); };

actions.restoreTask = async (el) => {
  const t = taskById(el.dataset.id); if (!t) return;
  await reopenTask(t);
  t.archived_at = null;
  hooks.render();
  toast('Задача вернулась на доску', 'ok');
};
