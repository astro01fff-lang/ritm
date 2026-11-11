// Серверная функция таск-трекера (Supabase Edge Function).
// Вход по персональным ссылкам, управление участниками, демоданные.
// Важно: в настройках функции выключите "Verify JWT" (Enforce JWT verification) —
// функция сама проверяет, кто её вызывает.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
const SETUP_SECRET = Deno.env.get("SETUP_SECRET") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new HttpError(500, `${what}: ${res.error.message}`);
  return res.data;
}

const ROLES = ["admin", "manager", "member"];
const COLORS = ["#F28BB5", "#8BC6F2", "#B5F28B", "#F2C98B", "#C49BF2", "#8BF2DF", "#F29B8B", "#E8E08B"];

function clean(v: unknown, max = 120): string {
  return String(v ?? "").trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Пользователи и ссылки
// ---------------------------------------------------------------------------

function randomPassword(): string {
  return newToken(); // 43 символа: Supabase принимает пароли до 72 символов
}

function checkPassword(p: unknown): string {
  const pw = String(p ?? "");
  if (pw.length < 8) throw new HttpError(400, "Пароль должен быть не короче 8 символов");
  if (pw.length > 72) throw new HttpError(400, "Пароль слишком длинный");
  return pw;
}

// Выпустить новую ссылку. passwordSet=false — по ссылке нужно будет задать пароль.
async function issueLink(userId: string, passwordSet = false): Promise<string> {
  must(await db.from("access_links").update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId).is("revoked_at", null), "revoke old links");
  const token = newToken();
  must(await db.from("access_links").insert({ user_id: userId, token_hash: await sha256(token), password_set: passwordSet }), "create link");
  return token;
}

async function activeLink(token: string) {
  if (token.length < 20) throw new HttpError(400, "Ссылка недействительна");
  const { data: link } = await db.from("access_links").select("*")
    .eq("token_hash", await sha256(token)).is("revoked_at", null).maybeSingle();
  if (!link) throw new HttpError(403, "Ссылка недействительна. Попросите администратора выпустить новую");
  const { data: profile } = await db.from("profiles").select("id, first_name, active, removed_at").eq("id", link.user_id).maybeSingle();
  if (!profile || profile.removed_at) throw new HttpError(403, "Ссылка недействительна");
  const userRes = await db.auth.admin.getUserById(link.user_id);
  const email = userRes.data.user?.email;
  if (!email) throw new HttpError(500, "Пользователь не найден");
  return { link, profile, email };
}

async function endSessions(userId: string) {
  const { error } = await db.rpc("revoke_user_sessions", { p_user: userId });
  if (error) console.error("revoke_user_sessions", error.message);
}

async function createUser(opts: {
  teamId: string; role: string; firstName: string; lastName: string; position?: string;
  city?: string; color?: string; isDemo?: boolean; password?: string;
}) {
  const email = `${crypto.randomUUID()}@users.example.com`;
  // Если пароль не задан сразу, ставим случайный: войти нельзя, пока человек не задаст свой по ссылке
  const created = await db.auth.admin.createUser({ email, email_confirm: true, password: opts.password ?? randomPassword() });
  if (created.error || !created.data.user) throw new HttpError(500, "Не удалось создать пользователя: " + created.error?.message);
  const id = created.data.user.id;
  const ins = await db.from("profiles").insert({
    id, team_id: opts.teamId, role: opts.role,
    first_name: opts.firstName, last_name: opts.lastName, position: opts.position ?? "",
    city: opts.city ?? "",
    avatar_color: opts.color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
    is_demo: !!opts.isDemo,
  });
  if (ins.error) {
    await db.auth.admin.deleteUser(id);
    throw new HttpError(500, "Не удалось создать профиль: " + ins.error.message);
  }
  const token = await issueLink(id, !!opts.password);
  return { id, token, email };
}

async function getCaller(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Нужно войти");
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Нужно войти");
  const { data: profile } = await db.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!profile || !profile.active) throw new HttpError(403, "Доступ закрыт");
  return profile as { id: string; team_id: string; role: string };
}

