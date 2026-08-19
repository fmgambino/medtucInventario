begin;

-- RELEVAMIENTO MANAGER v1.0.1
-- Reparación de gestión administrativa y funciones RPC.

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


notify pgrst, 'reload schema';
commit;
