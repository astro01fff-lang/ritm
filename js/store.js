// Общее состояние приложения и правила доступа на стороне интерфейса.
// Настоящая защита данных — в базе (Row Level Security); здесь только скрываем недоступные кнопки.

export const state = {
  me: null,          // профиль текущего пользователя
  team: null,
  members: [],
  columns: [],
  departments: [],
  categories: [],
  tasks: [],
  goals: [],
  goalProgress: {},
  notifications: [],
  highFives: [],
  focus: [],
  route: 'board',
  loaded: false,
  filters: { q: '', assignee: 'all', priority: 'all', category: 'all', department: 'all', period: 'all', kind: 'all', overdue: false },
  board: { groupBy: 'status', hideDone: true },
  mine: { scope: 'week', offset: 0 },
  summary: { scope: 'week', offset: 0, from: '', to: '' },
  openTaskId: null,
};

// Обработчики действий: data-act="имя" в разметке
export const actions = {};
// Обработчики полей: data-on="имя" (события input/change)
export const inputs = {};

export const hooks = {
  render: () => {},
  refresh: async () => {},
  renderDrawer: () => {},
};

export const memberById = (id) => state.members.find((m) => m.id === id) || null;
export const columnById = (id) => state.columns.find((c) => c.id === id) || null;
export const taskById = (id) => state.tasks.find((t) => t.id === id) || null;
export const goalById = (id) => state.goals.find((g) => g.id === id) || null;
export const deptById = (id) => state.departments.find((d) => d.id === id) || null;
export const myDepartments = () => state.departments.filter((d) => d.owner_id === state.me?.id);
// Отделы, подходящие для задачи: отделы исполнителя (если они мне видны), иначе мои
export function departmentsFor(assigneeId) {
  const theirs = assigneeId ? state.departments.filter((d) => d.owner_id === assigneeId) : [];
  return theirs.length ? theirs : myDepartments();
}
export const deptKey = (name) => String(name || '').trim().toLowerCase();
export const catById = (id) => state.categories.find((c) => c.id === id) || null;
export const activeMembers = () => state.members.filter((m) => m.active);

// Управление командой (люди, ссылки, справочники, общие цели): администратор и руководитель
export const isLead = () => state.me?.role === 'admin' || state.me?.role === 'manager';
export const isAdmin = isLead;
// Видеть личные задачи и итоги всех — только руководитель
export const seesAll = () => state.me?.role === 'manager';
// Чьи личные задачи от меня скрыты (настройка «Задачи видит только он сам»)
export const hiddenFromMe = (userId) => {
  if (!userId || userId === state.me?.id) return false;
  if (!seesAll()) return true;
  const p = state.members.find((m) => m.id === userId);
  return !!p && p.private_tasks;
};

const leadOver = (t) => seesAll() && !hiddenFromMe(t.assignee_id);
export function canEdit(t) {
  if (!t || !state.me) return false;
  const me = state.me.id;
  return leadOver(t) || t.assignee_id === me || t.author_id === me || (t.kind === 'team' && !t.assignee_id);
}
export const canDelete = (t) => !!t && (leadOver(t) || t.author_id === state.me?.id);
export const canReassign = (t) => !!t && (leadOver(t) || t.author_id === state.me?.id);

export const doneColumn = () => state.columns.find((c) => c.is_done) || state.columns[state.columns.length - 1];
export const firstColumn = () => state.columns.find((c) => !c.is_done) || state.columns[0];
export const isDone = (t) => !!t.completed_at;
export const isArchived = (t) => !!t.archived_at;

export function isOverdue(t) {
  if (!t.deadline || t.completed_at) return false;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const [y, m, dd] = t.deadline.split('-').map(Number);
  return new Date(y, m - 1, dd) < d;
}

export const highFivesFor = (taskId) => state.highFives.filter((h) => h.task_id === taskId);

export const unreadCount = () => state.notifications.filter((n) => !n.read_at).length;


// Копии одной задачи, назначенной нескольким людям
export const groupCopies = (groupId) => (groupId ? state.tasks.filter((t) => t.group_id === groupId) : []);
