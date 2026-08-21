-- ============================================================
-- RELEVAMIENTO MANAGER v1.0.1
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
-- dependientes; las políticas oficiales de v1.0.1 se recrean más abajo.
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


-- ---------- Gestión de usuarios administrativos ----------
-- Estas funciones evitan depender de la Edge Function para listar usuarios
-- y permiten un fallback seguro para asignar roles por email.
drop function if exists public.superadmin_list_admins() cascade;
drop function if exists public.superadmin_assign_role_by_email(text,text,text) cascade;

create function public.superadmin_list_admins()
returns table(
  user_id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.is_superadmin() then
    raise exception 'Solo un SuperAdmin puede listar usuarios administrativos';
  end if;

  return query
  select
    a.user_id,
    u.email::text,
    a.display_name,
    a.role,
    a.created_at
  from public.admin_users a
  join auth.users u on u.id=a.user_id
  order by a.created_at asc;
end;
$$;

create function public.superadmin_assign_role_by_email(
  p_email text,
  p_display_name text,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid;
  v_role text;
begin
  if not public.is_superadmin() then
    raise exception 'Solo un SuperAdmin puede asignar roles administrativos';
  end if;

  v_role := lower(trim(coalesce(p_role,'admin')));
  if v_role not in ('admin','superadmin') then
    raise exception 'Rol inválido';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email)=lower(trim(p_email))
  order by u.created_at desc
  limit 1;

  if v_user_id is null then
    raise exception 'El usuario Auth no existe todavía';
  end if;

  insert into public.admin_users(user_id,role,display_name)
  values(v_user_id,v_role,nullif(trim(p_display_name),''))
  on conflict on constraint admin_users_pkey
  do update set
    role=excluded.role,
    display_name=coalesce(excluded.display_name,public.admin_users.display_name);

  return jsonb_build_object(
    'ok',true,
    'user_id',v_user_id,
    'email',lower(trim(p_email)),
    'role',v_role
  );
end;
$$;

revoke all on function public.superadmin_list_admins() from public;
revoke all on function public.superadmin_assign_role_by_email(text,text,text) from public;
grant execute on function public.superadmin_list_admins() to authenticated;
grant execute on function public.superadmin_assign_role_by_email(text,text,text) to authenticated;

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
    on conflict on constraint admin_users_pkey do update set role='superadmin',display_name='Ing. Fernando Gambino';
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
on conflict on constraint admin_users_pkey do update set role='superadmin',display_name='Ing. Fernando Gambino';

-- ---------- Limpieza de políticas heredadas 0.3.x ----------
-- Algunas instalaciones previas crearon estos nombres. Se eliminan de forma
-- idempotente antes de instalar las políticas oficiales de v1.0.1.
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


-- ============================================================
-- v1.0.3 - IDENTIDAD FISICA DE EQUIPOS
-- ============================================================
-- ============================================================
-- RELEVAMIENTO MANAGER v1.0.3
-- CORRECCION CRITICA: una fila por PC fisica.
-- Ya NO se identifica un inventario por equipment_id.
-- ============================================================

begin;

create extension if not exists pgcrypto;

alter table public.inventories add column if not exists hardware_key text;
alter table public.inventories add column if not exists last_submission_token uuid;
alter table public.inventories add column if not exists last_submission_result text;

-- Normaliza valores OEM/no confiables.
create or replace function public.rm_clean_identity(p_value text)
returns text
language sql
immutable
set search_path=''
as $$
  select case
    when p_value is null then null
    when btrim(p_value) = '' then null
    when lower(btrim(p_value)) in (
      'no detectado','unknown','none','null','default string',
      'to be filled by o.e.m.','to be filled by oem',
      'system serial number','system product name',
      '00000000-0000-0000-0000-000000000000'
    ) then null
    else lower(btrim(p_value))
  end
$$;

-- Genera una identidad estable del hardware.
-- Prioridad: UUID SMBIOS -> serial BIOS + hostname -> hostname + placa.
create or replace function public.rm_hardware_key(
  p_device_uuid text,
  p_bios_serial text,
  p_hostname text,
  p_motherboard text
)
returns text
language sql
immutable
set search_path=''
as $$
  select encode(
    extensions.digest(
      case
        when public.rm_clean_identity(p_device_uuid) is not null
          then 'uuid|' || public.rm_clean_identity(p_device_uuid)
        when public.rm_clean_identity(p_bios_serial) is not null
          then 'bios|' || public.rm_clean_identity(p_bios_serial) || '|host|' || coalesce(public.rm_clean_identity(p_hostname),'')
        else
          'host|' || coalesce(public.rm_clean_identity(p_hostname),'') || '|board|' || coalesce(public.rm_clean_identity(p_motherboard),'')
      end,
      'sha256'
    ),
    'hex'
  )
$$;

-- Migra las filas que ya existen para que conserven su identidad física.
update public.inventories i
set hardware_key = public.rm_hardware_key(i.device_uuid,i.bios_serial,i.hostname,i.motherboard)
where i.hardware_key is null;

-- Si una instalación dañada ya tuviera duplicados de la misma identidad,
-- NO borramos datos automáticamente. Se evita crear el unique index hasta
-- comprobar que no haya duplicados.
do $$
begin
  if not exists (
    select 1
    from public.inventories
    where hardware_key is not null
    group by hardware_key
    having count(*) > 1
  ) then
    create unique index if not exists inventories_hardware_key_uidx
      on public.inventories(hardware_key)
      where hardware_key is not null;
  end if;
end $$;

drop function if exists public.inventory_submission_status(uuid) cascade;
create function public.inventory_submission_status(p_submission_token uuid)
returns table(
  "exists" boolean,
  submission_count integer,
  completed boolean,
  submission_result text,
  inventory_id uuid,
  last_submitted_at timestamptz
)
language sql
security definer
set search_path=''
as $$
  select
    (x.id is not null) as "exists",
    coalesce(x.submission_count,0)::integer,
    (coalesce(x.submission_count,0) >= 3),
    x.last_submission_result,
    x.id,
    x.last_submitted_at
  from (select 1) s
  left join lateral (
    select i.id,i.submission_count,i.last_submission_result,i.last_submitted_at
    from public.inventories i
    where i.last_submission_token=p_submission_token
    order by i.last_submitted_at desc
    limit 1
  ) x on true;
$$;

drop function if exists public.register_inventory(jsonb) cascade;
create function public.register_inventory(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_equipment uuid := nullif(p_payload->>'equipment_id','')::uuid;
  v_office uuid := nullif(p_payload->>'office_id','')::uuid;
  v_token uuid := nullif(p_payload->>'submission_token','')::uuid;
  v_hardware_key text;
  v_row public.inventories%rowtype;
  v_count integer;
  v_result text;
begin
  if v_equipment is null or v_office is null or v_token is null then
    raise exception 'office_id, equipment_id y submission_token son obligatorios';
  end if;

  perform 1
  from public.equipment_names e
  where e.id=v_equipment and e.office_id=v_office;
  if not found then
    raise exception 'El equipo no pertenece a la oficina indicada';
  end if;

  v_hardware_key := public.rm_hardware_key(
    p_payload->>'device_uuid',
    p_payload->>'bios_serial',
    p_payload->>'hostname',
    p_payload->>'motherboard'
  );

  -- CRITICO: buscar por identidad FISICA, nunca por equipment_id.
  select *
  into v_row
  from public.inventories i
  where i.hardware_key=v_hardware_key
  order by i.last_submitted_at desc
  limit 1
  for update;

  if found and v_row.submission_count >= 3 then
    update public.inventories i
    set
      last_submission_token=v_token,
      last_submission_result='already_completed'
    where i.id=v_row.id;

    return jsonb_build_object(
      'ok',true,
      'already_registered',true,
      'attempt_count',v_row.submission_count,
      'completed',true,
      'submission_result','already_completed',
      'inventory_id',v_row.id
    );
  end if;

  v_count := case when found then v_row.submission_count + 1 else 1 end;
  v_result := case
    when v_count >= 3 then 'completed'
    when v_count = 2 then 'updated'
    else 'registered'
  end;

  if found then
    update public.inventories i set
      office_id=v_office,
      equipment_id=v_equipment,
      office_name=coalesce(nullif(p_payload->>'office_name',''),i.office_name),
      equipment_name=coalesce(nullif(p_payload->>'equipment_name',''),i.equipment_name),
      brand=p_payload->>'brand',
      model=p_payload->>'model',
      processor=p_payload->>'processor',
      cores=nullif(p_payload->>'cores','')::integer,
      operating_system=p_payload->>'operating_system',
      motherboard=p_payload->>'motherboard',
      ram_gb=nullif(p_payload->>'ram_gb','')::integer,
      ram_type=p_payload->>'ram_type',
      storage=p_payload->>'storage',
      graphics=p_payload->>'graphics',
      hostname=p_payload->>'hostname',
      full_device_name=p_payload->>'full_device_name',
      domain_workgroup=p_payload->>'domain_workgroup',
      system_type=p_payload->>'system_type',
      device_uuid=p_payload->>'device_uuid',
      product_id=p_payload->>'product_id',
      windows_version=p_payload->>'windows_version',
      windows_build=p_payload->>'windows_build',
      windows_install_date=p_payload->>'windows_install_date',
      bios_serial=p_payload->>'bios_serial',
      bios_version=p_payload->>'bios_version',
      windows_license_status=p_payload->>'windows_license_status',
      windows_license_channel=p_payload->>'windows_license_channel',
      windows_partial_product_key=p_payload->>'windows_partial_product_key',
      windows_oem_key=p_payload->>'windows_oem_key',
      collector_version=p_payload->>'collector_version',
      hardware_key=v_hardware_key,
      submission_count=v_count,
      last_submission_token=v_token,
      last_submission_result=v_result,
      last_submitted_at=now()
    where i.id=v_row.id
    returning * into v_row;
  else
    insert into public.inventories(
      office_id,equipment_id,office_name,equipment_name,brand,model,processor,cores,
      operating_system,motherboard,ram_gb,ram_type,storage,graphics,hostname,
      full_device_name,domain_workgroup,system_type,device_uuid,product_id,
      windows_version,windows_build,windows_install_date,bios_serial,bios_version,
      windows_license_status,windows_license_channel,windows_partial_product_key,
      windows_oem_key,collector_version,hardware_key,submission_count,
      last_submission_token,last_submission_result,last_submitted_at
    ) values(
      v_office,v_equipment,
      coalesce(p_payload->>'office_name',''),
      coalesce(p_payload->>'equipment_name',''),
      p_payload->>'brand',p_payload->>'model',p_payload->>'processor',
      nullif(p_payload->>'cores','')::integer,
      p_payload->>'operating_system',p_payload->>'motherboard',
      nullif(p_payload->>'ram_gb','')::integer,
      p_payload->>'ram_type',p_payload->>'storage',p_payload->>'graphics',
      p_payload->>'hostname',p_payload->>'full_device_name',
      p_payload->>'domain_workgroup',p_payload->>'system_type',
      p_payload->>'device_uuid',p_payload->>'product_id',
      p_payload->>'windows_version',p_payload->>'windows_build',
      p_payload->>'windows_install_date',p_payload->>'bios_serial',
      p_payload->>'bios_version',p_payload->>'windows_license_status',
      p_payload->>'windows_license_channel',
      p_payload->>'windows_partial_product_key',
      p_payload->>'windows_oem_key',
      p_payload->>'collector_version',
      v_hardware_key,1,v_token,'registered',now()
    )
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok',true,
    'already_registered',false,
    'attempt_count',v_count,
    'completed',(v_count>=3),
    'submission_result',v_result,
    'inventory_id',v_row.id
  );
end;
$$;

revoke all on function public.inventory_submission_status(uuid) from public;
revoke all on function public.register_inventory(jsonb) from public;
grant execute on function public.inventory_submission_status(uuid) to anon,authenticated;
grant execute on function public.register_inventory(jsonb) to anon,authenticated;

notify pgrst, 'reload schema';
commit;


-- ============================================================
-- RELEVAMIENTO MANAGER v1.1.0
-- Importador inteligente + filtros/agrupación + etiquetas + oficinas
-- ============================================================

begin;

-- Metadatos de importación
alter table public.inventories add column if not exists import_source text;
alter table public.inventories add column if not exists imported_at timestamptz;

-- Etiquetas
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#6ca8ff',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tags_name_len check (char_length(trim(name)) between 1 and 40),
  constraint tags_color_fmt check (color ~ '^#[0-9A-Fa-f]{6}$')
);
create unique index if not exists tags_name_lower_uidx on public.tags(lower(trim(name)));

