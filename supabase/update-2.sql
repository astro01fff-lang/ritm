-- =====================================================================
--  Обновление 2: свои отделы у каждого, чужие задачи видит только руководитель
--  Как применить к уже созданной базе: SQL Editor → New query → вставить весь файл → Run.
--  Запускать можно повторно — ничего не сломается.
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