// Управлять командой могут администратор и руководитель
const canManage = (role: string) => role === "admin" || role === "manager";

async function requireAdmin(req: Request) {
  const me = await getCaller(req);
  if (!canManage(me.role)) throw new HttpError(403, "Только для администратора или руководителя");
  return me;
}

async function memberOfTeam(userId: string, teamId: string) {
  const { data } = await db.from("profiles").select("*").eq("id", userId).eq("team_id", teamId).maybeSingle();
  if (!data) throw new HttpError(404, "Участник не найден");
  return data;
}

// ---------------------------------------------------------------------------
// Действия
// ---------------------------------------------------------------------------

async function status() {
  const { count } = await db.from("teams").select("id", { count: "exact", head: true });
  return { needsSetup: (count ?? 0) === 0 };
}

async function bootstrap(body: Record<string, unknown>) {
  if (!SETUP_SECRET) throw new HttpError(400, "В настройках функции не задан секрет SETUP_SECRET");
  if (clean(body.secret, 200) !== SETUP_SECRET) throw new HttpError(403, "Неверный код установки");
  if (!(await status()).needsSetup) throw new HttpError(400, "Команда уже создана");
  const teamName = clean(body.teamName) || "Моя команда";
  const firstName = clean(body.firstName, 80);
  if (!firstName) throw new HttpError(400, "Укажите имя");
  const password = checkPassword(body.password);
  const team = must(await db.from("teams").insert({ name: teamName }).select().single(), "create team");
  const user = await createUser({
    teamId: team.id, role: "admin", firstName, lastName: clean(body.lastName, 80),
    position: clean(body.position), color: "#F28BB5", password,
  });
  return { token: user.token, email: user.email };
}

// Шаг 1 входа: по ссылке узнаём, кто это и задан ли пароль. Сессию здесь не выдаём —
// она появляется только после проверки пароля (signInWithPassword на стороне сайта).
async function login(body: Record<string, unknown>) {
  const { link, profile, email } = await activeLink(clean(body.token, 200));
  await db.from("access_links").update({ last_used_at: new Date().toISOString() }).eq("id", link.id);
  return { email, name: profile.first_name, needsPassword: !link.password_set };
}

// Первый вход по ссылке (или вход по новой ссылке после сброса): человек задаёт пароль
async function setPassword(body: Record<string, unknown>) {
  const { link, email } = await activeLink(clean(body.token, 200));
  if (link.password_set) throw new HttpError(400, "Пароль уже задан. Войдите с ним или попросите новую ссылку");
  const password = checkPassword(body.password);
  const upd = await db.auth.admin.updateUserById(link.user_id, { password });
  if (upd.error) throw new HttpError(400, "Не удалось сохранить пароль: " + upd.error.message);
  must(await db.from("access_links").update({ password_set: true }).eq("id", link.id), "link");
  must(await db.from("profiles").update({ active: true }).eq("id", link.user_id), "activate");
  return { email };
}

async function markLogin(req: Request) {
  const me = await getCaller(req);
  await db.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", me.id);
  return { ok: true };
}

async function createMember(req: Request, body: Record<string, unknown>) {
  const me = await requireAdmin(req);
  const role = ROLES.includes(String(body.role)) ? String(body.role) : "member";
  const firstName = clean(body.firstName, 80);
  if (!firstName) throw new HttpError(400, "Укажите имя");
  const user = await createUser({
    teamId: me.team_id, role, firstName, lastName: clean(body.lastName, 80),
    position: clean(body.position), city: clean(body.city, 80),
  });
  return user;
}

async function reissueLink(req: Request, body: Record<string, unknown>) {
  const me = await requireAdmin(req);
  const target = await memberOfTeam(String(body.userId), me.team_id);
  if (target.removed_at) throw new HttpError(400, "Участник удалён из команды");
  if (target.id !== me.id) await endSessions(target.id);
  // новая ссылка = сброс пароля: старый перестаёт работать, по ссылке задаётся новый
  await db.auth.admin.updateUserById(target.id, { password: randomPassword() });
  const token = await issueLink(target.id);
  must(await db.from("profiles").update({ active: true }).eq("id", target.id), "activate");
  return { token };
}

