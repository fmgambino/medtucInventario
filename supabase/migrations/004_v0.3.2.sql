-- RELEVAMIENTO MANAGER v0.3.2
-- Reparación RPC + actualización manual de patches
begin;

alter table public.inventories add column if not exists submission_count integer not null default 1;
alter table public.inventories add column if not exists last_submitted_at timestamptz not null default now();

create or replace function public.inventory_submission_status(p_equipment_id uuid)
returns table(attempt_count integer,max_attempts integer,completed boolean,last_submitted_at timestamptz)
language sql security definer set search_path=public
as $$
  select
    coalesce((select i.submission_count from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc nulls last,i.created_at desc limit 1),0)::integer,
    3::integer,
    (coalesce((select i.submission_count from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc nulls last,i.created_at desc limit 1),0)>=3),
    (select i.last_submitted_at from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc nulls last,i.created_at desc limit 1);
$$;
revoke all on function public.inventory_submission_status(uuid) from public;
grant execute on function public.inventory_submission_status(uuid) to anon,authenticated;

-- Repara historial faltante visto como 404 en instalaciones parciales.
create table if not exists public.update_history (
  id uuid primary key default gen_random_uuid(),
  from_version text not null,
  to_version text not null,
  status text not null default 'success',
  applied_by uuid references auth.users(id) on delete set null,
  applied_by_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.update_history enable row level security;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.admin_users where user_id=auth.uid() and role='superadmin'); $$;
revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;

drop policy if exists "superadmin_read_update_history" on public.update_history;
create policy "superadmin_read_update_history" on public.update_history for select to authenticated using(public.is_superadmin());

commit;

notify pgrst, 'reload schema';
