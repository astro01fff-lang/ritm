-- =====================================================================
--  Таск-трекер команды — схема базы данных для Supabase
--  Как применить: Supabase → SQL Editor → New query → вставить весь файл → Run.
--  Скрипт можно запускать на пустом проекте один раз.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  Таблицы
-- ---------------------------------------------------------------------

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  team_id       uuid not null references public.teams(id) on delete cascade,
  role          text not null default 'member' check (role in ('admin','manager','member')),
  first_name    text not null default '' check (char_length(first_name) <= 80),
  last_name     text not null default '' check (char_length(last_name) <= 80),
  position      text not null default '' check (char_length(position) <= 120),
  city          text not null default '' check (char_length(city) <= 80),
  timezone      text not null default 'Europe/Moscow',
  avatar_color  text not null default '#F28BB5' check (avatar_color ~ '^#[0-9A-Fa-f]{6}$'),
  theme         text not null default 'dark' check (theme in ('dark','light')),
  notify_prefs  jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  private_tasks boolean not null default false,  -- личные задачи видит только сам человек
  is_demo       boolean not null default false,
  last_login_at timestamptz,
  removed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index profiles_team_idx on public.profiles(team_id);

-- Персональные ссылки входа. В базе хранится только хэш токена.
-- Пароль хранит Supabase Auth; password_set — задан ли пароль после выдачи этой ссылки.
create table public.access_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  token_hash   text not null unique,
  password_set boolean not null default false,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_used_at timestamptz
);
create index access_links_user_idx on public.access_links(user_id);

create table public.columns (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  position    double precision not null default 0,
  is_done     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index columns_team_idx on public.columns(team_id, position);

-- Отделы, с которыми работает команда (Marketing, SMM, ...)
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  color       text not null default '#8BC6F2' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, name)
);
create index departments_team_idx on public.departments(team_id, position);

-- Категории задач (адаптация, тимбилдинг, отчётность, ...)
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  color       text not null default '#F28BB5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, name)
);
create index categories_team_idx on public.categories(team_id, position);

create table public.goals (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  owner_id     uuid references public.profiles(id) on delete cascade, -- null = цель команды
  title        text not null check (char_length(title) between 1 and 200),
  description  text not null default '' check (char_length(description) <= 4000),
  period_start date not null,
  period_end   date not null,
  created_by   uuid references public.profiles(id) on delete set null,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (period_end >= period_start)
);
create index goals_team_idx on public.goals(team_id);
create index goals_owner_idx on public.goals(owner_id);

create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams(id) on delete cascade,
  column_id         uuid not null references public.columns(id) on delete restrict,
  group_id          uuid,  -- общий у копий задачи, назначенной нескольким людям
  goal_id           uuid references public.goals(id) on delete set null,
  department_id     uuid references public.departments(id) on delete set null,
  category_id       uuid references public.categories(id) on delete set null,
  kind              text not null default 'personal' check (kind in ('personal','team')),
  title             text not null check (char_length(title) between 1 and 300),
  description       text not null default '' check (char_length(description) <= 10000),
  author_id         uuid references public.profiles(id) on delete set null,
  assignee_id       uuid references public.profiles(id) on delete set null,
  period_type       text not null default 'week' check (period_type in ('day','week','month','quarter','custom','none')),
  period_start      date,
  period_end        date,
  deadline          date,
  priority          text not null default 'medium' check (priority in ('low','medium','high')),
  position          double precision not null default 0,
  spent_minutes     integer check (spent_minutes is null or spent_minutes between 0 and 100000),
  completed_at      timestamptz,
  notified_due_soon boolean not null default false,
  notified_overdue  boolean not null default false,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end >= period_start)
);
create index tasks_board_idx    on public.tasks(team_id, column_id, position);
create index tasks_assignee_idx on public.tasks(assignee_id);
create index tasks_author_idx   on public.tasks(author_id);
create index tasks_group_idx    on public.tasks(group_id) where group_id is not null;
create index tasks_goal_idx     on public.tasks(goal_id) where goal_id is not null;
create index tasks_deadline_idx on public.tasks(deadline) where completed_at is null;
create index tasks_completed_idx on public.tasks(team_id, completed_at);
create index tasks_department_idx on public.tasks(department_id) where department_id is not null;
create index tasks_category_idx on public.tasks(category_id) where category_id is not null;

