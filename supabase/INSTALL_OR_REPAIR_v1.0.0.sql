-- ============================================================
-- RELEVAMIENTO MANAGER v1.0.0
-- Instalación limpia / reparación idempotente
-- Dirección de Informática - Ministerio de Educación Tucumán
-- RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina
-- by Ing. Fernando Gambino
-- ============================================================

begin;
create extension if not exists pgcrypto;

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.equipment_names (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create unique index if not exists equipment_names_office_name_uidx on public.equipment_names(office_id,lower(name));

create table if not exists public.inventories (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id) on delete set null,
  equipment_id uuid references public.equipment_names(id) on delete set null,
  office_name text not null,
  equipment_name text not null,
  brand text, model text, processor text, cores integer,
  operating_system text, motherboard text, ram_gb integer, ram_type text,
  storage text, graphics text, hostname text, full_device_name text,
  domain_workgroup text, system_type text, device_uuid text, product_id text,
  windows_version text, windows_build text, windows_install_date text,
  bios_serial text, bios_version text,
  windows_license_status text, windows_license_channel text,
  windows_partial_product_key text, windows_oem_key text,
  collector_version text,
  submission_count integer not null default 1 check (submission_count between 1 and 3),
  last_submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Compatibilidad con instalaciones previas
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

create index if not exists inventories_equipment_idx on public.inventories(equipment_id);
create index if not exists inventories_last_submitted_idx on public.inventories(last_submitted_at desc);
create index if not exists inventories_office_idx on public.inventories(office_id);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.admin_users add column if not exists role text not null default 'admin';
alter table public.admin_users add column if not exists display_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='admin_users_role_check' and conrelid='public.admin_users'::regclass) then
    alter table public.admin_users add constraint admin_users_role_check check (role in ('admin','superadmin'));
  end if;
end $$;

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

create table if not exists public.app_settings (
  id integer primary key default 1 check (id=1),
  app_name text not null default 'RELEVAMIENTO MANAGER',
  short_name text not null default 'MEDTUC',
  favicon_url text,
  pwa_icon_url text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(id,app_name,short_name)
values(1,'RELEVAMIENTO MANAGER','MEDTUC')
on conflict(id) do nothing;

-- ---------- Funciones de autorización ----------
-- IMPORTANTE:
-- Instalaciones 0.3.x pueden tener políticas RLS antiguas que dependen de
-- is_admin()/is_superadmin(). CASCADE elimina solamente esos objetos
-- dependientes; las políticas oficiales de v1.0.0 se recrean más abajo.
drop function if exists public.is_admin() cascade;
drop function if exists public.is_superadmin() cascade;

create function public.is_admin()
returns boolean
language sql stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from public.admin_users a
    where a.user_id=auth.uid() and a.role in ('admin','superadmin')
  );
$$;

create function public.is_superadmin()
returns boolean
language sql stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from public.admin_users a
    where a.user_id=auth.uid() and a.role='superadmin'
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_superadmin() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_superadmin() to authenticated;

-- ---------- Registro público, máximo 3 veces ----------
-- Las versiones 0.3.x tuvieron firmas distintas. DROP + CASCADE evita
-- ERROR 42P13 al cambiar OUT parameters / RETURNS TABLE.
drop function if exists public.inventory_submission_status(uuid) cascade;
drop function if exists public.check_recent_inventory(uuid,timestamptz) cascade;
drop function if exists public.register_inventory(jsonb) cascade;

create function public.inventory_submission_status(p_equipment_id uuid)
returns table("exists" boolean, submission_count integer, completed boolean, last_submitted_at timestamptz)
language sql stable
security definer
set search_path=''
as $$
  select
    (i.id is not null) as "exists",
    coalesce(i.submission_count,0)::integer as submission_count,
    (coalesce(i.submission_count,0) >= 3) as completed,
    i.last_submitted_at
  from (select 1) s
  left join lateral (
    select x.id,x.submission_count,x.last_submitted_at
    from public.inventories x
    where x.equipment_id=p_equipment_id
    order by x.last_submitted_at desc
    limit 1
  ) i on true;
$$;

create function public.check_recent_inventory(p_equipment_id uuid,p_since timestamptz)
returns table(id uuid,created_at timestamptz,equipment_name text)
language sql stable
security definer
set search_path=''
as $$
  select i.id,i.created_at,i.equipment_name
  from public.inventories i
  where i.equipment_id=p_equipment_id and i.last_submitted_at>=p_since
  order by i.last_submitted_at desc limit 1;
