-- ============================================================
-- RELEVAMIENTO MANAGER v0.3.3
-- Migración integral de reparación y compatibilidad
-- Ejecutar en Supabase > SQL Editor ANTES de usar el frontend v0.3.3
-- ============================================================

begin;

-- 1) Completar columnas de inventario que usa el recopilador y el panel.
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
alter table public.inventories add column if not exists windows_license_status text;
alter table public.inventories add column if not exists windows_license_channel text;
alter table public.inventories add column if not exists windows_partial_product_key text;
alter table public.inventories add column if not exists windows_oem_key text;
alter table public.inventories add column if not exists submission_count integer not null default 1;
alter table public.inventories add column if not exists last_submitted_at timestamptz not null default now();

-- 2) Asegurar estructura de administradores.
alter table public.admin_users add column if not exists role text not null default 'admin';
alter table public.admin_users add column if not exists display_name text;

-- Fernando Gambino = SuperAdmin.
insert into public.admin_users(user_id,role,display_name)
select id,'superadmin','Ing. Fernando Gambino'
from auth.users
where lower(email)=lower('fernando.m.gambino@gmail.com')
on conflict(user_id) do update
set role='superadmin', display_name='Ing. Fernando Gambino';

-- 3) Función central para validar SuperAdmin.
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

-- 4) RLS de inventario: administradores autenticados pueden consultar/editar/eliminar.
alter table public.inventories enable row level security;
drop policy if exists "admin_read_inventory" on public.inventories;
create policy "admin_read_inventory" on public.inventories
for select to authenticated
using (exists(select 1 from public.admin_users a where a.user_id=auth.uid()));

drop policy if exists "admin_update_inventory" on public.inventories;
create policy "admin_update_inventory" on public.inventories
for update to authenticated
using (exists(select 1 from public.admin_users a where a.user_id=auth.uid()))
with check (exists(select 1 from public.admin_users a where a.user_id=auth.uid()));

drop policy if exists "admin_delete_inventory" on public.inventories;
create policy "admin_delete_inventory" on public.inventories
for delete to authenticated
using (exists(select 1 from public.admin_users a where a.user_id=auth.uid()));

-- 5) Catálogos: lectura y alta pública para el flujo de relevamiento.
alter table public.offices enable row level security;
alter table public.equipment_names enable row level security;
drop policy if exists "public_read_offices" on public.offices;
create policy "public_read_offices" on public.offices for select to anon,authenticated using(true);
drop policy if exists "public_insert_offices" on public.offices;
create policy "public_insert_offices" on public.offices for insert to anon,authenticated with check(true);
drop policy if exists "public_read_equipment_names" on public.equipment_names;
create policy "public_read_equipment_names" on public.equipment_names for select to anon,authenticated using(true);
drop policy if exists "public_insert_equipment_names" on public.equipment_names;
create policy "public_insert_equipment_names" on public.equipment_names for insert to anon,authenticated with check(true);

-- 6) Estado previo del equipo (máximo 3 ejecuciones).
create or replace function public.inventory_submission_status(p_equipment_id uuid)
returns table(attempt_count integer,max_attempts integer,completed boolean,last_submitted_at timestamptz)
language sql
security definer
set search_path=public
as $$
  select
    coalesce((select i.submission_count from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc nulls last,i.created_at desc limit 1),0)::integer,
    3::integer,
    (coalesce((select i.submission_count from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc nulls last,i.created_at desc limit 1),0)>=3),
    (select i.last_submitted_at from public.inventories i where i.equipment_id=p_equipment_id order by i.last_submitted_at desc nulls last,i.created_at desc limit 1);
$$;
revoke all on function public.inventory_submission_status(uuid) from public;
grant execute on function public.inventory_submission_status(uuid) to anon,authenticated;

