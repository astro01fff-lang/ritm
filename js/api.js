// Работа с Supabase: все запросы к базе и серверной функции собраны здесь.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const configured = !!SUPABASE_URL && !SUPABASE_URL.includes('ВАШ') && !!SUPABASE_KEY && !SUPABASE_KEY.includes('ВАШ');

export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null;

function check(res, what) {
  if (res.error) {
    const e = new Error(humanError(res.error.message || String(res.error), what));
    e.cause = res.error;
    throw e;
  }
  return res.data;
}

function humanError(msg, what) {
  if (/row-level security|permission denied/i.test(msg)) return 'Недостаточно прав для этого действия';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Нет связи с сервером. Проверьте интернет';
  if (/JWT|session/i.test(msg)) return 'Сессия истекла. Откройте свою ссылку входа ещё раз';
  return msg || `Ошибка: ${what}`;
}

// ---------------------------------------------------------------- серверная функция

export async function fn(action, payload = {}) {
  const res = await sb.functions.invoke('tracker-api', { body: { action, ...payload } });
  if (res.error) {
    let message = res.error.message;
    try { const body = await res.error.context.json(); if (body?.error) message = body.error; } catch { /* ignore */ }
    if (/Failed to send a request/i.test(message)) message = 'Серверная функция недоступна. Проверьте, что tracker-api развёрнута';
    throw new Error(message);
  }
  if (res.data?.error) throw new Error(res.data.error);
  return res.data;
}

// ---------------------------------------------------------------- вход

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

// Вход: ссылка определяет человека, пароль подтверждает, что это он
export const resolveLink = (token) => fn('login', { token });

export async function signInWithPassword(email, password) {
  const res = await sb.auth.signInWithPassword({ email, password });
  if (res.error) {
    const m = res.error.message || '';
    if (/invalid login credentials/i.test(m)) throw new Error('Неверный пароль');
    if (/rate limit|too many/i.test(m)) throw new Error('Слишком много попыток. Подождите несколько минут');
    throw new Error(humanError(m, 'вход'));
  }
  fn('mark_login').catch(() => {});
  return res.data.session;
}

export async function setPasswordAndSignIn(token, password) {
  const { email } = await fn('set_password', { token, password });
  return signInWithPassword(email, password);
}

export async function changePassword(password) {
  check(await sb.auth.updateUser({ password }), 'смена пароля');
}

export async function signOut() {
  await sb.auth.signOut();
}

export const setupStatus = () => fn('status');
export const bootstrap = (p) => fn('bootstrap', p);

// ---------------------------------------------------------------- загрузка

export async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const profile = check(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle(), 'профиль');
  if (!profile || !profile.active) return null;
  const team = check(await sb.from('teams').select('*').eq('id', profile.team_id).single(), 'команда');
  return { profile, team };
}

export const loadMembers = async () =>
  check(await sb.from('profiles').select('*').is('removed_at', null).order('first_name'), 'участники');

export const loadColumns = async () =>
  check(await sb.from('columns').select('*').order('position'), 'колонки');

// Отделы и категории — одинаковые справочники
export const loadRefs = async (table) =>
  check(await sb.from(table).select('*').order('position'), table === 'departments' ? 'отделы' : 'категории');
export const createRef = async (table, row) => check(await sb.from(table).insert(row).select().single(), 'справочник');
export const updateRef = async (table, id, patch) => check(await sb.from(table).update(patch).eq('id', id), 'справочник');
export const deleteRef = async (table, id) => check(await sb.from(table).delete().eq('id', id), 'справочник');

export async function loadTasks() {
  const rows = check(await sb.from('tasks')
    .select('*, subtasks(id, done), task_comments(count), task_attachments(count)')
    .order('position'), 'задачи');
  return rows.map((t) => ({
    ...t,
    sub_total: t.subtasks?.length || 0,
    sub_done: t.subtasks?.filter((s) => s.done).length || 0,
    comments_count: t.task_comments?.[0]?.count || 0,
    attachments_count: t.task_attachments?.[0]?.count || 0,
  }));
}

