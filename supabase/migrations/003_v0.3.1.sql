-- RELEVAMIENTO MANAGER / MEDTUC Inventario
-- Migración v0.3.0 -> v0.3.1
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- Corrige roles heredados, configura el SuperAdmin y limita el relevamiento a 3 ejecuciones SIN duplicar el inventario principal.

begin;

-- 1) Autorreparación del esquema de administradores para instalaciones que vienen de v0.1.x.
alter table public.admin_users add column if not exists role text not null default 'admin';
alter table public.admin_users add column if not exists display_name text;
alter table public.admin_users add column if not exists created_at timestamptz not null default now();


-- Autorreparación también para instalaciones donde la migración v0.2.0 se ejecutó parcialmente.
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
alter table public.admin_users enable row level security;
alter table public.inventories enable row level security;
alter table public.update_history enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.admin_users'::regclass and conname='admin_users_role_check'
  ) then
    alter table public.admin_users
      add constraint admin_users_role_check check (role in ('admin','superadmin'));
  end if;
end $$;

-- 2) Configurar al usuario solicitado como SuperAdmin.
insert into public.admin_users (user_id, role, display_name)
select id, 'superadmin', 'Ing. Fernando Gambino'
from auth.users
where lower(email)=lower('fernando.m.gambino@gmail.com')
on conflict (user_id) do update
set role='superadmin', display_name='Ing. Fernando Gambino';

-- 3) Control de reintentos. El inventario principal conserva UNA fila por equipo;
-- las ejecuciones 2 y 3 actualizan esa misma fila.
alter table public.inventories add column if not exists submission_count integer not null default 1;
alter table public.inventories add column if not exists last_submitted_at timestamptz not null default now();

update public.inventories
set submission_count=greatest(1,coalesce(submission_count,1)),
    last_submitted_at=coalesce(last_submitted_at,created_at);

-- Ya no se permite INSERT anónimo directo. El alta/actualización pasa por register_inventory().
drop policy if exists "public_insert_inventory" on public.inventories;
drop policy if exists "public_insert_inventory_mvp" on public.inventories;

-- Recrear función SuperAdmin de forma robusta.
create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.admin_users
    where user_id=auth.uid() and role='superadmin'
  );
$$;
revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;


drop policy if exists "admin_read_admin_users" on public.admin_users;
create policy "admin_read_admin_users" on public.admin_users
for select to authenticated using (auth.uid()=user_id);

drop policy if exists "admin_read_inventory" on public.inventories;
create policy "admin_read_inventory" on public.inventories
for select to authenticated using (exists(select 1 from public.admin_users a where a.user_id=auth.uid()));

drop policy if exists "superadmin_read_update_history" on public.update_history;
create policy "superadmin_read_update_history" on public.update_history
for select to authenticated using (public.is_superadmin());

-- 4) RPC público mínimo para consultar cuántas ejecuciones válidas tiene un equipo.
create or replace function public.inventory_submission_status(p_equipment_id uuid)
returns table(attempt_count integer, max_attempts integer, completed boolean, last_submitted_at timestamptz)
language sql
security definer
set search_path=public
as $$
  select
    coalesce((select i.submission_count from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc, i.created_at desc limit 1),0)::integer,
    3::integer,
    (coalesce((select i.submission_count from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc, i.created_at desc limit 1),0) >= 3),
    (select i.last_submitted_at from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc, i.created_at desc limit 1);
$$;
revoke all on function public.inventory_submission_status(uuid) from public;
grant execute on function public.inventory_submission_status(uuid) to anon,authenticated;

-- 5) Registro controlado: máximo 3 ejecuciones. Las repeticiones actualizan la misma fila.
create or replace function public.register_inventory(p_payload jsonb)
returns table(status text, attempt_count integer, max_attempts integer, inventory_id uuid)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_equipment_id uuid := nullif(p_payload->>'equipment_id','')::uuid;
  v_office_id uuid := nullif(p_payload->>'office_id','')::uuid;
  v_id uuid;
  v_count integer;