-- 7) Confirmación de registro para polling de la PWA.
create or replace function public.check_recent_inventory(p_equipment_id uuid,p_since timestamptz)
returns table(id uuid,created_at timestamptz,equipment_name text,submission_count integer,last_submitted_at timestamptz)
language sql
security definer
set search_path=public
as $$
  select i.id,i.created_at,i.equipment_name,i.submission_count,i.last_submitted_at
  from public.inventories i
  where i.equipment_id=p_equipment_id
    and coalesce(i.last_submitted_at,i.created_at)>=p_since
  order by coalesce(i.last_submitted_at,i.created_at) desc
  limit 1;
$$;
revoke all on function public.check_recent_inventory(uuid,timestamptz) from public;
grant execute on function public.check_recent_inventory(uuid,timestamptz) to anon,authenticated;

-- 8) Registro/actualización del inventario. No genera duplicados: actualiza el mismo equipo hasta 3 veces.
create or replace function public.register_inventory(p_payload jsonb)
returns table(status text,attempt_count integer,max_attempts integer,inventory_id uuid)
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

  if not exists(select 1 from public.equipment_names e where e.id=v_equipment_id and e.office_id=v_office_id) then
    raise exception 'Equipo/oficina no válidos';
  end if;

  select i.id,coalesce(i.submission_count,1)
  into v_id,v_count
  from public.inventories i
  where i.equipment_id=v_equipment_id
  order by i.last_submitted_at desc nulls last,i.created_at desc
  limit 1
  for update;

  if v_id is not null and v_count>=3 then
    return query select 'already_registered'::text,v_count,3,v_id;
    return;
  end if;

  if v_id is null then
    insert into public.inventories(
      office_id,equipment_id,office_name,equipment_name,brand,model,processor,cores,operating_system,
      motherboard,ram_gb,ram_type,storage,graphics,hostname,full_device_name,domain_workgroup,system_type,
      device_uuid,product_id,windows_version,windows_build,windows_install_date,bios_serial,bios_version,
      windows_license_status,windows_license_channel,windows_partial_product_key,windows_oem_key,
      collector_version,submission_count,last_submitted_at
    ) values (
      v_office_id,v_equipment_id,p_payload->>'office_name',p_payload->>'equipment_name',p_payload->>'brand',p_payload->>'model',p_payload->>'processor',nullif(p_payload->>'cores','')::integer,p_payload->>'operating_system',
      p_payload->>'motherboard',nullif(p_payload->>'ram_gb','')::integer,p_payload->>'ram_type',p_payload->>'storage',p_payload->>'graphics',p_payload->>'hostname',p_payload->>'full_device_name',p_payload->>'domain_workgroup',p_payload->>'system_type',
      p_payload->>'device_uuid',p_payload->>'product_id',p_payload->>'windows_version',p_payload->>'windows_build',p_payload->>'windows_install_date',p_payload->>'bios_serial',p_payload->>'bios_version',
      p_payload->>'windows_license_status',p_payload->>'windows_license_channel',p_payload->>'windows_partial_product_key',p_payload->>'windows_oem_key',
      p_payload->>'collector_version',1,now()
    ) returning id,submission_count into v_id,v_count;
  else
    update public.inventories set
      office_id=v_office_id,
      office_name=p_payload->>'office_name',
      equipment_name=p_payload->>'equipment_name',
      brand=p_payload->>'brand',model=p_payload->>'model',processor=p_payload->>'processor',
      cores=nullif(p_payload->>'cores','')::integer,operating_system=p_payload->>'operating_system',
      motherboard=p_payload->>'motherboard',ram_gb=nullif(p_payload->>'ram_gb','')::integer,ram_type=p_payload->>'ram_type',
      storage=p_payload->>'storage',graphics=p_payload->>'graphics',hostname=p_payload->>'hostname',full_device_name=p_payload->>'full_device_name',
      domain_workgroup=p_payload->>'domain_workgroup',system_type=p_payload->>'system_type',device_uuid=p_payload->>'device_uuid',product_id=p_payload->>'product_id',
      windows_version=p_payload->>'windows_version',windows_build=p_payload->>'windows_build',windows_install_date=p_payload->>'windows_install_date',
      bios_serial=p_payload->>'bios_serial',bios_version=p_payload->>'bios_version',windows_license_status=p_payload->>'windows_license_status',
      windows_license_channel=p_payload->>'windows_license_channel',windows_partial_product_key=p_payload->>'windows_partial_product_key',windows_oem_key=p_payload->>'windows_oem_key',
      collector_version=p_payload->>'collector_version',submission_count=least(3,coalesce(submission_count,1)+1),last_submitted_at=now()
    where id=v_id
    returning submission_count into v_count;
  end if;

  return query select 'accepted'::text,v_count,3,v_id;