create table public.subtasks (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 300),
  done        boolean not null default false,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index subtasks_task_idx on public.subtasks(task_id, position);

create table public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index comments_task_idx on public.task_comments(task_id, created_at);

create table public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) between 1 and 255),
  size_bytes   bigint not null default 0,
  mime_type    text not null default '',
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index attachments_task_idx on public.task_attachments(task_id);

create table public.task_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index history_task_idx on public.task_history(task_id, created_at);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in ('assigned','reassigned','comment','due_soon','overdue','completed','high_five','push')),
  title       text not null,
  body        text not null default '',
  task_id     uuid references public.tasks(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

-- Хай-файвы за выполненные задачи
create table public.high_fives (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  from_id     uuid not null references public.profiles(id) on delete cascade,
  to_id       uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (task_id, from_id),
  check (from_id <> to_id)
);
create index high_fives_task_idx on public.high_fives(task_id);
create index high_fives_to_idx on public.high_fives(to_id, created_at desc);

-- Дружеские напоминания коллегам по задаче
create table public.colleague_pushes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  from_id     uuid not null references public.profiles(id) on delete cascade,
  to_id       uuid not null references public.profiles(id) on delete cascade,
  message     text not null default '' check (char_length(message) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (from_id <> to_id)
);
create index pushes_task_idx on public.colleague_pushes(task_id, created_at desc);
create index pushes_to_idx on public.colleague_pushes(to_id, created_at desc);

-- Завершённые сессии таймера концентрации
create table public.focus_sessions (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  task_id     uuid references public.tasks(id) on delete set null,
  minutes     integer not null check (minutes between 1 and 480),
  mode        text not null default 'work' check (mode in ('work','break')),
  started_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index focus_user_idx on public.focus_sessions(user_id, started_at desc);

-- ---------------------------------------------------------------------
--  updated_at
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['teams','profiles','columns','departments','categories','goals','tasks','subtasks',
                           'task_comments','task_attachments','task_history','notifications',
                           'high_fives','colleague_pushes','focus_sessions']
  loop
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Вспомогательные функции для прав доступа
-- ---------------------------------------------------------------------

create or replace function public.current_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('admin','manager'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

-- Скрыты ли личные задачи человека от всех, кроме него самого
create or replace function public.is_private_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select private_tasks from public.profiles where id = p_user), false)
$$;

-- Может ли руководство видеть личное этого человека
create or replace function public.lead_can_see(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_lead() and (p_user is null or not public.is_private_user(p_user))
$$;

-- Видит ли текущий пользователь задачу
create or replace function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.team_id = public.current_team_id()
      and (t.kind = 'team' or t.assignee_id = auth.uid() or t.author_id = auth.uid() or public.lead_can_see(t.assignee_id))
  )
$$;

-- Может ли текущий пользователь редактировать задачу
create or replace function public.can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and t.team_id = public.current_team_id()
      and (public.lead_can_see(t.assignee_id) or t.assignee_id = auth.uid() or t.author_id = auth.uid()
           or (t.kind = 'team' and t.assignee_id is null))
  )
$$;

-- Путь вложения в хранилище: <task_id>/<имя файла>
create or replace function public.attachment_task_visible(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v text := split_part(p_name, '/', 1);
begin
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_see_task(v::uuid);
end $$;

create or replace function public.display_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(first_name || ' ' || last_name), '') from public.profiles where id = p_user
$$;

-- ---------------------------------------------------------------------
--  Уведомления
-- ---------------------------------------------------------------------

