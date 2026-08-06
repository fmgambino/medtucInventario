import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import JSZip from 'npm:jszip@3.10.1'

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const b64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0))
const gh=async(path:string,token:string,owner:string,repo:string,branch:string,content:string,message:string)=>{
  const url=`https://api.github.com/repos/${owner}/${repo}/contents/${path}`
  const h={Authorization:`Bearer ${token}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}
  const cur=await fetch(`${url}?ref=${encodeURIComponent(branch)}`,{headers:h}); let sha:string|undefined
  if(cur.ok)sha=(await cur.json()).sha
  const enc=btoa(unescape(encodeURIComponent(content)))
  const r=await fetch(url,{method:'PUT',headers:h,body:JSON.stringify({message,content:enc,branch,...(sha?{sha}:{})})})
  if(!r.ok)throw new Error(`GitHub ${path}: ${r.status} ${await r.text()}`)
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  try{
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const auth=req.headers.get('Authorization')||''
    const sb=createClient(supabaseUrl,service,{global:{headers:{Authorization:auth}}})
    const token=auth.replace(/^Bearer\s+/i,''); const {data:{user}}=await sb.auth.getUser(token)
    if(!user)return json({error:'No autenticado'},401)
    const {data:adm}=await sb.from('admin_users').select('role').eq('user_id',user.id).maybeSingle()
    if(adm?.role!=='superadmin')return json({error:'Solo SuperAdmin'},403)
    const body=await req.json(); if(body.action!=='apply_zip')return json({error:'Acción no soportada'},400)
    const zip=await JSZip.loadAsync(b64(body.zip_base64||''))
    const owner=Deno.env.get('GITHUB_OWNER')||'fmgambino',repo=Deno.env.get('GITHUB_REPO')||'medtucInventario',branch=Deno.env.get('GITHUB_BRANCH')||'main',ghToken=Deno.env.get('GITHUB_TOKEN')!
    if(!ghToken)return json({error:'Falta configurar GITHUB_TOKEN'},500)
    const allowed=[] as string[]
    for(const [name,entry] of Object.entries(zip.files)){
      if(entry.dir||name.startsWith('supabase/')||/^LEEME/i.test(name)||name.includes('..'))continue
      const content=await entry.async('string'); await gh(name,ghToken,owner,repo,branch,content,`RELEVAMIENTO MANAGER ${body.to_version||''}: ${name}`); allowed.push(name)
    }
    await sb.from('update_history').insert({from_version:body.from_version||'',to_version:body.to_version||'',status:'success',applied_by:user.id,applied_by_email:user.email,details:{files:allowed,file_name:body.file_name}})
    return json({ok:true,files:allowed})
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
})
