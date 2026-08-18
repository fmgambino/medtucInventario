-- MEDTUC Inventario - Migración v0.2.0 -> v0.3.0
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- v0.3.0 elimina cualquier dependencia de Google Sheets: Supabase es la fuente única de datos.

begin;

-- Fortalecer catálogo de administradores: no existen policies INSERT/UPDATE/DELETE para clientes.
-- La creación de administradores se realiza exclusivamente con la Edge Function medtuc-admins,
-- que valida que el usuario autenticado tenga role='superadmin'.
drop policy if exists "admin_insert_admin_users" on public.admin_users;
drop policy if exists "admin_update_admin_users" on public.admin_users;
drop policy if exists "admin_delete_admin_users" on public.admin_users;
drop policy if exists "superadmin_insert_admin_users" on public.admin_users;
drop policy if exists "superadmin_update_admin_users" on public.admin_users;
drop policy if exists "superadmin_delete_admin_users" on public.admin_users;

-- El propio usuario administrador solamente puede leer su perfil para resolver su rol.
drop policy if exists "admin_read_admin_users" on public.admin_users;
create policy "admin_read_admin_users" on public.admin_users
for select to authenticated
using (auth.uid() = user_id);

commit;

-- DESPLIEGUE REQUERIDO:
-- supabase functions deploy medtuc-admins
-- La función utiliza SUPABASE_SERVICE_ROLE_KEY del entorno de Supabase y NO debe exponerse en config.js.
