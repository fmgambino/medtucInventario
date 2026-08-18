-- RELEVAMIENTO MANAGER / MEDTUC Inventario v0.3.1 - instalación limpia
create extension if not exists pgcrypto;

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  created_at timestamptz not null default now()
);
create table if not exists public.equipment_names (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique(office_id,name)
);
create table if not exists public.inventories (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id), equipment_id uuid references public.equipment_names(id),
  office_name text not null, equipment_name text not null,
  brand text, model text, processor text, cores integer, operating_system text,
  motherboard text, ram_gb integer, ram_type text, storage text, graphics text,
  hostname text, full_device_name text, domain_workgroup text, system_type text,
  device_uuid text, product_id text, windows_version text, windows_build text,
  windows_install_date text, bios_serial text, bios_version text,
  collector_version text, submission_count integer not null default 1, last_submitted_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin','superadmin')),
  display_name text,
  created_at timestamptz not null default now()
);
create table if not exists public.update_history (
  id uuid primary key default gen_random_uuid(), from_version text not null, to_version text not null,
  status text not null default 'success', applied_by uuid references auth.users(id) on delete set null,
  applied_by_email text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

alter table public.offices enable row level security;
alter table public.equipment_names enable row level security;
alter table public.inventories enable row level security;
alter table public.admin_users enable row level security;
alter table public.update_history enable row level security;

drop policy if exists "public_read_offices" on public.offices;
create policy "public_read_offices" on public.offices for select to anon,authenticated using (true);
drop policy if exists "public_insert_offices" on public.offices;
create policy "public_insert_offices" on public.offices for insert to anon,authenticated with check (true);
drop policy if exists "public_read_equipment" on public.equipment_names;
create policy "public_read_equipment" on public.equipment_names for select to anon,authenticated using (true);
drop policy if exists "public_insert_equipment" on public.equipment_names;
create policy "public_insert_equipment" on public.equipment_names for insert to anon,authenticated with check (true);
drop policy if exists "public_insert_inventory" on public.inventories;
-- Las altas públicas se realizan exclusivamente mediante register_inventory(), con máximo 3 ejecuciones por equipo.
drop policy if exists "admin_read_admin_users" on public.admin_users;
create policy "admin_read_admin_users" on public.admin_users for select to authenticated using (auth.uid()=user_id);
drop policy if exists "admin_read_inventory" on public.inventories;
create policy "admin_read_inventory" on public.inventories for select to authenticated using (exists(select 1 from public.admin_users a where a.user_id=auth.uid()));

create or replace function public.is_superadmin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.admin_users where user_id=auth.uid() and role='superadmin');
$$;
revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;
drop policy if exists "superadmin_read_update_history" on public.update_history;
create policy "superadmin_read_update_history" on public.update_history for select to authenticated using (public.is_superadmin());

create or replace function public.inventory_submission_status(p_equipment_id uuid)
returns table(attempt_count integer,max_attempts integer,completed boolean,last_submitted_at timestamptz)
language sql security definer set search_path=public as $$
  select coalesce((select i.submission_count from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc limit 1),0)::integer,3::integer,
         (coalesce((select i.submission_count from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc limit 1),0)>=3),
         (select i.last_submitted_at from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc limit 1);
$$;
revoke all on function public.inventory_submission_status(uuid) from public;
grant execute on function public.inventory_submission_status(uuid) to anon,authenticated;

-- register_inventory(jsonb) se define en migrations/003_v0.3.1.sql y es el único punto público de alta/actualización.
-- Ejecutar esa migración también en instalaciones limpias después de schema.sql.

-- No existen policies UPDATE/DELETE para oficinas, equipos ni inventarios.
-- No existen policies INSERT/UPDATE/DELETE de admin_users para clientes: las altas las realiza medtuc-admins tras validar SuperAdmin.
