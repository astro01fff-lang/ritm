-- =====================================================================
--  Обновление 4: время по подзадачам, которое суммируется в задаче
--  Как применить к уже созданной базе: SQL Editor → New → вставить весь файл → Run.
--  Запускать можно повторно — ничего не сломается.
-- =====================================================================

alter table public.subtasks add column if not exists spent_minutes integer not null default 0;
do $$ begin
  alter table public.subtasks add constraint subtasks_spent_check check (spent_minutes between 0 and 100000);
exception when duplicate_object then null;
end $$;

-- Время подзадачи прибавляется к общему времени задачи (и вычитается, если его уменьшили)
create or replace function public.subtasks_spent_to_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  delta integer;
  tid uuid;
begin
  if tg_op = 'INSERT' then
    delta := new.spent_minutes; tid := new.task_id;
  elsif tg_op = 'UPDATE' then
    delta := new.spent_minutes - old.spent_minutes; tid := new.task_id;
  else
    delta := -old.spent_minutes; tid := old.task_id;
  end if;
  if coalesce(delta, 0) <> 0 then
    update public.tasks
       set spent_minutes = nullif(greatest(coalesce(spent_minutes, 0) + delta, 0), 0)
     where id = tid;
  end if;
  return null;
end $$;

drop trigger if exists subtasks_spent_to_task on public.subtasks;
create trigger subtasks_spent_to_task after insert or update of spent_minutes or delete on public.subtasks
  for each row execute function public.subtasks_spent_to_task();