export const loadGoals = async () =>
  check(await sb.from('goals').select('*').order('period_start', { ascending: false }), 'цели');

export async function loadGoalProgress() {
  const rows = check(await sb.rpc('goal_progress'), 'прогресс целей') || [];
  return Object.fromEntries(rows.map((r) => [r.goal_id, r]));
}

export const loadNotifications = async () =>
  check(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60), 'уведомления');

export const checkDeadlines = async () => { try { await sb.rpc('check_my_deadlines'); } catch { /* не критично */ } };

// ---------------------------------------------------------------- задачи

export async function createTasks(base, assigneeIds, subtasks = []) {
  const ids = assigneeIds.length ? assigneeIds : [null];
  const group_id = ids.length > 1 ? crypto.randomUUID() : null;
  const rows = ids.map((assignee_id) => ({ ...base, assignee_id, group_id }));
  const created = check(await sb.from('tasks').insert(rows).select(), 'создание задачи');
  if (subtasks.length) {
    const subs = created.flatMap((t) => subtasks.map((title, i) => ({ task_id: t.id, title, position: (i + 1) * 1000 })));
    check(await sb.from('subtasks').insert(subs), 'подзадачи');
  }
  return created;
}

export const updateTask = async (id, patch) =>
  check(await sb.from('tasks').update(patch).eq('id', id).select().single(), 'сохранение задачи');

export const deleteTask = async (id) => check(await sb.from('tasks').delete().eq('id', id), 'удаление задачи');

export const loadSubtasks = async (taskId) =>
  check(await sb.from('subtasks').select('*').eq('task_id', taskId).order('position'), 'подзадачи');
export const addSubtask = async (taskId, title, position) =>
  check(await sb.from('subtasks').insert({ task_id: taskId, title, position }).select().single(), 'подзадача');
export const updateSubtask = async (id, patch) => check(await sb.from('subtasks').update(patch).eq('id', id), 'подзадача');
export const deleteSubtask = async (id) => check(await sb.from('subtasks').delete().eq('id', id), 'подзадача');

export const loadComments = async (taskId) =>
  check(await sb.from('task_comments').select('*').eq('task_id', taskId).order('created_at'), 'комментарии');
export const addComment = async (taskId, authorId, body) =>
  check(await sb.from('task_comments').insert({ task_id: taskId, author_id: authorId, body }), 'комментарий');
export const deleteComment = async (id) => check(await sb.from('task_comments').delete().eq('id', id), 'комментарий');

export const loadHistory = async (taskId) =>
  check(await sb.from('task_history').select('*').eq('task_id', taskId).order('created_at', { ascending: false }), 'история');

export const loadAttachments = async (taskId) =>
  check(await sb.from('task_attachments').select('*').eq('task_id', taskId).order('created_at'), 'вложения');

export async function uploadAttachment(taskId, userId, file) {
  if (file.size > 20 * 1024 * 1024) throw new Error(`Файл «${file.name}» больше 20 МБ`);
  const safe = file.name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) || 'file';
  const path = `${taskId}/${Date.now()}-${safe}`;
  check(await sb.storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream' }), 'загрузка файла');
  check(await sb.from('task_attachments').insert({
    task_id: taskId, storage_path: path, file_name: file.name.slice(0, 255), size_bytes: file.size,
    mime_type: file.type || '', uploaded_by: userId,
  }), 'вложение');
}

export async function attachmentUrl(path) {
  const res = check(await sb.storage.from('attachments').createSignedUrl(path, 600), 'ссылка на файл');
  return res.signedUrl;
}

export async function deleteAttachment(att) {
  await sb.storage.from('attachments').remove([att.storage_path]);
  check(await sb.from('task_attachments').delete().eq('id', att.id), 'удаление вложения');
}