end;
$$;
revoke all on function public.register_inventory(jsonb) from public;
grant execute on function public.register_inventory(jsonb) to anon,authenticated;

-- 9) Listado de administradores sin exponer auth.users directamente al navegador.
create or replace function public.superadmin_list_admins()
returns table(user_id uuid,email text,display_name text,role text,created_at timestamptz)
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if not public.is_superadmin() then raise exception 'Solo SuperAdmin'; end if;
  return query
  select a.user_id,u.email,a.display_name,a.role,a.created_at
  from public.admin_users a
  join auth.users u on u.id=a.user_id
  order by a.created_at;
end;
$$;
revoke all on function public.superadmin_list_admins() from public;
grant execute on function public.superadmin_list_admins() to authenticated;

-- 10) Promoción de un usuario Auth recién creado a Administrador.
create or replace function public.superadmin_promote_admin(p_user_id uuid,p_display_name text)
returns table(user_id uuid,email text,display_name text,role text)
language plpgsql
security definer
set search_path=public,auth
as $$
declare v_email text;
begin
  if not public.is_superadmin() then raise exception 'Solo SuperAdmin puede agregar administradores'; end if;
  select u.email into v_email from auth.users u where u.id=p_user_id;
  if v_email is null then raise exception 'Usuario de Supabase Auth no encontrado'; end if;
  insert into public.admin_users(user_id,role,display_name)
  values(p_user_id,'admin',left(trim(coalesce(p_display_name,'')),100))
  on conflict(user_id) do update
  set role=case when public.admin_users.role='superadmin' then 'superadmin' else 'admin' end,
      display_name=excluded.display_name;
  return query select a.user_id,v_email,a.display_name,a.role from public.admin_users a where a.user_id=p_user_id;
end;
$$;
revoke all on function public.superadmin_promote_admin(uuid,text) from public;
grant execute on function public.superadmin_promote_admin(uuid,text) to authenticated;

-- 11) Historial de updates, evita 404.
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
drop policy if exists "superadmin_read_update_history" on public.update_history;
create policy "superadmin_read_update_history" on public.update_history
for select to authenticated using(public.is_superadmin());

commit;
notify pgrst, 'reload schema';

-- VERIFICACIÓN RÁPIDA
-- select u.email,a.role,a.display_name from auth.users u join public.admin_users a on a.user_id=u.id;

-- 12) Compatibilidad de contingencia: si un navegador todavía usa la ruta directa,
-- permite INSERT anónimo SOLO sobre inventarios. El RPC register_inventory sigue siendo la vía preferida.
drop policy if exists "public_insert_inventory_fallback" on public.inventories;
create policy "public_insert_inventory_fallback" on public.inventories
for insert to anon,authenticated
with check (true);

-- 13) Permitir al SuperAdmin registrar el vínculo admin_users si el RPC no está aún en caché.
alter table public.admin_users enable row level security;
drop policy if exists "admin_read_self" on public.admin_users;
create policy "admin_read_self" on public.admin_users
for select to authenticated
using (user_id=auth.uid() or public.is_superadmin());
drop policy if exists "superadmin_insert_admin_users" on public.admin_users;
create policy "superadmin_insert_admin_users" on public.admin_users
for insert to authenticated
with check (public.is_superadmin() and role='admin');
drop policy if exists "superadmin_update_admin_users" on public.admin_users;
create policy "superadmin_update_admin_users" on public.admin_users
for update to authenticated
using (public.is_superadmin())
with check (public.is_superadmin() and role in ('admin','superadmin'));

notify pgrst, 'reload schema';