async function revokeLink(req: Request, body: Record<string, unknown>) {
  const me = await requireAdmin(req);
  const target = await memberOfTeam(String(body.userId), me.team_id);
  if (target.id === me.id) throw new HttpError(400, "Нельзя отозвать собственную ссылку");
  must(await db.from("access_links").update({ revoked_at: new Date().toISOString() })
    .eq("user_id", target.id).is("revoked_at", null), "revoke");
  must(await db.from("profiles").update({ active: false }).eq("id", target.id), "deactivate");
  await endSessions(target.id);
  return { ok: true };
}

async function setRole(req: Request, body: Record<string, unknown>) {
  const me = await requireAdmin(req);
  const role = String(body.role);
  if (!ROLES.includes(role)) throw new HttpError(400, "Неизвестная роль");
  const target = await memberOfTeam(String(body.userId), me.team_id);
  if (target.id === me.id && !canManage(role)) {
    const { count } = await db.from("profiles").select("id", { count: "exact", head: true })
      .eq("team_id", me.team_id).in("role", ["admin", "manager"]).eq("active", true).is("removed_at", null);
    if ((count ?? 0) <= 1) throw new HttpError(400, "В команде должен остаться хотя бы один администратор или руководитель");
  }
  must(await db.from("profiles").update({ role }).eq("id", target.id), "set role");
  return { ok: true };
}

// Скрытые личные задачи. Включить может администратор или сам человек,
// выключить — только сам человек (иначе администратор мог бы подсмотреть).
async function setPrivate(req: Request, body: Record<string, unknown>) {
  const me = await getCaller(req);
  const value = body.value === true;
  const userId = String(body.userId || me.id);
  const target = await memberOfTeam(userId, me.team_id);
  if (target.id !== me.id) {
    if (!canManage(me.role)) throw new HttpError(403, "Только для администратора или руководителя");
    if (!value) throw new HttpError(403, "Выключить скрытие задач может только сам человек в своих настройках");
  }
  must(await db.from("profiles").update({ private_tasks: value }).eq("id", target.id), "privacy");
  return { ok: true };
}