begin
  if v_equipment_id is null or v_office_id is null then
    raise exception 'office_id y equipment_id son obligatorios';
  end if;

  -- Bloqueo por catálogo de equipo para evitar carreras entre dos ejecuciones simultáneas.
  perform 1 from public.equipment_names where id=v_equipment_id for update;
  if not found then raise exception 'Equipo no válido'; end if;

  select i.id, coalesce(i.submission_count,1)
    into v_id, v_count
  from public.inventories i
  where i.equipment_id=v_equipment_id
  order by i.last_submitted_at desc nulls last, i.created_at desc
  limit 1
  for update;

  if v_id is not null and v_count >= 3 then
    return query select 'already_registered'::text, v_count, 3, v_id;
    return;
  end if;

  if v_id is null then
    insert into public.inventories(
      office_id,equipment_id,office_name,equipment_name,brand,model,processor,cores,operating_system,
      motherboard,ram_gb,ram_type,storage,graphics,hostname,full_device_name,domain_workgroup,system_type,
      device_uuid,product_id,windows_version,windows_build,windows_install_date,bios_serial,bios_version,
      collector_version,submission_count,last_submitted_at
    ) values (
      v_office_id,v_equipment_id,p_payload->>'office_name',p_payload->>'equipment_name',p_payload->>'brand',p_payload->>'model',p_payload->>'processor',nullif(p_payload->>'cores','')::integer,p_payload->>'operating_system',
      p_payload->>'motherboard',nullif(p_payload->>'ram_gb','')::integer,p_payload->>'ram_type',p_payload->>'storage',p_payload->>'graphics',p_payload->>'hostname',p_payload->>'full_device_name',p_payload->>'domain_workgroup',p_payload->>'system_type',
      p_payload->>'device_uuid',p_payload->>'product_id',p_payload->>'windows_version',p_payload->>'windows_build',p_payload->>'windows_install_date',p_payload->>'bios_serial',p_payload->>'bios_version',
      p_payload->>'collector_version',1,now()
    ) returning id,submission_count into v_id,v_count;
  else
    update public.inventories set
      office_id=v_office_id,
      office_name=p_payload->>'office_name', equipment_name=p_payload->>'equipment_name',
      brand=p_payload->>'brand', model=p_payload->>'model', processor=p_payload->>'processor', cores=nullif(p_payload->>'cores','')::integer,
      operating_system=p_payload->>'operating_system', motherboard=p_payload->>'motherboard', ram_gb=nullif(p_payload->>'ram_gb','')::integer,
      ram_type=p_payload->>'ram_type', storage=p_payload->>'storage', graphics=p_payload->>'graphics', hostname=p_payload->>'hostname',
      full_device_name=p_payload->>'full_device_name', domain_workgroup=p_payload->>'domain_workgroup', system_type=p_payload->>'system_type',
      device_uuid=p_payload->>'device_uuid', product_id=p_payload->>'product_id', windows_version=p_payload->>'windows_version', windows_build=p_payload->>'windows_build',
      windows_install_date=p_payload->>'windows_install_date', bios_serial=p_payload->>'bios_serial', bios_version=p_payload->>'bios_version',
      collector_version=p_payload->>'collector_version', submission_count=least(3,coalesce(submission_count,1)+1), last_submitted_at=now()
    where id=v_id
    returning submission_count into v_count;
  end if;

  return query select 'accepted'::text, v_count, 3, v_id;
end;
$$;
revoke all on function public.register_inventory(jsonb) from public;
grant execute on function public.register_inventory(jsonb) to anon,authenticated;

-- 6) Polling de confirmación compatible con actualizaciones sobre la misma fila.
drop function if exists public.check_recent_inventory(uuid,timestamptz);
create function public.check_recent_inventory(p_equipment_id uuid,p_since timestamptz)
returns table(id uuid,created_at timestamptz,equipment_name text,submission_count integer,last_submitted_at timestamptz)
language sql
security definer
set search_path=public
as $$
  select i.id,i.created_at,i.equipment_name,i.submission_count,i.last_submitted_at
  from public.inventories i
  where i.equipment_id=p_equipment_id and i.last_submitted_at>=p_since
  order by i.last_submitted_at desc
  limit 1;
$$;
revoke all on function public.check_recent_inventory(uuid,timestamptz) from public;
grant execute on function public.check_recent_inventory(uuid,timestamptz) to anon,authenticated;

commit;

-- Verificación recomendada:
-- select u.email, a.role, a.display_name
-- from auth.users u join public.admin_users a on a.user_id=u.id
-- where lower(u.email)=lower('fernando.m.gambino@gmail.com');
