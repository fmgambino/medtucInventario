import { createClient } from 'npm:@supabase/supabase-js@2'
import JSZip from 'npm:jszip@3.10.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const cleanPath = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '')
const allowedPath = (p: string) => p && !p.includes('..') && !p.startsWith('.git/') && !p.startsWith('.github/workflows/') && !p.endsWith('config.js')

async function sha256Hex(data: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const githubToken = Deno.env.get('GITHUB_TOKEN')
  const owner = Deno.env.get('GITHUB_OWNER') || 'fmgambino'
  const repo = Deno.env.get('GITHUB_REPO') || 'medtucInventario'
  const branch = Deno.env.get('GITHUB_BRANCH') || 'main'
  if (!githubToken) return json({ error: 'Falta configurar el secreto GITHUB_TOKEN en Supabase.' }, 500)

  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sesión requerida.' }, 401)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return json({ error: 'Sesión inválida o expirada.' }, 401)
  const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', user.id).maybeSingle()
  if (roleRow?.role !== 'superadmin') return json({ error: 'Solo SuperAdmin puede instalar actualizaciones.' }, 403)

  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'JSON inválido.' }, 400) }
  if (payload?.action !== 'apply') return json({ error: 'Acción no soportada.' }, 400)
  const patchUrl = String(payload.patch_url || '')
  const fromVersion = String(payload.from_version || '')
  const toVersion = String(payload.to_version || '')
  if (!/^https:\/\//i.test(patchUrl) || !fromVersion || !toVersion) return json({ error: 'Datos de patch incompletos.' }, 400)

  let applied: string[] = []
  try {
    const patchRes = await fetch(patchUrl, { redirect: 'follow' })
    if (!patchRes.ok) throw new Error(`No se pudo descargar el patch: HTTP ${patchRes.status}`)
    const patchBytes = new Uint8Array(await patchRes.arrayBuffer())
    if (payload.sha256) {
      const hash = await sha256Hex(patchBytes)
      if (hash.toLowerCase() !== String(payload.sha256).toLowerCase()) throw new Error('El SHA-256 del patch no coincide.')
    }
    const zip = await JSZip.loadAsync(patchBytes)
    const manifestEntry = zip.file('patch.json')
    if (!manifestEntry) throw new Error('El patch no contiene patch.json.')
    const manifest = JSON.parse(await manifestEntry.async('text'))
    if (manifest.from !== fromVersion || manifest.to !== toVersion) throw new Error('El patch no corresponde a la transición solicitada.')
    const files: string[] = Array.isArray(manifest.files) ? manifest.files : []
    if (!files.length) throw new Error('El patch no contiene archivos para instalar.')

    for (const raw of files) {
      const path = cleanPath(raw)
      if (!allowedPath(path)) throw new Error(`Ruta no permitida en patch: ${path}`)
      const entry = zip.file(`files/${path}`)
      if (!entry) throw new Error(`Falta el archivo files/${path}`)
      const bytes = new Uint8Array(await entry.async('uint8array'))
      const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
      const commonHeaders = {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'MEDTUC-Inventario-Updater',
      }
      const current = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: commonHeaders })
      let sha: string | undefined
      if (current.ok) sha = (await current.json()).sha
      else if (current.status !== 404) throw new Error(`GitHub no pudo leer ${path}: HTTP ${current.status}`)
      const body: any = { message: `MEDTUC update ${fromVersion} -> ${toVersion}: ${path}`, content: bytesToBase64(bytes), branch }
      if (sha) body.sha = sha
      const put = await fetch(api, { method: 'PUT', headers: { ...commonHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!put.ok) {
        const detail = await put.text()
        throw new Error(`GitHub no pudo actualizar ${path}: HTTP ${put.status} ${detail.slice(0, 250)}`)
      }
      applied.push(path)
    }

    await admin.from('update_history').insert({
      from_version: fromVersion, to_version: toVersion, status: 'success', applied_by: user.id,
      applied_by_email: user.email || null, details: { files: applied, patch_url: patchUrl }
    })
    return json({ ok: true, from_version: fromVersion, to_version: toVersion, files_applied: applied.length })
  } catch (e) {
    try {
      await admin.from('update_history').insert({
        from_version: fromVersion || '?', to_version: toVersion || '?', status: 'failed', applied_by: user.id,
        applied_by_email: user.email || null, details: { files_applied: applied, error: String(e?.message || e) }
      })
    } catch {}
    return json({ error: String(e?.message || e), files_applied: applied }, 500)
  }
})
