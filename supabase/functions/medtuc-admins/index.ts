import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {
  status, headers: {...corsHeaders,'Content-Type':'application/json; charset=utf-8'}
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:corsHeaders})
  if (req.method !== 'POST') return json({error:'Método no permitido'},405)

  try {
    const url=Deno.env.get('SUPABASE_URL')!
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'')
    if(!token) return json({error:'Sesión requerida'},401)

    const {data:ud,error:ue}=await admin.auth.getUser(token)
    if(ue||!ud.user) return json({error:'Sesión inválida o expirada'},401)
    const caller=ud.user
    const {data:profile,error:pe}=await admin.from('admin_users').select('role').eq('user_id',caller.id).maybeSingle()
    if(pe) return json({error:pe.message},500)
    if(profile?.role!=='superadmin') return json({error:'Solo un SuperAdmin puede gestionar usuarios administrativos'},403)

    let body:any={}
    try{body=await req.json()}catch{return json({error:'JSON inválido'},400)}

    if(body.action==='health') return json({ok:true,function:'medtuc-admins'})

    if(body.action==='list'){
      const {data:rows,error}=await admin.from('admin_users').select('user_id,role,display_name,created_at').order('created_at')
      if(error) return json({error:error.message},500)
      const {data:authList,error:le}=await admin.auth.admin.listUsers({page:1,perPage:1000})
      if(le) return json({error:le.message},500)
      const emails=new Map((authList.users||[]).map(u=>[u.id,u.email||'']))
      return json({users:(rows||[]).map(r=>({...r,email:emails.get(r.user_id)||''}))})
    }

    if(body.action==='create'){
      const display_name=String(body.display_name||'').trim().slice(0,100)
      const email=String(body.email||'').trim().toLowerCase()
      const password=String(body.password||'')
      const role=body.role==='superadmin'?'superadmin':'admin'
      if(!display_name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8)
        return json({error:'Nombre, email o contraseña inválidos. La contraseña debe tener al menos 8 caracteres.'},400)

      const {data:created,error:ce}=await admin.auth.admin.createUser({
        email,password,email_confirm:true,user_metadata:{display_name,created_by:caller.id,created_by_email:caller.email}
      })
      if(ce||!created.user) return json({error:ce?.message||'No se pudo crear la cuenta'},400)

      const {error:ie}=await admin.from('admin_users').insert({user_id:created.user.id,role,display_name})
      if(ie){
        await admin.auth.admin.deleteUser(created.user.id).catch(()=>{})
        return json({error:ie.message},500)
      }
      return json({ok:true,user:{id:created.user.id,email,display_name,role}},201)
    }

    if(body.action==='set-role'){
      const user_id=String(body.user_id||'')
      const role=body.role==='superadmin'?'superadmin':'admin'
      if(!user_id) return json({error:'user_id requerido'},400)
      if(user_id===caller.id&&role!=='superadmin') return json({error:'No podés quitarte tu propio rol SuperAdmin'},400)
      const {error}=await admin.from('admin_users').update({role}).eq('user_id',user_id)
      if(error) return json({error:error.message},500)
      return json({ok:true})
    }

    return json({error:'Acción no soportada'},400)
  } catch(e) {
    return json({error:e instanceof Error?e.message:String(e)},500)
  }
})