$$;

create function public.register_inventory(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_equipment uuid := nullif(p_payload->>'equipment_id','')::uuid;
  v_office uuid := nullif(p_payload->>'office_id','')::uuid;
  v_row public.inventories%rowtype;
  v_count integer;
begin
  if v_equipment is null or v_office is null then
    raise exception 'office_id y equipment_id son obligatorios';
  end if;

  perform 1 from public.equipment_names e where e.id=v_equipment and e.office_id=v_office;
  if not found then raise exception 'El equipo no pertenece a la oficina indicada'; end if;

  select * into v_row
  from public.inventories i
  where i.equipment_id=v_equipment
  order by i.last_submitted_at desc limit 1
  for update;

  if found and v_row.submission_count >= 3 then
    return jsonb_build_object('ok',true,'already_registered',true,'attempt_count',v_row.submission_count,'inventory_id',v_row.id);
  end if;

  v_count := case when found then v_row.submission_count+1 else 1 end;

  if found then
    update public.inventories i set
      office_id=v_office,
      office_name=coalesce(p_payload->>'office_name',i.office_name),
      equipment_name=coalesce(p_payload->>'equipment_name',i.equipment_name),
      brand=p_payload->>'brand', model=p_payload->>'model', processor=p_payload->>'processor',
      cores=nullif(p_payload->>'cores','')::integer, operating_system=p_payload->>'operating_system',
      motherboard=p_payload->>'motherboard', ram_gb=nullif(p_payload->>'ram_gb','')::integer,
      ram_type=p_payload->>'ram_type', storage=p_payload->>'storage', graphics=p_payload->>'graphics',
      hostname=p_payload->>'hostname', full_device_name=p_payload->>'full_device_name',
      domain_workgroup=p_payload->>'domain_workgroup', system_type=p_payload->>'system_type',
      device_uuid=p_payload->>'device_uuid', product_id=p_payload->>'product_id',
      windows_version=p_payload->>'windows_version', windows_build=p_payload->>'windows_build',
      windows_install_date=p_payload->>'windows_install_date', bios_serial=p_payload->>'bios_serial',
      bios_version=p_payload->>'bios_version', windows_license_status=p_payload->>'windows_license_status',
      windows_license_channel=p_payload->>'windows_license_channel',
      windows_partial_product_key=p_payload->>'windows_partial_product_key',
      windows_oem_key=p_payload->>'windows_oem_key',
      collector_version=p_payload->>'collector_version',
      submission_count=v_count,last_submitted_at=now()
    where i.id=v_row.id
    returning * into v_row;
  else
    insert into public.inventories(
      office_id,equipment_id,office_name,equipment_name,brand,model,processor,cores,operating_system,motherboard,
      ram_gb,ram_type,storage,graphics,hostname,full_device_name,domain_workgroup,system_type,device_uuid,product_id,
      windows_version,windows_build,windows_install_date,bios_serial,bios_version,windows_license_status,
      windows_license_channel,windows_partial_product_key,windows_oem_key,collector_version,submission_count,last_submitted_at
    ) values(
      v_office,v_equipment,coalesce(p_payload->>'office_name',''),coalesce(p_payload->>'equipment_name',''),
      p_payload->>'brand',p_payload->>'model',p_payload->>'processor',nullif(p_payload->>'cores','')::integer,
      p_payload->>'operating_system',p_payload->>'motherboard',nullif(p_payload->>'ram_gb','')::integer,
      p_payload->>'ram_type',p_payload->>'storage',p_payload->>'graphics',p_payload->>'hostname',
      p_payload->>'full_device_name',p_payload->>'domain_workgroup',p_payload->>'system_type',p_payload->>'device_uuid',
      p_payload->>'product_id',p_payload->>'windows_version',p_payload->>'windows_build',p_payload->>'windows_install_date',
      p_payload->>'bios_serial',p_payload->>'bios_version',p_payload->>'windows_license_status',
      p_payload->>'windows_license_channel',p_payload->>'windows_partial_product_key',p_payload->>'windows_oem_key',
      p_payload->>'collector_version',1,now()
    ) returning * into v_row;
  end if;

  return jsonb_build_object('ok',true,'already_registered',false,'attempt_count',v_count,'completed',(v_count>=3),'inventory_id',v_row.id);
end;
$$;

revoke all on function public.inventory_submission_status(uuid) from public;
revoke all on function public.check_recent_inventory(uuid,timestamptz) from public;
revoke all on function public.register_inventory(jsonb) from public;
grant execute on function public.inventory_submission_status(uuid) to anon,authenticated;
grant execute on function public.check_recent_inventory(uuid,timestamptz) to anon,authenticated;
grant execute on function public.register_inventory(jsonb) to anon,authenticated;

-- ---------- SuperAdmin inicial ----------
create or replace function public.seed_initial_superadmin()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if lower(new.email)=lower('fernando.m.gambino@gmail.com') then
    insert into public.admin_users(user_id,role,display_name)
    values(new.id,'superadmin','Ing. Fernando Gambino')
    on conflict(user_id) do update set role='superadmin',display_name='Ing. Fernando Gambino';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seed_initial_superadmin on auth.users;
create trigger trg_seed_initial_superadmin
after insert or update of email on auth.users
for each row execute function public.seed_initial_superadmin();

insert into public.admin_users(user_id,role,display_name)
select u.id,'superadmin','Ing. Fernando Gambino'
from auth.users u
where lower(u.email)=lower('fernando.m.gambino@gmail.com')
on conflict(user_id) do update set role='superadmin',display_name='Ing. Fernando Gambino';

-- ---------- Limpieza de políticas heredadas 0.3.x ----------
-- Algunas instalaciones previas crearon estos nombres. Se eliminan de forma
-- idempotente antes de instalar las políticas oficiales de v1.0.0.
drop policy if exists admin_read_self on public.admin_users;
drop policy if exists superadmin_insert_admin_users on public.admin_users;
drop policy if exists superadmin_update_admin_users on public.admin_users;
drop policy if exists superadmin_delete_admin_users on public.admin_users;
drop policy if exists superadmin_read_admin_users on public.admin_users;
drop policy if exists admin_read_self on public.update_history;
drop policy if exists superadmin_read_update_history on public.update_history;

-- ---------- RLS ----------
alter table public.offices enable row level security;
alter table public.equipment_names enable row level security;
alter table public.inventories enable row level security;
alter table public.admin_users enable row level security;
alter table public.update_history enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists public_read_offices on public.offices;
drop policy if exists public_insert_offices on public.offices;
create policy public_read_offices on public.offices for select to anon,authenticated using(true);
create policy public_insert_offices on public.offices for insert to anon,authenticated with check(true);

drop policy if exists public_read_equipment on public.equipment_names;
drop policy if exists public_insert_equipment on public.equipment_names;
create policy public_read_equipment on public.equipment_names for select to anon,authenticated using(true);
create policy public_insert_equipment on public.equipment_names for insert to anon,authenticated with check(true);

drop policy if exists admin_read_inventory on public.inventories;
drop policy if exists admin_update_inventory on public.inventories;
drop policy if exists admin_delete_inventory on public.inventories;
create policy admin_read_inventory on public.inventories for select to authenticated using(public.is_admin());
create policy admin_update_inventory on public.inventories for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy admin_delete_inventory on public.inventories for delete to authenticated using(public.is_admin());

drop policy if exists own_admin_profile on public.admin_users;
create policy own_admin_profile on public.admin_users for select to authenticated using(user_id=auth.uid());

drop policy if exists superadmin_read_update_history on public.update_history;
create policy superadmin_read_update_history on public.update_history for select to authenticated using(public.is_superadmin());

drop policy if exists public_read_settings on public.app_settings;
drop policy if exists superadmin_write_settings on public.app_settings;
create policy public_read_settings on public.app_settings for select to anon,authenticated using(true);
create policy superadmin_write_settings on public.app_settings for all to authenticated using(public.is_superadmin()) with check(public.is_superadmin());

-- ---------- Storage para favicon / icono PWA ----------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('branding','branding',true,5242880,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists branding_superadmin_insert on storage.objects;
drop policy if exists branding_superadmin_update on storage.objects;
drop policy if exists branding_superadmin_delete on storage.objects;
create policy branding_superadmin_insert on storage.objects for insert to authenticated with check(bucket_id='branding' and public.is_superadmin());
create policy branding_superadmin_update on storage.objects for update to authenticated using(bucket_id='branding' and public.is_superadmin()) with check(bucket_id='branding' and public.is_superadmin());
create policy branding_superadmin_delete on storage.objects for delete to authenticated using(bucket_id='branding' and public.is_superadmin());

commit;

-- Recargar el schema cache de PostgREST para que los RPC nuevos queden
-- disponibles inmediatamente desde la PWA.
notify pgrst, 'reload schema';