create or replace function public.notify(p_user uuid, p_type text, p_title text, p_body text,
                                         p_task uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare prefs jsonb;
begin
  if p_user is null then return; end if;
  if p_actor is not null and p_user = p_actor then return; end if;
  select notify_prefs into prefs from public.profiles where id = p_user and active;
  if not found then return; end if;
  if coalesce(prefs ->> p_type, 'true') = 'false' then return; end if;
  insert into public.notifications(user_id, type, title, body, task_id, actor_id)
  values (p_user, p_type, p_title, coalesce(p_body, ''), p_task, p_actor);
end $$;

-- ---------------------------------------------------------------------
--  Триггеры
-- ---------------------------------------------------------------------

-- Новая команда получает колонки по умолчанию
create or replace function public.teams_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.columns(team_id, name, position, is_done) values
    (new.id, 'Входящие',      1000, false),
    (new.id, 'К выполнению',  2000, false),
    (new.id, 'В работе',      3000, false),
    (new.id, 'На проверке',   4000, false),
    (new.id, 'Готово',        5000, true);
  insert into public.categories(team_id, name, color, position) values
    (new.id, 'Адаптация',                  '#8BC6F2',  1000),
    (new.id, 'Каналы коммуникации',        '#C49BF2',  2000),
    (new.id, 'Операционная работа',        '#A6A29F',  3000),
    (new.id, 'Коммуникация с сотрудниками','#8BF2DF',  4000),
    (new.id, 'Активности',                 '#B5F28B',  5000),
    (new.id, 'Тимбилдинг',                 '#F2C98B',  6000),
    (new.id, 'Корпоратив',                 '#F28BB5',  7000),
    (new.id, 'Дни рождения',               '#F29B8B',  8000),
    (new.id, 'Годовщины',                  '#E8E08B',  9000),
    (new.id, 'Опросы',                     '#9BB8F2', 10000),
    (new.id, 'Отчётность',                 '#D9A6F2', 11000),
    (new.id, 'Другие задачи',              '#8C8886', 12000);
  return new;
end $$;
create trigger teams_defaults after insert on public.teams
  for each row execute function public.teams_after_insert();

-- Пользователь сам не может поменять себе роль, команду и служебные поля
create or replace function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and auth.role() <> 'service_role' then
    if new.role is distinct from old.role
       or new.team_id is distinct from old.team_id
       or new.active is distinct from old.active
       or new.private_tasks is distinct from old.private_tasks
       or new.is_demo is distinct from old.is_demo
       or new.last_login_at is distinct from old.last_login_at
       or new.removed_at is distinct from old.removed_at then
      raise exception 'Эти поля меняет только администратор';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Проверки целостности задачи и автоматическая отметка выполнения
create or replace function public.tasks_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare col_done boolean;
begin
  select is_done into col_done from public.columns where id = new.column_id and team_id = new.team_id;
  if not found then
    raise exception 'Колонка не принадлежит команде';
  end if;
  if new.assignee_id is not null and not exists (
       select 1 from public.profiles where id = new.assignee_id and team_id = new.team_id) then
    raise exception 'Исполнитель не состоит в команде';
  end if;
  if new.goal_id is not null and not exists (
       select 1 from public.goals where id = new.goal_id and team_id = new.team_id) then
    raise exception 'Цель не принадлежит команде';
  end if;
  if new.department_id is not null and not exists (
       select 1 from public.departments where id = new.department_id and team_id = new.team_id) then
    raise exception 'Отдел не принадлежит команде';
  end if;
  if new.category_id is not null and not exists (
       select 1 from public.categories where id = new.category_id and team_id = new.team_id) then
    raise exception 'Категория не принадлежит команде';
  end if;

  if tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id then
      raise exception 'Нельзя перенести задачу в другую команду';
    end if;
    if new.author_id is distinct from old.author_id and auth.uid() is not null then
      new.author_id := old.author_id;
    end if;
    if new.deadline is distinct from old.deadline then
      new.notified_due_soon := false;
      new.notified_overdue := false;
    end if;
  end if;

  if col_done then
    new.completed_at := coalesce(
      case when auth.uid() is null then new.completed_at end,   -- сервер (демоданные) может задать дату
      case when tg_op = 'UPDATE' then old.completed_at end,
      now());
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create or replace function public.tasks_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.task_history(task_id, actor_id, action, details)
  values (new.id, coalesce(auth.uid(), new.author_id), 'created', jsonb_build_object('title', new.title));

  if new.assignee_id is not null then
    perform public.notify(new.assignee_id, 'assigned',
      'Вам назначена задача', new.title, new.id, coalesce(auth.uid(), new.author_id));
  end if;
  return new;
end $$;
create trigger tasks_after_insert after insert on public.tasks
  for each row execute function public.tasks_after_insert();

create or replace function public.tasks_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  changes jsonb := '{}'::jsonb;
begin
  if new.title is distinct from old.title then
    changes := changes || jsonb_build_object('title', jsonb_build_array(old.title, new.title));
  end if;
  if new.description is distinct from old.description then
    changes := changes || jsonb_build_object('description', true);
  end if;
  if new.column_id is distinct from old.column_id then
    changes := changes || jsonb_build_object('column', jsonb_build_array(
      (select name from public.columns where id = old.column_id),
      (select name from public.columns where id = new.column_id)));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    changes := changes || jsonb_build_object('assignee', jsonb_build_array(
      public.display_name(old.assignee_id), public.display_name(new.assignee_id)));
  end if;
  if new.deadline is distinct from old.deadline then
    changes := changes || jsonb_build_object('deadline', jsonb_build_array(old.deadline, new.deadline));
  end if;
  if new.priority is distinct from old.priority then
    changes := changes || jsonb_build_object('priority', jsonb_build_array(old.priority, new.priority));
  end if;
  if new.period_type is distinct from old.period_type
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end then
    changes := changes || jsonb_build_object('period', jsonb_build_array(
      jsonb_build_array(old.period_type, old.period_start, old.period_end),
      jsonb_build_array(new.period_type, new.period_start, new.period_end)));
  end if;
  if new.spent_minutes is distinct from old.spent_minutes then
    changes := changes || jsonb_build_object('spent', jsonb_build_array(old.spent_minutes, new.spent_minutes));
  end if;
  if new.kind is distinct from old.kind then
    changes := changes || jsonb_build_object('kind', jsonb_build_array(old.kind, new.kind));
  end if;
  if new.category_id is distinct from old.category_id then
    changes := changes || jsonb_build_object('category', jsonb_build_array(
      (select name from public.categories where id = old.category_id),
      (select name from public.categories where id = new.category_id)));
  end if;
  if new.department_id is distinct from old.department_id then
    changes := changes || jsonb_build_object('department', jsonb_build_array(
      (select name from public.departments where id = old.department_id),
      (select name from public.departments where id = new.department_id)));
  end if;
  if new.goal_id is distinct from old.goal_id then
    changes := changes || jsonb_build_object('goal', jsonb_build_array(
      (select title from public.goals where id = old.goal_id),
      (select title from public.goals where id = new.goal_id)));
  end if;

  if changes <> '{}'::jsonb then
    insert into public.task_history(task_id, actor_id, action, details)
    values (new.id, actor,
            case when new.completed_at is not null and old.completed_at is null then 'completed'
                 when new.completed_at is null and old.completed_at is not null then 'reopened'
                 else 'updated' end,
            changes);
  end if;

  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform public.notify(new.assignee_id, 'reassigned', 'Вы стали исполнителем задачи', new.title, new.id, actor);
  end if;

  if new.completed_at is not null and old.completed_at is null
     and new.author_id is not null and new.author_id is distinct from new.assignee_id then
    perform public.notify(new.author_id, 'completed',
      coalesce(public.display_name(new.assignee_id), 'Исполнитель') || ' выполнил(а) задачу',
      new.title, new.id, actor);
  end if;
  return new;
end $$;
create trigger tasks_after_update after update on public.tasks
  for each row execute function public.tasks_after_update();

create or replace function public.comments_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select id, title, author_id, assignee_id into t from public.tasks where id = new.task_id;
  perform public.notify(t.assignee_id, 'comment',
    'Новый комментарий от ' || coalesce(public.display_name(new.author_id), 'коллеги'), t.title, t.id, new.author_id);
  if t.author_id is distinct from t.assignee_id then
    perform public.notify(t.author_id, 'comment',
      'Новый комментарий от ' || coalesce(public.display_name(new.author_id), 'коллеги'), t.title, t.id, new.author_id);
  end if;
  return new;
end $$;
create trigger comments_after_insert after insert on public.task_comments
  for each row execute function public.comments_after_insert();

-- Хай-файв: только за выполненную задачу и только её исполнителю
create or replace function public.high_fives_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select id, team_id, assignee_id, completed_at into t from public.tasks where id = new.task_id;
  if not found or t.completed_at is null then raise exception 'Дать пять можно только за выполненную задачу'; end if;
  if t.assignee_id is null or t.assignee_id <> new.to_id then raise exception 'Хай-файв получает исполнитель задачи'; end if;
  new.team_id := t.team_id;
  return new;
end $$;
create trigger high_fives_before_insert before insert on public.high_fives
  for each row execute function public.high_fives_before_insert();

create or replace function public.high_fives_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.to_id, 'high_five',
    coalesce(public.display_name(new.from_id), 'Коллега') || ' даёт вам пять',
    (select title from public.tasks where id = new.task_id), new.task_id, new.from_id);
  return new;