create table if not exists public.inventory_tags (
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (inventory_id,tag_id)
);
create index if not exists inventory_tags_tag_idx on public.inventory_tags(tag_id);
create index if not exists inventory_tags_inventory_idx on public.inventory_tags(inventory_id);

-- Editar oficina y propagar el nombre histórico.
drop function if exists public.superadmin_rename_office(uuid,text) cascade;
create function public.superadmin_rename_office(p_office_id uuid,p_new_name text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_name text := trim(coalesce(p_new_name,''));
begin
  if not public.is_superadmin() then
    raise exception 'Solo un SuperAdmin puede editar oficinas';
  end if;
  if p_office_id is null or char_length(v_name) not between 2 and 80 then
    raise exception 'Nombre de oficina inválido';
  end if;
  if exists(select 1 from public.offices o where lower(trim(o.name))=lower(v_name) and o.id<>p_office_id) then
    raise exception 'Ya existe una oficina con ese nombre';
  end if;

  update public.offices o set name=v_name where o.id=p_office_id;
  if not found then raise exception 'Oficina no encontrada'; end if;

  update public.inventories i set office_name=v_name where i.office_id=p_office_id;
  return jsonb_build_object('ok',true,'id',p_office_id,'name',v_name);
end;
$$;

revoke all on function public.superadmin_rename_office(uuid,text) from public;
grant execute on function public.superadmin_rename_office(uuid,text) to authenticated;

-- Importación de UNA fila. El frontend procesa el archivo y llama esta función.
-- "Inteligente": crea catálogo faltante, fusiona por Oficina+Equipo si ya existe,
-- y solo crea una fila nueva cuando ese equipo histórico no existe.
drop function if exists public.superadmin_import_inventory_row(jsonb) cascade;
create function public.superadmin_import_inventory_row(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_office_name text := trim(coalesce(p_payload->>'office_name',''));
  v_equipment_name text := trim(coalesce(p_payload->>'equipment_name',''));
  v_office_id uuid;
  v_equipment_id uuid;
  v_existing public.inventories%rowtype;
  v_hardware_key text;
  v_source_date timestamptz;
  v_cores integer;
  v_ram integer;
begin
  if not public.is_superadmin() then
    raise exception 'Solo un SuperAdmin puede importar inventarios';
  end if;
  if char_length(v_office_name) < 2 or char_length(v_equipment_name) < 1 then
    raise exception 'Oficina y Equipo son obligatorios';
  end if;

  begin v_source_date := nullif(p_payload->>'source_date','')::timestamptz; exception when others then v_source_date := null; end;
  begin v_cores := nullif(p_payload->>'cores','')::integer; exception when others then v_cores := null; end;
  begin v_ram := nullif(p_payload->>'ram_gb','')::integer; exception when others then v_ram := null; end;

  select o.id into v_office_id
  from public.offices o
  where lower(trim(o.name))=lower(v_office_name)
  limit 1;

  if v_office_id is null then
    insert into public.offices(name) values(v_office_name)
    returning id into v_office_id;
  end if;

  select e.id into v_equipment_id
  from public.equipment_names e
  where e.office_id=v_office_id and lower(trim(e.name))=lower(v_equipment_name)
  limit 1;

  if v_equipment_id is null then
    insert into public.equipment_names(office_id,name)
    values(v_office_id,v_equipment_name)
    returning id into v_equipment_id;
  end if;

  -- Primero se intenta fusionar con el mismo activo lógico.
  select * into v_existing
  from public.inventories i
  where i.office_id=v_office_id
    and lower(trim(i.equipment_name))=lower(v_equipment_name)
  order by i.last_submitted_at desc
  limit 1
  for update;

  if found then
    update public.inventories i set
      equipment_id=coalesce(i.equipment_id,v_equipment_id),
      office_name=v_office_name,
      -- No degradar un relevamiento actual: el importador completa datos faltantes.
      brand=case when nullif(trim(coalesce(i.brand,'')),'') is null then nullif(trim(p_payload->>'brand'),'') else i.brand end,
      model=case when nullif(trim(coalesce(i.model,'')),'') is null then nullif(trim(p_payload->>'model'),'') else i.model end,
      processor=case when nullif(trim(coalesce(i.processor,'')),'') is null then nullif(trim(p_payload->>'processor'),'') else i.processor end,
      cores=coalesce(i.cores,v_cores),
      operating_system=case when nullif(trim(coalesce(i.operating_system,'')),'') is null then nullif(trim(p_payload->>'operating_system'),'') else i.operating_system end,
      motherboard=case when nullif(trim(coalesce(i.motherboard,'')),'') is null then nullif(trim(p_payload->>'motherboard'),'') else i.motherboard end,
      ram_gb=coalesce(i.ram_gb,v_ram),
      ram_type=case when nullif(trim(coalesce(i.ram_type,'')),'') is null then nullif(trim(p_payload->>'ram_type'),'') else i.ram_type end,
      storage=case when nullif(trim(coalesce(i.storage,'')),'') is null then nullif(trim(p_payload->>'storage'),'') else i.storage end,
      graphics=case when nullif(trim(coalesce(i.graphics,'')),'') is null then nullif(trim(p_payload->>'graphics'),'') else i.graphics end,
      import_source=coalesce(i.import_source,'spreadsheet'),
      imported_at=now()
    where i.id=v_existing.id;
    return jsonb_build_object('ok',true,'action','merged','inventory_id',v_existing.id,'office_id',v_office_id,'equipment_id',v_equipment_id);
  end if;

  -- Huella estable SOLO para históricos sin UUID/BIOS.
  v_hardware_key := 'import|' || md5(
    lower(v_office_name)||'|'||
    lower(v_equipment_name)||'|'||
    lower(coalesce(p_payload->>'processor',''))||'|'||
    lower(coalesce(p_payload->>'motherboard',''))
  );

  insert into public.inventories(
    office_id,equipment_id,office_name,equipment_name,brand,model,processor,cores,
    operating_system,motherboard,ram_gb,ram_type,storage,graphics,hostname,
    collector_version,submission_count,last_submitted_at,created_at,
    windows_license_status,hardware_key,import_source,imported_at
  ) values(
    v_office_id,v_equipment_id,v_office_name,v_equipment_name,
    nullif(trim(p_payload->>'brand'),''),
    nullif(trim(p_payload->>'model'),''),
    nullif(trim(p_payload->>'processor'),''),
    v_cores,
    nullif(trim(p_payload->>'operating_system'),''),
    nullif(trim(p_payload->>'motherboard'),''),
    v_ram,
    nullif(trim(p_payload->>'ram_type'),''),
    nullif(trim(p_payload->>'storage'),''),
    nullif(trim(p_payload->>'graphics'),''),
    v_equipment_name,
    coalesce(nullif(p_payload->>'collector_version',''),'IMPORT-v1.1.0'),
    1,
    coalesce(v_source_date,now()),
    coalesce(v_source_date,now()),
    'Desconocido',
    v_hardware_key,
    'spreadsheet',
    now()
  )
  returning * into v_existing;

  return jsonb_build_object('ok',true,'action','inserted','inventory_id',v_existing.id,'office_id',v_office_id,'equipment_id',v_equipment_id);
exception
  when unique_violation then
    -- Reintento conservador ante catálogo creado simultáneamente.
    return jsonb_build_object('ok',false,'action','duplicate','message','Registro duplicado detectado');
end;
$$;

revoke all on function public.superadmin_import_inventory_row(jsonb) from public;
grant execute on function public.superadmin_import_inventory_row(jsonb) to authenticated;

-- RLS de etiquetas
alter table public.tags enable row level security;
alter table public.inventory_tags enable row level security;

drop policy if exists admin_read_tags on public.tags;
drop policy if exists admin_write_tags on public.tags;
create policy admin_read_tags on public.tags for select to authenticated using(public.is_admin());
create policy admin_write_tags on public.tags for all to authenticated using(public.is_admin()) with check(public.is_admin());

drop policy if exists admin_read_inventory_tags on public.inventory_tags;
drop policy if exists admin_write_inventory_tags on public.inventory_tags;
create policy admin_read_inventory_tags on public.inventory_tags for select to authenticated using(public.is_admin());
create policy admin_write_inventory_tags on public.inventory_tags for all to authenticated using(public.is_admin()) with check(public.is_admin());

create index if not exists inventories_ram_idx on public.inventories(ram_gb);
create index if not exists inventories_license_idx on public.inventories(windows_license_status);
create index if not exists inventories_submission_count_idx on public.inventories(submission_count);
create index if not exists inventories_office_name_lower_idx on public.inventories(lower(office_name));
create index if not exists inventories_equipment_name_lower_idx on public.inventories(lower(equipment_name));

commit;
notify pgrst, 'reload schema';


-- ===== v1.1.0 SMART INVENTORY =====
-- ============================================================
-- RELEVAMIENTO MANAGER v1.1.0
-- Importador inteligente + filtros/agrupación + etiquetas + oficinas
-- ============================================================

begin;

-- Metadatos de importación
alter table public.inventories add column if not exists import_source text;
alter table public.inventories add column if not exists imported_at timestamptz;

-- Etiquetas
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#6ca8ff',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tags_name_len check (char_length(trim(name)) between 1 and 40),
  constraint tags_color_fmt check (color ~ '^#[0-9A-Fa-f]{6}$')
);
create unique index if not exists tags_name_lower_uidx on public.tags(lower(trim(name)));

create table if not exists public.inventory_tags (
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (inventory_id,tag_id)
);
create index if not exists inventory_tags_tag_idx on public.inventory_tags(tag_id);
create index if not exists inventory_tags_inventory_idx on public.inventory_tags(inventory_id);

-- Editar oficina y propagar el nombre histórico.
drop function if exists public.superadmin_rename_office(uuid,text) cascade;
create function public.superadmin_rename_office(p_office_id uuid,p_new_name text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_name text := trim(coalesce(p_new_name,''));
begin
  if not public.is_superadmin() then
    raise exception 'Solo un SuperAdmin puede editar oficinas';
  end if;
  if p_office_id is null or char_length(v_name) not between 2 and 80 then
    raise exception 'Nombre de oficina inválido';
  end if;
  if exists(select 1 from public.offices o where lower(trim(o.name))=lower(v_name) and o.id<>p_office_id) then
    raise exception 'Ya existe una oficina con ese nombre';
  end if;

  update public.offices o set name=v_name where o.id=p_office_id;
  if not found then raise exception 'Oficina no encontrada'; end if;

  update public.inventories i set office_name=v_name where i.office_id=p_office_id;
  return jsonb_build_object('ok',true,'id',p_office_id,'name',v_name);
end;
$$;

revoke all on function public.superadmin_rename_office(uuid,text) from public;
grant execute on function public.superadmin_rename_office(uuid,text) to authenticated;

-- Importación de UNA fila. El frontend procesa el archivo y llama esta función.
-- "Inteligente": crea catálogo faltante, fusiona por Oficina+Equipo si ya existe,
-- y solo crea una fila nueva cuando ese equipo histórico no existe.
drop function if exists public.superadmin_import_inventory_row(jsonb) cascade;
create function public.superadmin_import_inventory_row(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_office_name text := trim(coalesce(p_payload->>'office_name',''));
  v_equipment_name text := trim(coalesce(p_payload->>'equipment_name',''));
  v_office_id uuid;
  v_equipment_id uuid;
  v_existing public.inventories%rowtype;
  v_hardware_key text;
  v_source_date timestamptz;
  v_cores integer;
  v_ram integer;
begin
  if not public.is_superadmin() then
    raise exception 'Solo un SuperAdmin puede importar inventarios';
  end if;
  if char_length(v_office_name) < 2 or char_length(v_equipment_name) < 1 then
    raise exception 'Oficina y Equipo son obligatorios';
  end if;

  begin v_source_date := nullif(p_payload->>'source_date','')::timestamptz; exception when others then v_source_date := null; end;
  begin v_cores := nullif(p_payload->>'cores','')::integer; exception when others then v_cores := null; end;
  begin v_ram := nullif(p_payload->>'ram_gb','')::integer; exception when others then v_ram := null; end;

  select o.id into v_office_id
  from public.offices o
  where lower(trim(o.name))=lower(v_office_name)
  limit 1;

  if v_office_id is null then
    insert into public.offices(name) values(v_office_name)
    returning id into v_office_id;
  end if;

  select e.id into v_equipment_id
  from public.equipment_names e
  where e.office_id=v_office_id and lower(trim(e.name))=lower(v_equipment_name)
  limit 1;

  if v_equipment_id is null then
    insert into public.equipment_names(office_id,name)
    values(v_office_id,v_equipment_name)
    returning id into v_equipment_id;
  end if;

  -- Primero se intenta fusionar con el mismo activo lógico.
  select * into v_existing
  from public.inventories i
  where i.office_id=v_office_id
    and lower(trim(i.equipment_name))=lower(v_equipment_name)
  order by i.last_submitted_at desc
  limit 1
  for update;

  if found then
    update public.inventories i set
      equipment_id=coalesce(i.equipment_id,v_equipment_id),
      office_name=v_office_name,
      -- No degradar un relevamiento actual: el importador completa datos faltantes.
      brand=case when nullif(trim(coalesce(i.brand,'')),'') is null then nullif(trim(p_payload->>'brand'),'') else i.brand end,
      model=case when nullif(trim(coalesce(i.model,'')),'') is null then nullif(trim(p_payload->>'model'),'') else i.model end,
      processor=case when nullif(trim(coalesce(i.processor,'')),'') is null then nullif(trim(p_payload->>'processor'),'') else i.processor end,
      cores=coalesce(i.cores,v_cores),
      operating_system=case when nullif(trim(coalesce(i.operating_system,'')),'') is null then nullif(trim(p_payload->>'operating_system'),'') else i.operating_system end,
      motherboard=case when nullif(trim(coalesce(i.motherboard,'')),'') is null then nullif(trim(p_payload->>'motherboard'),'') else i.motherboard end,
      ram_gb=coalesce(i.ram_gb,v_ram),
      ram_type=case when nullif(trim(coalesce(i.ram_type,'')),'') is null then nullif(trim(p_payload->>'ram_type'),'') else i.ram_type end,
      storage=case when nullif(trim(coalesce(i.storage,'')),'') is null then nullif(trim(p_payload->>'storage'),'') else i.storage end,
      graphics=case when nullif(trim(coalesce(i.graphics,'')),'') is null then nullif(trim(p_payload->>'graphics'),'') else i.graphics end,
      import_source=coalesce(i.import_source,'spreadsheet'),
      imported_at=now()
    where i.id=v_existing.id;
    return jsonb_build_object('ok',true,'action','merged','inventory_id',v_existing.id,'office_id',v_office_id,'equipment_id',v_equipment_id);
  end if;

  -- Huella estable SOLO para históricos sin UUID/BIOS.
  v_hardware_key := 'import|' || md5(
    lower(v_office_name)||'|'||
    lower(v_equipment_name)||'|'||
    lower(coalesce(p_payload->>'processor',''))||'|'||
    lower(coalesce(p_payload->>'motherboard',''))
  );

  insert into public.inventories(
    office_id,equipment_id,office_name,equipment_name,brand,model,processor,cores,
    operating_system,motherboard,ram_gb,ram_type,storage,graphics,hostname,
    collector_version,submission_count,last_submitted_at,created_at,
    windows_license_status,hardware_key,import_source,imported_at
  ) values(
    v_office_id,v_equipment_id,v_office_name,v_equipment_name,
    nullif(trim(p_payload->>'brand'),''),
    nullif(trim(p_payload->>'model'),''),
    nullif(trim(p_payload->>'processor'),''),
    v_cores,
    nullif(trim(p_payload->>'operating_system'),''),
    nullif(trim(p_payload->>'motherboard'),''),
    v_ram,
    nullif(trim(p_payload->>'ram_type'),''),
    nullif(trim(p_payload->>'storage'),''),
    nullif(trim(p_payload->>'graphics'),''),
    v_equipment_name,
    coalesce(nullif(p_payload->>'collector_version',''),'IMPORT-v1.1.0'),
    1,
    coalesce(v_source_date,now()),
    coalesce(v_source_date,now()),
    'Desconocido',
    v_hardware_key,
    'spreadsheet',
    now()
  )
  returning * into v_existing;

  return jsonb_build_object('ok',true,'action','inserted','inventory_id',v_existing.id,'office_id',v_office_id,'equipment_id',v_equipment_id);
exception
  when unique_violation then
    -- Reintento conservador ante catálogo creado simultáneamente.
    return jsonb_build_object('ok',false,'action','duplicate','message','Registro duplicado detectado');
end;
$$;

revoke all on function public.superadmin_import_inventory_row(jsonb) from public;
grant execute on function public.superadmin_import_inventory_row(jsonb) to authenticated;

-- RLS de etiquetas
alter table public.tags enable row level security;
alter table public.inventory_tags enable row level security;

drop policy if exists admin_read_tags on public.tags;
drop policy if exists admin_write_tags on public.tags;
create policy admin_read_tags on public.tags for select to authenticated using(public.is_admin());
create policy admin_write_tags on public.tags for all to authenticated using(public.is_admin()) with check(public.is_admin());

drop policy if exists admin_read_inventory_tags on public.inventory_tags;
drop policy if exists admin_write_inventory_tags on public.inventory_tags;
create policy admin_read_inventory_tags on public.inventory_tags for select to authenticated using(public.is_admin());
create policy admin_write_inventory_tags on public.inventory_tags for all to authenticated using(public.is_admin()) with check(public.is_admin());

create index if not exists inventories_ram_idx on public.inventories(ram_gb);
create index if not exists inventories_license_idx on public.inventories(windows_license_status);
create index if not exists inventories_submission_count_idx on public.inventories(submission_count);
create index if not exists inventories_office_name_lower_idx on public.inventories(lower(office_name));
create index if not exists inventories_equipment_name_lower_idx on public.inventories(lower(equipment_name));

commit;
notify pgrst, 'reload schema';


-- ===== v1.2.0 =====
-- ============================================================
-- RELEVAMIENTO MANAGER v1.2.0
-- Seguridad Admin/SuperAdmin + edición integral + oficinas
-- ============================================================

begin;

-- Inventarios: administradores pueden LEER y EDITAR, pero SOLO SuperAdmin elimina.
alter table public.inventories enable row level security;

drop policy if exists admin_delete_inventories on public.inventories;
drop policy if exists admins_delete_inventories on public.inventories;
drop policy if exists superadmin_delete_inventories on public.inventories;

create policy superadmin_delete_inventories
on public.inventories
for delete
to authenticated
using (public.is_superadmin());

-- Conservamos permisos de lectura/actualización para administradores.
drop policy if exists admin_update_inventories on public.inventories;
create policy admin_update_inventories
on public.inventories
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Catálogo de oficinas: solo SuperAdmin puede modificar directamente.
alter table public.offices enable row level security;

drop policy if exists admin_update_offices on public.offices;
drop policy if exists superadmin_update_offices on public.offices;
create policy superadmin_update_offices
on public.offices
for update
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

-- Usuarios administrativos:
-- ningún Admin puede eliminar usuarios; solo SuperAdmin.
alter table public.admin_users enable row level security;

drop policy if exists admin_delete_admin_users on public.admin_users;
drop policy if exists admins_delete_admin_users on public.admin_users;
drop policy if exists superadmin_delete_admin_users on public.admin_users;

create policy superadmin_delete_admin_users
on public.admin_users
for delete
to authenticated
using (public.is_superadmin());

-- RPC de eliminación de inventarios para reforzar la regla.
drop function if exists public.superadmin_delete_inventories(uuid[]) cascade;
create function public.superadmin_delete_inventories(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer;
begin
  if not public.is_superadmin() then
    raise exception 'Solo un SuperAdmin puede eliminar equipos';
  end if;

  delete from public.inventories i
  where i.id = any(p_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.superadmin_delete_inventories(uuid[]) from public;
grant execute on function public.superadmin_delete_inventories(uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;


-- ===== 005_v1.2.3_TAGS_FIX.sql =====
-- ============================================================
-- RELEVAMIENTO MANAGER v1.2.3
-- Etiquetas: consistencia, permisos y edición
-- ============================================================

begin;

-- Asegura unicidad case-insensitive. Si ya existe, no hace nada.
create unique index if not exists tags_name_lower_uidx
on public.tags ((lower(btrim(name))));

alter table public.tags enable row level security;
alter table public.inventory_tags enable row level security;

-- Lectura para usuarios administrativos autenticados.
drop policy if exists admin_read_tags on public.tags;
create policy admin_read_tags
on public.tags for select
to authenticated
using (public.is_admin());

drop policy if exists admin_read_inventory_tags on public.inventory_tags;
create policy admin_read_inventory_tags
on public.inventory_tags for select
to authenticated
using (public.is_admin());

-- Admin y SuperAdmin pueden crear/editar etiquetas y asignarlas.
drop policy if exists admin_insert_tags on public.tags;
create policy admin_insert_tags
on public.tags for insert
to authenticated
with check (public.is_admin());

drop policy if exists admin_update_tags on public.tags;
create policy admin_update_tags
on public.tags for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists admin_insert_inventory_tags on public.inventory_tags;
create policy admin_insert_inventory_tags
on public.inventory_tags for insert
to authenticated
with check (public.is_admin());

drop policy if exists admin_delete_inventory_tags on public.inventory_tags;
create policy admin_delete_inventory_tags
on public.inventory_tags for delete
to authenticated
using (public.is_admin());

-- Eliminar la definición de una etiqueta completa sigue reservado a SuperAdmin.
drop policy if exists superadmin_delete_tags on public.tags;
create policy superadmin_delete_tags
on public.tags for delete
to authenticated
using (public.is_superadmin());

notify pgrst, 'reload schema';
commit;


-- ===== 006_v1.3.0_SMART_IMPORT_DGIDD.sql =====
-- ============================================================
-- RELEVAMIENTO MANAGER v1.3.0
-- Importador inteligente para planillas DGIDD / formatos heterogéneos
-- ============================================================

begin;

alter table public.inventories add column if not exists equipment_type text;
alter table public.inventories add column if not exists acquisition_year integer;
alter table public.inventories add column if not exists processor_count integer;
alter table public.inventories add column if not exists source_item_no text;
alter table public.inventories add column if not exists source_quantity integer;
alter table public.inventories add column if not exists source_unit_no integer;
alter table public.inventories add column if not exists source_sheet text;
alter table public.inventories add column if not exists source_row integer;

drop function if exists public.superadmin_import_inventory_row(jsonb) cascade;
create function public.superadmin_import_inventory_row(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_office_name text := trim(coalesce(p_payload->>'office_name',''));
  v_equipment_name text := trim(coalesce(p_payload->>'equipment_name',''));
  v_office_id uuid;
  v_equipment_id uuid;
  v_existing public.inventories%rowtype;
  v_hardware_key text;
  v_source_date timestamptz;
  v_cores integer;
  v_ram integer;
  v_year integer;
  v_proc_count integer;
  v_source_qty integer;
  v_source_unit integer;
  v_source_row integer;
begin
  if not public.is_superadmin() then
    raise exception 'Solo un SuperAdmin puede importar inventarios';
  end if;
  if char_length(v_office_name) < 2 or char_length(v_equipment_name) < 1 then
    raise exception 'Oficina y Equipo son obligatorios';
  end if;

  begin v_source_date := nullif(p_payload->>'source_date','')::timestamptz; exception when others then v_source_date := null; end;
  begin v_cores := nullif(p_payload->>'cores','')::integer; exception when others then v_cores := null; end;
  begin v_ram := round(nullif(p_payload->>'ram_gb','')::numeric)::integer; exception when others then v_ram := null; end;
  begin v_year := nullif(p_payload->>'acquisition_year','')::integer; exception when others then v_year := null; end;
  begin v_proc_count := nullif(p_payload->>'processor_count','')::integer; exception when others then v_proc_count := null; end;
  begin v_source_qty := nullif(p_payload->>'source_quantity','')::integer; exception when others then v_source_qty := 1; end;
  begin v_source_unit := nullif(p_payload->>'source_unit_no','')::integer; exception when others then v_source_unit := 1; end;
  begin v_source_row := nullif(p_payload->>'source_row','')::integer; exception when others then v_source_row := null; end;

  select o.id into v_office_id
  from public.offices o
  where lower(trim(o.name))=lower(v_office_name)
  limit 1;

  if v_office_id is null then
    insert into public.offices(name) values(v_office_name)
    returning id into v_office_id;
  end if;

  select e.id into v_equipment_id
  from public.equipment_names e
  where e.office_id=v_office_id
    and lower(trim(e.name))=lower(v_equipment_name)
  limit 1;

  if v_equipment_id is null then
    insert into public.equipment_names(office_id,name)
    values(v_office_id,left(v_equipment_name,80))
    returning id into v_equipment_id;
  end if;

  -- Para importaciones históricas usamos una identidad estable por
  -- repartición + hoja + ítem + unidad. Así reimportar no duplica.
  v_hardware_key := 'import|' || md5(
    lower(v_office_name)||'|'||
    lower(coalesce(p_payload->>'source_sheet',''))||'|'||
    lower(coalesce(p_payload->>'source_item_no',''))||'|'||
    coalesce(p_payload->>'source_unit_no','1')
  );

  select * into v_existing
  from public.inventories i
  where i.hardware_key=v_hardware_key
  limit 1
  for update;

  if found then
    update public.inventories i set
      office_id=v_office_id,
      equipment_id=v_equipment_id,
      office_name=v_office_name,
      equipment_name=v_equipment_name,
      equipment_type=nullif(trim(p_payload->>'equipment_type'),''),
      brand=nullif(trim(p_payload->>'brand'),''),
      model=nullif(trim(p_payload->>'model'),''),
      acquisition_year=v_year,
      processor_count=v_proc_count,
      processor=nullif(trim(p_payload->>'processor'),''),
      cores=v_cores,
      operating_system=coalesce(nullif(trim(p_payload->>'operating_system'),''),i.operating_system),
      motherboard=coalesce(nullif(trim(p_payload->>'motherboard'),''),i.motherboard),
      ram_gb=v_ram,
      ram_type=coalesce(nullif(trim(p_payload->>'ram_type'),''),i.ram_type),
      storage=nullif(trim(p_payload->>'storage'),''),
      graphics=coalesce(nullif(trim(p_payload->>'graphics'),''),i.graphics),
      source_item_no=nullif(trim(p_payload->>'source_item_no'),''),
      source_quantity=coalesce(v_source_qty,1),
      source_unit_no=coalesce(v_source_unit,1),
      source_sheet=nullif(trim(p_payload->>'source_sheet'),''),
      source_row=v_source_row,
      import_source='spreadsheet-smart-v1.3.0',
      imported_at=now(),
      collector_version='IMPORT-v1.3.0',
      last_submitted_at=coalesce(v_source_date,i.last_submitted_at,now())
    where i.id=v_existing.id;

    return jsonb_build_object(
      'ok',true,'action','updated','inventory_id',v_existing.id,
      'office_id',v_office_id,'equipment_id',v_equipment_id
    );
  end if;

  insert into public.inventories(
    office_id,equipment_id,office_name,equipment_name,equipment_type,
    brand,model,acquisition_year,processor_count,processor,cores,
    operating_system,motherboard,ram_gb,ram_type,storage,graphics,hostname,
    collector_version,submission_count,last_submitted_at,created_at,
    windows_license_status,hardware_key,import_source,imported_at,
    source_item_no,source_quantity,source_unit_no,source_sheet,source_row
  ) values(
    v_office_id,v_equipment_id,v_office_name,left(v_equipment_name,80),
    nullif(trim(p_payload->>'equipment_type'),''),
    nullif(trim(p_payload->>'brand'),''),
    nullif(trim(p_payload->>'model'),''),
    v_year,v_proc_count,
    nullif(trim(p_payload->>'processor'),''),
    v_cores,
    nullif(trim(p_payload->>'operating_system'),''),
    nullif(trim(p_payload->>'motherboard'),''),
    v_ram,
    nullif(trim(p_payload->>'ram_type'),''),
    nullif(trim(p_payload->>'storage'),''),
    nullif(trim(p_payload->>'graphics'),''),
    left(v_equipment_name,80),
    'IMPORT-v1.3.0',
    1,
    coalesce(v_source_date,now()),
    coalesce(v_source_date,now()),
    'Desconocido',
    v_hardware_key,
    'spreadsheet-smart-v1.3.0',
    now(),
    nullif(trim(p_payload->>'source_item_no'),''),
    coalesce(v_source_qty,1),
    coalesce(v_source_unit,1),
    nullif(trim(p_payload->>'source_sheet'),''),
    v_source_row
  )
  returning * into v_existing;

  return jsonb_build_object(
    'ok',true,'action','inserted','inventory_id',v_existing.id,
    'office_id',v_office_id,'equipment_id',v_equipment_id
  );
exception
  when unique_violation then
    return jsonb_build_object('ok',false,'action','duplicate','message','Registro duplicado detectado');
end;
$$;

revoke all on function public.superadmin_import_inventory_row(jsonb) from public;
grant execute on function public.superadmin_import_inventory_row(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;


-- ===== v1.3.1 =====
-- RELEVAMIENTO MANAGER v1.3.1
begin;
create index if not exists inventories_source_sheet_idx on public.inventories(source_sheet);
create index if not exists inventories_source_sheet_office_idx on public.inventories(source_sheet,office_id);
notify pgrst, 'reload schema';
commit;
