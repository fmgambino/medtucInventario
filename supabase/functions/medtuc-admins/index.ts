import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sesión requerida.' }, 401)
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  const caller = authData?.user
  if (authError || !caller) return json({ error: 'Sesión inválida o expirada.' }, 401)

  const { data: callerRole } = await admin.from('admin_users').select('role').eq('user_id', caller.id).maybeSingle()
  if (callerRole?.role !== 'superadmin') return json({ error: 'Solo SuperAdmin puede gestionar administradores.' }, 403)

  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'JSON inválido.' }, 400) }

  if (body.action === 'list') {
    const { data: rows, error } = await admin.from('admin_users').select('user_id,role,display_name,created_at').order('created_at', { ascending: true })
    if (error) return json({ error: error.message }, 500)
    const { data: authList, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listError) return json({ error: listError.message }, 500)
    const emailById = new Map((authList.users || []).map(u => [u.id, u.email || '']))
    return json({ users: (rows || []).map(r => ({ ...r, email: emailById.get(r.user_id) || '' })) })
  }

  if (body.action === 'create') {
    const displayName = String(body.display_name || '').trim().slice(0, 100)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!displayName || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return json({ error: 'Nombre, email o contraseña inválidos.' }, 400)

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, created_by: caller.id }
    })
    if (createError || !created.user) return json({ error: createError?.message || 'No se pudo crear la cuenta.' }, 400)

    const { error: profileError } = await admin.from('admin_users').insert({ user_id: created.user.id, role: 'admin', display_name: displayName })
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return json({ error: profileError.message }, 500)
    }

    return json({ ok: true, user: { id: created.user.id, email, display_name: displayName, role: 'admin' } }, 201)
  }

  return json({ error: 'Acción no soportada.' }, 400)
})