end $$;
create trigger high_fives_after_insert after insert on public.high_fives
  for each row execute function public.high_fives_after_insert();

-- Пуш: по невыполненной задаче, её исполнителю, не чаще раза в 3 часа от одного человека
create or replace function public.pushes_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select id, team_id, assignee_id, completed_at into t from public.tasks where id = new.task_id;
  if not found or t.completed_at is not null then raise exception 'Напомнить можно только о невыполненной задаче'; end if;
  if t.assignee_id is null or t.assignee_id <> new.to_id then raise exception 'Напоминание получает исполнитель задачи'; end if;
  if exists (select 1 from public.colleague_pushes
             where task_id = new.task_id and from_id = new.from_id and created_at > now() - interval '3 hours') then
    raise exception 'Вы уже напоминали об этой задаче недавно. Попробуйте позже';
  end if;
  new.team_id := t.team_id;
  return new;
end $$;
create trigger pushes_before_insert before insert on public.colleague_pushes
  for each row execute function public.pushes_before_insert();

create or replace function public.pushes_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.to_id, 'push',
    coalesce(public.display_name(new.from_id), 'Коллега') || ' напоминает: '
      || coalesce((select title from public.tasks where id = new.task_id), 'задача'),
    coalesce(nullif(new.message, ''), 'Как продвигается?'), new.task_id, new.from_id);
  return new;
