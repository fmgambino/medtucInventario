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
