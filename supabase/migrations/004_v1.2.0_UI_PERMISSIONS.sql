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