end $$;
create trigger pushes_after_insert after insert on public.colleague_pushes
  for each row execute function public.pushes_after_insert();

-- ---------------------------------------------------------------------
--  Функции, которые вызывает приложение
-- ---------------------------------------------------------------------

-- Уведомления о дедлайнах. p_user = null — для всех (для расписания).
create or replace function public._check_deadlines(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select t.id, t.title, t.assignee_id, t.deadline, t.notified_due_soon, t.notified_overdue
    from public.tasks t
    where t.completed_at is null and t.deadline is not null and t.assignee_id is not null
      and (p_user is null or t.assignee_id = p_user)
      and ((not t.notified_due_soon and t.deadline between current_date and current_date + 1)
           or (not t.notified_overdue and t.deadline < current_date))
  loop
    if r.deadline < current_date then
      perform public.notify(r.assignee_id, 'overdue', 'Задача просрочена', r.title, r.id, null);
      update public.tasks set notified_overdue = true, notified_due_soon = true where id = r.id;
    else
      perform public.notify(r.assignee_id, 'due_soon',
        case when r.deadline = current_date then 'Дедлайн сегодня' else 'Дедлайн завтра' end,
        r.title, r.id, null);
      update public.tasks set notified_due_soon = true where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.check_my_deadlines() returns integer
language sql security definer set search_path = public as $$
  select case when auth.uid() is null then 0 else public._check_deadlines(auth.uid()) end
$$;

-- Прогресс целей считается по всем привязанным задачам, даже тем, которых пользователь не видит
create or replace function public.goal_progress()
returns table(goal_id uuid, total integer, done integer)
language sql stable security definer set search_path = public as $$
  select g.id,
         count(t.id)::int,
         count(t.id) filter (where t.completed_at is not null)::int
  from public.goals g
  left join public.tasks t on t.goal_id = g.id
  where g.team_id = public.current_team_id()
    and (g.owner_id is null or g.owner_id = auth.uid() or public.lead_can_see(g.owner_id))
  group by g.id
$$;

-- Завершить все сессии пользователя (при отзыве ссылки). Только для сервера.
create or replace function public.revoke_user_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.sessions where user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------

alter table public.teams            enable row level security;
alter table public.profiles         enable row level security;
alter table public.access_links     enable row level security;
alter table public.columns          enable row level security;
alter table public.departments      enable row level security;
alter table public.categories       enable row level security;
alter table public.goals            enable row level security;
alter table public.tasks            enable row level security;
alter table public.subtasks         enable row level security;
alter table public.task_comments    enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_history     enable row level security;
alter table public.notifications    enable row level security;
alter table public.high_fives       enable row level security;
alter table public.colleague_pushes enable row level security;
alter table public.focus_sessions   enable row level security;

-- teams
create policy teams_select on public.teams for select to authenticated
  using (id = public.current_team_id());
create policy teams_update on public.teams for update to authenticated
  using (id = public.current_team_id() and public.is_admin())
  with check (id = public.current_team_id());

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (team_id = public.current_team_id());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and active)
  with check (id = auth.uid());

