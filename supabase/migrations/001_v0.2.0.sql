-- MEDTUC Inventario - Migración v0.1.0 -> v0.2.0
-- Ejecutar UNA VEZ desde Supabase > SQL Editor antes de publicar el frontend v0.2.0.

begin;

alter table public.admin_users add column if not exists role text not null default 'admin';
alter table public.admin_users add column if not exists display_name text;
do $$ begin
  alter table public.admin_users add constraint admin_users_role_check check (role in ('admin','superadmin'));
exception when duplicate_object then null; end $$;

alter table public.inventories add column if not exists model text;
alter table public.inventories add column if not exists full_device_name text;
alter table public.inventories add column if not exists domain_workgroup text;
alter table public.inventories add column if not exists system_type text;
alter table public.inventories add column if not exists device_uuid text;
alter table public.inventories add column if not exists product_id text;
alter table public.inventories add column if not exists windows_version text;
alter table public.inventories add column if not exists windows_build text;
alter table public.inventories add column if not exists windows_install_date text;
alter table public.inventories add column if not exists bios_serial text;
alter table public.inventories add column if not exists bios_version text;

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
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users where user_id = auth.uid() and role = 'superadmin');
$$;
revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;

drop policy if exists "superadmin_read_update_history" on public.update_history;
create policy "superadmin_read_update_history" on public.update_history
for select to authenticated using (public.is_superadmin());

-- Reemplaza la lectura anónima completa del inventario de v0.1.0 por un RPC mínimo
-- que solo devuelve la confirmación necesaria para el equipo que acaba de registrarse.
drop policy if exists "public_read_inventory_mvp" on public.inventories;

create or replace function public.check_recent_inventory(p_equipment_id uuid, p_since timestamptz)
returns table(id uuid, created_at timestamptz, equipment_name text)
language sql
security definer
set search_path = public
as $$
  select i.id, i.created_at, i.equipment_name
  from public.inventories i
  where i.equipment_id = p_equipment_id
    and i.created_at >= p_since
  order by i.created_at desc
  limit 1;
$$;
revoke all on function public.check_recent_inventory(uuid,timestamptz) from public;
grant execute on function public.check_recent_inventory(uuid,timestamptz) to anon, authenticated;

commit;

-- IMPORTANTE: convertir TU usuario en SuperAdmin reemplazando el email:
-- update public.admin_users au
-- set role='superadmin', display_name='Fernando Gambino'
-- from auth.users u
-- where au.user_id=u.id and lower(u.email)=lower('TU_EMAIL');