async function removeMember(req: Request, body: Record<string, unknown>) {
  const me = await requireAdmin(req);
  const target = await memberOfTeam(String(body.userId), me.team_id);
  if (target.id === me.id) throw new HttpError(400, "Нельзя удалить самого себя");
  must(await db.from("access_links").update({ revoked_at: new Date().toISOString() })
    .eq("user_id", target.id).is("revoked_at", null), "revoke");
  must(await db.from("profiles").update({ active: false, removed_at: new Date().toISOString() })
    .eq("id", target.id), "remove");
  await endSessions(target.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Демоданные
// ---------------------------------------------------------------------------

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number) {
  const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x;
}
function weekStart(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = (x.getUTCDay() + 6) % 7; return addDays(x, -wd);
}

async function seedDemo(req: Request) {
  const me = await requireAdmin(req);
  const team = me.team_id;
  const { count } = await db.from("profiles").select("id", { count: "exact", head: true })
    .eq("team_id", team).eq("is_demo", true);
  if ((count ?? 0) > 0) throw new HttpError(400, "Демоданные уже добавлены. Сначала очистите их.");

  const people = [
    { firstName: "Мария", lastName: "Ковалёва", role: "manager", position: "Руководитель отдела", city: "Москва", color: "#8BC6F2" },
    { firstName: "Иван", lastName: "Петров", role: "member", position: "Аналитик", city: "Санкт-Петербург", color: "#B5F28B" },
    { firstName: "Анна", lastName: "Лебедева", role: "member", position: "Менеджер проектов", city: "Казань", color: "#F2C98B" },
    { firstName: "Олег", lastName: "Смирнов", role: "member", position: "Дизайнер", city: "Новосибирск", color: "#C49BF2" },
  ];
  const created: { id: string; token: string; name: string; role: string }[] = [];
  for (const p of people) {
    const u = await createUser({ teamId: team, isDemo: true, ...p });
    created.push({ ...u, name: `${p.firstName} ${p.lastName}`, role: p.role });
  }
  const [mgr, ivan, anna, oleg] = created.map((c) => c.id);
  const self = me.id;

  const cols = must(await db.from("columns").select("*").eq("team_id", team).order("position"), "columns") as
    { id: string; is_done: boolean }[];
  const notDone = cols.filter((c) => !c.is_done);
  const done = cols.find((c) => c.is_done) ?? cols[cols.length - 1];
  const col = (i: number) => (notDone[Math.min(i, notDone.length - 1)] ?? done).id;
  const IN = col(0), TODO = col(1), WORK = col(2), REVIEW = col(3), DONE = done.id;

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ws = weekStart(today);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const day = (n: number) => isoDate(addDays(today, n));
  const week = (offset = 0) => ({ period_type: "week", period_start: isoDate(addDays(ws, 7 * offset)), period_end: isoDate(addDays(ws, 7 * offset + 6)) });
  const month = { period_type: "month", period_start: isoDate(monthStart), period_end: isoDate(monthEnd) };
  const oneDay = (n: number) => ({ period_type: "day", period_start: day(n), period_end: day(n) });
  const doneAt = (n: number, h = 15) => { const d = addDays(today, n); d.setUTCHours(h - 3, 20); return d.toISOString(); };

  // Отделы: добавляем, только если в команде их ещё нет
  // Отделы у каждого свои: примеры добавляем вам, только если у вас их ещё нет
  const existingDeps = must(await db.from("departments").select("id, name").eq("owner_id", self), "departments") as { id: string; name: string }[];
  let deps = existingDeps;
  if (!deps.length) {
    deps = must(await db.from("departments").insert([
      { team_id: team, owner_id: self, name: "Marketing B2B", color: "#8BC6F2", position: 1000 },
      { team_id: team, owner_id: self, name: "Inhouse SMM", color: "#C49BF2", position: 2000 },
      { team_id: team, owner_id: self, name: "Комьюнити", color: "#B5F28B", position: 3000 },
      { team_id: team, owner_id: self, name: "Отдел исследований", color: "#F2C98B", position: 4000 },
    ]).select("id, name"), "departments") as { id: string; name: string }[];
  }
  const depId = (i: number) => deps[i % deps.length]?.id ?? null;
  const cats = must(await db.from("categories").select("id, name").eq("team_id", team), "categories") as { id: string; name: string }[];
  const cat = (name: string) => cats.find((c) => c.name === name)?.id ?? null;

  const teamGoal = must(await db.from("goals").insert({
    team_id: team, owner_id: null, title: "Закрыть квартальный отчёт по корпкультуре",
    description: "Собрать активности и метрики по всем отделам, подготовить выводы.",
    period_start: isoDate(monthStart), period_end: isoDate(monthEnd), created_by: mgr, is_demo: true,
  }).select().single(), "goal");
  const myGoal = must(await db.from("goals").insert({
    team_id: team, owner_id: self, title: "Провести все встречи 1:1 до конца месяца",
    period_start: isoDate(monthStart), period_end: isoDate(monthEnd), created_by: self, is_demo: true,
  }).select().single(), "goal");

  type T = Record<string, unknown>;
  let pos = 1000;
  // У всех строк одинаковый набор полей — так массовая вставка не подставит NULL вместо значений по умолчанию
  const t = (o: T): T => ({
    team_id: team, is_demo: true, kind: "personal", priority: "medium", position: (pos += 1000),
    description: "", category_id: null, department_id: null, deadline: null, goal_id: null, group_id: null,
    completed_at: null, spent_minutes: null, assignee_id: null,
    period_type: "none", period_start: null, period_end: null, ...o,
  });
  const tasks: T[] = [
    t({ title: "Собрать метрики по активностям за квартал", description: "Участие в событиях, вовлечённость, охваты рассылок по каждому отделу.", author_id: mgr, assignee_id: ivan, column_id: WORK, priority: "high", deadline: day(2), ...week(), category_id: cat("Отчётность"), department_id: depId(3), goal_id: teamGoal.id }),
    t({ title: "Сверстать презентацию квартального отчёта", author_id: mgr, assignee_id: oleg, column_id: TODO, deadline: day(6), ...week(1), category_id: cat("Отчётность"), goal_id: teamGoal.id }),
    t({ title: "Написать выводы по опросу вовлечённости", author_id: mgr, assignee_id: self, column_id: REVIEW, priority: "high", deadline: day(1), ...week(), category_id: cat("Опросы"), department_id: depId(3), goal_id: teamGoal.id }),
    t({ title: "Подготовить план адаптации для новичков", author_id: self, assignee_id: self, column_id: WORK, deadline: day(4), ...week(), category_id: cat("Адаптация"), department_id: depId(0) }),
    t({ title: "Встреча 1:1 с новым сотрудником", author_id: self, assignee_id: self, column_id: DONE, ...oneDay(-3), completed_at: doneAt(-3, 12), spent_minutes: 60, category_id: cat("Коммуникация с сотрудниками"), department_id: depId(0), goal_id: myGoal.id }),
    t({ title: "Встреча 1:1 по итогам испытательного срока", author_id: self, assignee_id: self, column_id: TODO, ...oneDay(2), deadline: day(2), category_id: cat("Коммуникация с сотрудниками"), department_id: depId(1), goal_id: myGoal.id }),
    t({ title: "Встреча 1:1 с руководителем комьюнити", author_id: self, assignee_id: self, column_id: IN, ...month, category_id: cat("Коммуникация с сотрудниками"), department_id: depId(2), goal_id: myGoal.id }),
    t({ title: "Обновить базу подрядчиков для мероприятий", author_id: anna, assignee_id: anna, column_id: DONE, priority: "low", ...week(-1), completed_at: doneAt(-6), spent_minutes: 120, category_id: cat("Операционная работа") }),
    t({ title: "Согласовать бюджет новогоднего корпоратива", author_id: mgr, assignee_id: anna, column_id: WORK, priority: "high", deadline: day(-1), ...week(), category_id: cat("Корпоратив") }),
    t({ title: "Обновить обложки для внутреннего канала", author_id: oleg, assignee_id: oleg, column_id: DONE, ...week(-1), completed_at: doneAt(-8), spent_minutes: 240, category_id: cat("Каналы коммуникации") }),
    t({ title: "Разобрать входящие заявки сотрудников", author_id: ivan, assignee_id: ivan, column_id: DONE, priority: "low", ...oneDay(-1), completed_at: doneAt(-1, 11), spent_minutes: 30, category_id: cat("Операционная работа") }),
    t({ title: "Подготовить анонс новогоднего квеста", author_id: mgr, assignee_id: self, column_id: DONE, ...week(-1), completed_at: doneAt(-5), spent_minutes: 90, category_id: cat("Корпоратив") }),
    t({ title: "Найти площадку для выездного тимбилдинга", author_id: mgr, assignee_id: null, kind: "team", column_id: IN, ...month, deadline: day(14), category_id: cat("Тимбилдинг"), department_id: depId(2) }),
    t({ title: "Обновить регламент отпусков", author_id: mgr, assignee_id: null, kind: "team", column_id: TODO, priority: "low", ...month, category_id: cat("Другие задачи") }),
    t({ title: "Сделать макет рассылки к годовщинам", author_id: anna, assignee_id: oleg, kind: "team", column_id: REVIEW, deadline: day(0), ...week(), category_id: cat("Годовщины") }),
    t({ title: "Поздравить с днём рождения коллег из SMM", author_id: self, assignee_id: self, column_id: TODO, ...oneDay(1), deadline: day(1), category_id: cat("Дни рождения"), department_id: depId(1) }),
    t({ title: "Провести квиз для отдела", author_id: self, assignee_id: self, column_id: IN, ...week(1), category_id: cat("Активности"), department_id: depId(0) }),
  ];

  // Задача, назначенная всем
  const groupId = crypto.randomUUID();
  const everyone = [self, mgr, ivan, anna, oleg];
  everyone.forEach((uid, i) => {
    tasks.push(t({
      title: "Заполнить анкету обратной связи по году", description: "Короткая анкета, 10 минут. Ссылка в комментариях.",
      author_id: mgr, assignee_id: uid, group_id: groupId, column_id: i < 2 ? DONE : TODO, priority: "medium",
      deadline: day(3), ...week(), category_id: cat("Опросы"),
      ...(i < 2 ? { completed_at: doneAt(-1 - i, 16), spent_minutes: 15 } : {}),
    }));
  });

  const inserted = must(await db.from("tasks").insert(tasks).select("id, title, assignee_id, author_id"), "tasks") as
    { id: string; title: string; assignee_id: string | null; author_id: string }[];
  const byTitle = (s: string) => inserted.find((x) => x.title === s)!;

  const sub = (title: string, items: [string, boolean][]) =>
    items.map(([s, d], i) => ({ task_id: byTitle(title).id, title: s, done: d, position: (i + 1) * 1000 }));
  must(await db.from("subtasks").insert([
    ...sub("Собрать метрики по активностям за квартал", [["Marketing B2B", true], ["Inhouse SMM", true], ["Комьюнити", false]]),
    ...sub("Подготовить план адаптации для новичков", [["Чек-лист первого дня", true], ["Список встреч", false], ["Материалы", false]]),
    ...sub("Согласовать бюджет новогоднего корпоратива", [["Смета", true], ["Согласование с финансами", false]]),
  ]), "subtasks");

  must(await db.from("task_comments").insert([
    { task_id: byTitle("Собрать метрики по активностям за квартал").id, author_id: mgr, body: "Иван, по Marketing B2B нужно к среде, остальное можно позже." },
    { task_id: byTitle("Собрать метрики по активностям за квартал").id, author_id: ivan, body: "Ок, B2B уже готов, загружу в папку отчёта." },
    { task_id: byTitle("Написать выводы по опросу вовлечённости").id, author_id: mgr, body: "Посмотрю завтра утром." },
    { task_id: byTitle("Найти площадку для выездного тимбилдинга").id, author_id: anna, body: "Могу взять, есть пара вариантов в Подмосковье." },
  ]), "comments");

  return { links: created.map((c) => ({ name: c.name, role: c.role, token: c.token })) };
}

async function clearDemo(req: Request) {
  const me = await requireAdmin(req);
  must(await db.from("tasks").delete().eq("team_id", me.team_id).eq("is_demo", true), "delete demo tasks");
  must(await db.from("goals").delete().eq("team_id", me.team_id).eq("is_demo", true), "delete demo goals");
  const demo = must(await db.from("profiles").select("id").eq("team_id", me.team_id).eq("is_demo", true), "demo users") as { id: string }[];
  for (const u of demo) {
    await db.auth.admin.deleteUser(u.id);
  }
  return { removed: demo.length };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (body.action) {
      case "status": return json(await status());
      case "bootstrap": return json(await bootstrap(body));
      case "login": return json(await login(body));
      case "set_password": return json(await setPassword(body));
      case "mark_login": return json(await markLogin(req));
      case "create_member": return json(await createMember(req, body));
      case "reissue_link": return json(await reissueLink(req, body));
      case "revoke_link": return json(await revokeLink(req, body));
      case "set_role": return json(await setRole(req, body));
      case "remove_member": return json(await removeMember(req, body));
      case "set_private": return json(await setPrivate(req, body));
      case "seed_demo": return json(await seedDemo(req));
      case "clear_demo": return json(await clearDemo(req));
      default: return json({ error: "Неизвестное действие" }, 400);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