-- access_links: политик нет — доступ только у сервера

-- columns
create policy columns_select on public.columns for select to authenticated
  using (team_id = public.current_team_id());
create policy columns_insert on public.columns for insert to authenticated
  with check (team_id = public.current_team_id() and public.is_lead());
create policy columns_update on public.columns for update to authenticated
  using (team_id = public.current_team_id() and public.is_lead())
  with check (team_id = public.current_team_id());
create policy columns_delete on public.columns for delete to authenticated
  using (team_id = public.current_team_id() and public.is_lead());

-- departments и categories: видят все в команде, меняют руководитель и администратор
do $$
declare t text;
begin
  foreach t in array array['departments','categories'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated
                    using (team_id = public.current_team_id())', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated
                    with check (team_id = public.current_team_id() and public.is_lead())', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated
                    using (team_id = public.current_team_id() and public.is_lead())
                    with check (team_id = public.current_team_id())', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated
                    using (team_id = public.current_team_id() and public.is_lead())', t);
  end loop;
end $$;

-- goals
create policy goals_select on public.goals for select to authenticated
  using (team_id = public.current_team_id()
         and (owner_id is null or owner_id = auth.uid() or public.lead_can_see(owner_id)));
create policy goals_insert on public.goals for insert to authenticated
  with check (team_id = public.current_team_id() and created_by = auth.uid()
              and (public.is_lead() or owner_id = auth.uid()));
create policy goals_update on public.goals for update to authenticated
  using (team_id = public.current_team_id() and (owner_id = auth.uid() or (public.lead_can_see(owner_id))))
  with check (team_id = public.current_team_id() and (owner_id = auth.uid() or (public.lead_can_see(owner_id))));
create policy goals_delete on public.goals for delete to authenticated
  using (team_id = public.current_team_id() and (owner_id = auth.uid() or (public.lead_can_see(owner_id))));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (team_id = public.current_team_id()
         and (kind = 'team' or assignee_id = auth.uid() or author_id = auth.uid() or public.lead_can_see(assignee_id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (team_id = public.current_team_id() and author_id = auth.uid()
              and (public.is_lead() or assignee_id = auth.uid() or (assignee_id is null and kind = 'team')));
create policy tasks_update on public.tasks for update to authenticated
  using (team_id = public.current_team_id()
         and (public.lead_can_see(assignee_id) or assignee_id = auth.uid() or author_id = auth.uid()
              or (kind = 'team' and assignee_id is null)))
  with check (team_id = public.current_team_id()
              and (public.is_lead() or assignee_id = auth.uid() or author_id = auth.uid()
                   or (kind = 'team' and assignee_id is null)));
create policy tasks_delete on public.tasks for delete to authenticated
  using (team_id = public.current_team_id() and (public.lead_can_see(assignee_id) or author_id = auth.uid()));

-- subtasks
create policy subtasks_select on public.subtasks for select to authenticated
  using (public.can_see_task(task_id));
create policy subtasks_insert on public.subtasks for insert to authenticated
  with check (public.can_edit_task(task_id));
create policy subtasks_update on public.subtasks for update to authenticated
  using (public.can_edit_task(task_id)) with check (public.can_edit_task(task_id));
create policy subtasks_delete on public.subtasks for delete to authenticated
  using (public.can_edit_task(task_id));

-- comments
create policy comments_select on public.task_comments for select to authenticated
  using (public.can_see_task(task_id));
create policy comments_insert on public.task_comments for insert to authenticated
  with check (public.can_see_task(task_id) and author_id = auth.uid());
create policy comments_update on public.task_comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.task_comments for delete to authenticated
  using (author_id = auth.uid() or (public.is_lead() and public.can_see_task(task_id)));

-- attachments
create policy attachments_select on public.task_attachments for select to authenticated
  using (public.can_see_task(task_id));
create policy attachments_insert on public.task_attachments for insert to authenticated
  with check (public.can_see_task(task_id) and uploaded_by = auth.uid()
              and split_part(storage_path, '/', 1) = task_id::text);
create policy attachments_delete on public.task_attachments for delete to authenticated
  using (public.can_see_task(task_id) and (uploaded_by = auth.uid() or public.is_lead()));

-- history: только чтение, пишут триггеры
create policy history_select on public.task_history for select to authenticated
  using (public.can_see_task(task_id));

-- notifications
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- high_fives: видят все, кто видит задачу; ставит сам за себя
create policy high_fives_select on public.high_fives for select to authenticated
  using (public.can_see_task(task_id));
create policy high_fives_insert on public.high_fives for insert to authenticated
  with check (from_id = auth.uid() and public.can_see_task(task_id));
create policy high_fives_delete on public.high_fives for delete to authenticated
  using (from_id = auth.uid());

-- colleague_pushes: видят отправитель, получатель и руководство
create policy pushes_select on public.colleague_pushes for select to authenticated
  using (team_id = public.current_team_id() and (from_id = auth.uid() or to_id = auth.uid() or (public.is_lead() and public.can_see_task(task_id))));
create policy pushes_insert on public.colleague_pushes for insert to authenticated
  with check (from_id = auth.uid() and public.can_see_task(task_id));

-- focus_sessions: только свои
create policy focus_select on public.focus_sessions for select to authenticated
  using (user_id = auth.uid());
create policy focus_insert on public.focus_sessions for insert to authenticated
  with check (user_id = auth.uid() and team_id = public.current_team_id());
create policy focus_delete on public.focus_sessions for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
--  Права на таблицы и функции
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.teams, public.profiles, public.columns, public.departments, public.categories,
  public.goals, public.tasks, public.subtasks,
  public.task_comments, public.task_attachments, public.task_history, public.notifications,
  public.high_fives, public.colleague_pushes, public.focus_sessions
  to authenticated;
revoke all on public.access_links from authenticated;
grant all on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.current_team_id(), public.current_role_name(), public.is_lead(), public.is_admin(),
  public.can_see_task(uuid), public.can_edit_task(uuid), public.attachment_task_visible(text),
  public.is_private_user(uuid), public.lead_can_see(uuid),
  public.display_name(uuid), public.check_my_deadlines(), public.goal_progress()
  to authenticated;
revoke execute on function public.revoke_user_sessions(uuid), public._check_deadlines(uuid),
  public.notify(uuid, text, text, text, uuid, uuid) from authenticated;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------
--  Хранилище вложений
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20971520)
on conflict (id) do nothing;

create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.attachment_task_visible(name));
create policy attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.attachment_task_visible(name));
create policy attachments_remove on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.attachment_task_visible(name)
         and (public.is_lead() or exists (
               select 1 from public.task_attachments a
               where a.storage_path = name and a.uploaded_by = auth.uid())));

