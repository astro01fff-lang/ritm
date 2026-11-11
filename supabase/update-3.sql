-- =====================================================================
--  Обновление 3: архив выполненных задач
--  Как применить к уже созданной базе: SQL Editor → New → вставить весь файл → Run.
--  Запускать можно повторно — ничего не сломается.
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
