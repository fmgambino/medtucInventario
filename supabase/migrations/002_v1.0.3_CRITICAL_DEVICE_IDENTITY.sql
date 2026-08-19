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
    digest(
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