// ---------------------------------------------------------------- колонки

export const createColumn = async (teamId, name, position) =>
  check(await sb.from('columns').insert({ team_id: teamId, name, position }).select().single(), 'колонка');
export const updateColumn = async (id, patch) => check(await sb.from('columns').update(patch).eq('id', id), 'колонка');
export const deleteColumn = async (id) => check(await sb.from('columns').delete().eq('id', id), 'колонка');
export async function moveColumnTasks(fromId, toId) {
  check(await sb.from('tasks').update({ column_id: toId }).eq('column_id', fromId), 'перенос задач');
}

// ---------------------------------------------------------------- цели

export const createGoal = async (goal) => check(await sb.from('goals').insert(goal).select().single(), 'цель');
export const updateGoal = async (id, patch) => check(await sb.from('goals').update(patch).eq('id', id), 'цель');
export const deleteGoal = async (id) => check(await sb.from('goals').delete().eq('id', id), 'цель');

// ---------------------------------------------------------------- хай-файвы, напоминания, фокус

export const loadHighFives = async () =>
  check(await sb.from('high_fives').select('id, task_id, from_id, to_id, created_at'), 'хай-файвы');
export const giveHighFive = async (task, fromId) =>
  check(await sb.from('high_fives').insert({ team_id: task.team_id, task_id: task.id, from_id: fromId, to_id: task.assignee_id }).select().single(), 'хай-файв');
export const takeBackHighFive = async (id) => check(await sb.from('high_fives').delete().eq('id', id), 'хай-файв');

export const sendPush = async (task, fromId, message) =>
  check(await sb.from('colleague_pushes').insert({ team_id: task.team_id, task_id: task.id, from_id: fromId, to_id: task.assignee_id, message }), 'напоминание');
export const loadPushes = async (taskId) =>
  check(await sb.from('colleague_pushes').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).limit(10), 'напоминания');

export const saveFocus = async (row) => check(await sb.from('focus_sessions').insert(row).select().single(), 'фокус-сессия');
export async function loadFocus() {
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  return check(await sb.from('focus_sessions').select('*').gte('started_at', since).order('started_at', { ascending: false }), 'фокус');
}

// ---------------------------------------------------------------- уведомления

export const markRead = async (id) =>
  check(await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id), 'уведомление');
export const markAllRead = async (userId) =>
  check(await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null), 'уведомления');

// ---------------------------------------------------------------- профиль и команда

export const updateProfile = async (id, patch) =>
  check(await sb.from('profiles').update(patch).eq('id', id).select().single(), 'профиль');
export const updateTeam = async (id, patch) => check(await sb.from('teams').update(patch).eq('id', id), 'команда');

export const createMember = (p) => fn('create_member', p);
export const reissueLink = (userId) => fn('reissue_link', { userId });
export const revokeLink = (userId) => fn('revoke_link', { userId });
export const setRole = (userId, role) => fn('set_role', { userId, role });
export const removeMember = (userId) => fn('remove_member', { userId });
export const setPrivate = (userId, value) => fn('set_private', { userId, value });
export const seedDemo = () => fn('seed_demo');
export const clearDemo = () => fn('clear_demo');

// ---------------------------------------------------------------- реальное время

export function subscribe(userId, onData, onNotification) {
  const ch = sb.channel('tracker-live');
  for (const table of ['tasks', 'columns', 'departments', 'categories', 'subtasks', 'task_comments', 'task_attachments', 'goals', 'profiles', 'high_fives']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => onData(table, p));
  }
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
    (p) => onNotification(p.new));
  ch.subscribe();
  return () => sb.removeChannel(ch);
}

export function onAuthChange(cb) {
  return sb.auth.onAuthStateChange((event, session) => cb(event, session));
}

export function linkFor(token) {
  return `${location.origin}${location.pathname}#/join/${token}`;
}