-- ---------------------------------------------------------------------
--  Обновления в реальном времени
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['tasks','columns','departments','categories','subtasks','task_comments','task_attachments','goals','notifications','profiles','high_fives']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
--  Ежечасная проверка дедлайнов (если в проекте доступен pg_cron)
-- ---------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('tracker-deadlines', '7 * * * *', 'select public._check_deadlines(null)');
exception when others then
  raise notice 'pg_cron недоступен — дедлайны будут проверяться при входе пользователей';
end $$;

-- =====================================================================
--  Обновление 2: свои отделы у каждого, чужие задачи видит только руководитель
--  (Входит в этот файл; для базы, созданной раньше, есть отдельный update-2.sql.)
-- =====================================================================

-- ---------------------------------------------------------------------
--  Роли
--  Администратор (admin) — управляет командой, но видит только свои и командные задачи.
--  Руководитель (manager) — те же права управления плюс видит задачи всех.
-- ---------------------------------------------------------------------

create or replace function public.is_head() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = 'manager', false)
$$;

-- Управление командой: администратор и руководитель
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('admin','manager'), false)
$$;

-- Видеть личное другого человека может только руководитель (и не тех, кто скрыл задачи)
create or replace function public.lead_can_see(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_head() and (p_user is null or not public.is_private_user(p_user))
$$;

grant execute on function public.is_head(), public.is_admin(), public.lead_can_see(uuid) to authenticated;

-- ---------------------------------------------------------------------
--  Задачи: командные может ставить любой и кому угодно
-- ---------------------------------------------------------------------

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (team_id = public.current_team_id() and author_id = auth.uid()
              and (public.is_lead() or assignee_id = auth.uid() or kind = 'team'));

-- ---------------------------------------------------------------------
--  Цели: общие цели меняют администратор и руководитель
-- ---------------------------------------------------------------------

drop policy if exists goals_update on public.goals;
drop policy if exists goals_delete on public.goals;
create policy goals_update on public.goals for update to authenticated
  using (team_id = public.current_team_id()
         and (owner_id = auth.uid() or (owner_id is null and public.is_lead()) or public.lead_can_see(owner_id)))
  with check (team_id = public.current_team_id()
         and (owner_id = auth.uid() or (owner_id is null and public.is_lead()) or public.lead_can_see(owner_id)));
create policy goals_delete on public.goals for delete to authenticated
  using (team_id = public.current_team_id()
         and (owner_id = auth.uid() or (owner_id is null and public.is_lead()) or public.lead_can_see(owner_id)));

-- ---------------------------------------------------------------------
--  Отделы: у каждого свои
-- ---------------------------------------------------------------------

alter table public.departments add column if not exists owner_id uuid references public.profiles(id) on delete cascade;

-- уже созданные отделы отдаём первому администратору команды
update public.departments d
   set owner_id = (select p.id from public.profiles p
                   where p.team_id = d.team_id and p.role in ('admin','manager') and p.removed_at is null
                   order by (p.role = 'admin') desc, p.created_at limit 1)
 where d.owner_id is null;
delete from public.departments where owner_id is null;

alter table public.departments alter column owner_id set not null;
alter table public.departments alter column owner_id set default auth.uid();
alter table public.departments drop constraint if exists departments_team_id_name_key;
do $$ begin
  alter table public.departments add constraint departments_owner_name_key unique (owner_id, name);
exception when duplicate_table or duplicate_object then null;
end $$;
create index if not exists departments_owner_idx on public.departments(owner_id, position);

drop policy if exists departments_select on public.departments;
drop policy if exists departments_insert on public.departments;
drop policy if exists departments_update on public.departments;
drop policy if exists departments_delete on public.departments;
create policy departments_select on public.departments for select to authenticated
  using (team_id = public.current_team_id() and (owner_id = auth.uid() or public.lead_can_see(owner_id)));
create policy departments_insert on public.departments for insert to authenticated
  with check (team_id = public.current_team_id() and owner_id = auth.uid());
create policy departments_update on public.departments for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and team_id = public.current_team_id());
create policy departments_delete on public.departments for delete to authenticated
  using (owner_id = auth.uid());

