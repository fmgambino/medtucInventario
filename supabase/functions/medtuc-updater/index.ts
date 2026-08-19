import { createClient } from 'npm:@supabase/supabase-js@2'
import JSZip from 'npm:jszip@3.10.1'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Max-Age':'86400',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json; charset=utf-8'}})
const b64ToBytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0))
const bytesToB64=(a:Uint8Array)=>{let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)}

async function githubPut(path:string,bytes:Uint8Array,token:string,owner:string,repo:string,branch:string,message:string){
  const url=`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}`
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}
  const cur=await fetch(`${url}?ref=${encodeURIComponent(branch)}`,{headers})
  let sha:string|undefined
  if(cur.ok) sha=(await cur.json()).sha
  else if(cur.status!==404) throw new Error(`GitHub GET ${path}: ${cur.status} ${await cur.text()}`)
  const body:any={message,content:bytesToB64(bytes),branch};if(sha)body.sha=sha
  const put=await fetch(url,{method:'PUT',headers,body:JSON.stringify(body)})
  if(!put.ok) throw new Error(`GitHub PUT ${path}: ${put.status} ${await put.text()}`)
}
async function runSQL(sql:string,accessToken:string,projectRef:string){
  const r=await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`,{
    method:'POST',
    headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,read_only:false})
  })
  if(!r.ok) throw new Error(`Migración SQL: HTTP ${r.status} ${await r.text()}`)
  return await r.json().catch(()=>({}))
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders})
  if(req.method!=='POST') return json({error:'Método no permitido'},405)
  try{
    const sbUrl=Deno.env.get('SUPABASE_URL')!
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(sbUrl,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'')
    if(!token)return json({error:'Sesión requerida'},401)
    const {data:ud,error:ue}=await admin.auth.getUser(token)
    if(ue||!ud.user)return json({error:'Sesión inválida o expirada'},401)
    const user=ud.user
    const {data:profile,error:pe}=await admin.from('admin_users').select('role').eq('user_id',user.id).maybeSingle()
    if(pe)return json({error:pe.message},500)
    if(profile?.role!=='superadmin')return json({error:'Solo SuperAdmin puede instalar actualizaciones'},403)

    let body:any={};try{body=await req.json()}catch{return json({error:'JSON inválido'},400)}
    if(body.action==='health')return json({ok:true,function:'medtuc-updater',sql:'management-api'})

    if(body.action!=='install'||!body.zip_base64)return json({error:'Patch requerido'},400)
    const ghToken=Deno.env.get('GITHUB_TOKEN')||''
    const ghOwner=Deno.env.get('GITHUB_OWNER')||'fmgambino'
    const ghRepo=Deno.env.get('GITHUB_REPO')||'medtucInventario'
    const ghBranch=Deno.env.get('GITHUB_BRANCH')||'dev'
    const accessToken=Deno.env.get('SUPABASE_ACCESS_TOKEN')||''
    const projectRef=Deno.env.get('SUPABASE_PROJECT_REF')||''
    if(!ghToken) return json({error:'Falta Secret GITHUB_TOKEN'},500)
    if(!accessToken||!projectRef) return json({error:'Faltan Secrets SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF'},500)

    const zip=await JSZip.loadAsync(b64ToBytes(body.zip_base64))
    const mf=zip.file('patch.json');if(!mf)return json({error:'El ZIP no contiene patch.json'},400)
    const manifest=JSON.parse(await mf.async('text'))
    const from=Array.isArray(manifest.from)?manifest.from:[manifest.from]
    const to=String(manifest.to||'')
    if(!to||!from.length)return json({error:'patch.json incompleto'},400)

    const migrationFiles:Array<string>=Array.isArray(manifest.migrations)?manifest.migrations:[]
    const fileList:Array<string>=Array.isArray(manifest.files)?manifest.files:[]
    if(!fileList.length)return json({error:'El patch no declara archivos'},400)

    const logDetails:any={migrations:[],files:[]}
    try{
      for(const m of migrationFiles){
        const zf=zip.file(m);if(!zf)throw new Error(`Migración no encontrada en ZIP: ${m}`)
        const sql=await zf.async('text')
        await runSQL(sql,accessToken,projectRef)
        logDetails.migrations.push(m)
      }
      for(const p of fileList){
        const zf=zip.file(p);if(!zf)throw new Error(`Archivo no encontrado en ZIP: ${p}`)
        const bytes=new Uint8Array(await zf.async('uint8array'))
        await githubPut(p,bytes,ghToken,ghOwner,ghRepo,ghBranch,`RELEVAMIENTO MANAGER ${from.join('/')} → ${to}: ${p}`)
        logDetails.files.push(p)
      }
      await admin.from('update_history').insert({from_version:from.join(','),to_version:to,status:'success',applied_by:user.id,applied_by_email:user.email,details:logDetails})
      return json({ok:true,from,to,migrations:logDetails.migrations,files:logDetails.files})
    }catch(e){
      await admin.from('update_history').insert({from_version:from.join(','),to_version:to||'?',status:'failed',applied_by:user.id,applied_by_email:user.email,details:{...logDetails,error:e instanceof Error?e.message:String(e)}}).catch(()=>{})
      throw e
    }
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
})
