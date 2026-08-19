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
    if(!url||!service) return json({error:'Faltan secretos internos de Supabase'},500)
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
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
    if(body.action==='health') return json({ok:true,function:'medtuc-admins',version:'1.0.1'})

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

      // Reutiliza una cuenta Auth existente si un intento anterior quedó a mitad de camino.
      const {data:list,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:1000})
      if(listError) return json({error:listError.message},500)
      let target=(list.users||[]).find(u=>(u.email||'').toLowerCase()===email)
      let createdNow=false
      if(!target){
        const {data:created,error:ce}=await admin.auth.admin.createUser({
          email,password,email_confirm:true,user_metadata:{display_name,created_by:caller.id,created_by_email:caller.email}
        })
        if(ce||!created.user) return json({error:ce?.message||'No se pudo crear la cuenta'},400)
        target=created.user; createdNow=true
      } else {
        const {error:updateError}=await admin.auth.admin.updateUserById(target.id,{password,user_metadata:{...(target.user_metadata||{}),display_name}})
        if(updateError) return json({error:updateError.message},400)
      }

      const {error:ie}=await admin.from('admin_users').upsert({user_id:target.id,role,display_name},{onConflict:'user_id'})
      if(ie){
        if(createdNow) await admin.auth.admin.deleteUser(target.id).catch(()=>{})
        return json({error:ie.message},500)
      }
      return json({ok:true,user:{id:target.id,email,display_name,role}},createdNow?201:200)
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
