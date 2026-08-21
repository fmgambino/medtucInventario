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
