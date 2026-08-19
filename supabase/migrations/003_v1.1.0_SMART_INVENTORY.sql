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