-- =====================================================================
--  Обновление 3: архив выполненных задач
--  (Входит в этот файл; для базы, созданной раньше, есть отдельный update-3.sql.)
-- =====================================================================

alter table public.tasks add column if not exists archived_at timestamptz;
create index if not exists tasks_archived_idx on public.tasks(team_id, archived_at);

-- Задача, которую вернули в работу, сама выходит из архива
create or replace function public.tasks_unarchive_reopened() returns trigger
language plpgsql as $$
begin
  if new.completed_at is null then new.archived_at := null; end if;
  return new;
end $$;
drop trigger if exists tasks_unarchive_reopened on public.tasks;
-- имя начинается с «u», поэтому срабатывает после tasks_before_write (триггеры идут по алфавиту)
create trigger tasks_unarchive_reopened before insert or update on public.tasks
  for each row execute function public.tasks_unarchive_reopened();

-- Автоархив: выполненные больше 7 дней назад задачи команды уходят в архив
create or replace function public.auto_archive_done(p_team uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.tasks
     set archived_at = now()
   where archived_at is null
     and completed_at is not null
     and completed_at < now() - interval '7 days'
     and (p_team is null or team_id = p_team);
  get diagnostics n = row_count;
  return n;
end $$;

-- Вызов из приложения: только для своей команды
create or replace function public.auto_archive_my_team() returns integer
language sql security definer set search_path = public as $$
  select case when public.current_team_id() is null then 0 else public.auto_archive_done(public.current_team_id()) end
$$;

revoke execute on function public.auto_archive_done(uuid) from public, anon, authenticated;
grant execute on function public.auto_archive_my_team() to authenticated;
grant execute on function public.tasks_unarchive_reopened() to authenticated;

-- Раз в час, если в проекте доступен pg_cron
do $$
begin
  perform cron.schedule('tracker-auto-archive', '17 * * * *', 'select public.auto_archive_done(null)');
exception when others then
  raise notice 'pg_cron недоступен — архив обновляется, когда кто-то открывает трекер';
end $$;
