(() => {
'use strict';
const APP_VERSION='1.3.1';
const C=window.MEDTUC_CONFIG||{};
const configured=Boolean(C.SUPABASE_URL&&C.SUPABASE_ANON_KEY);
const sb=configured?window.supabase.createClient(C.SUPABASE_URL.replace(/\/$/,''),C.SUPABASE_ANON_KEY):null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={page:0,size:10,filter:'',rows:[],total:0,user:null,role:null,selected:new Set(),poll:null,patch:null,settings:null,manifestObjectUrl:null,collectorToken:null,filters:{office:'',status:'',license:'',ram:'',tag:'',group:''},tags:[],importRows:[],importMap:{},importWorkbook:null,importCandidates:[],importSheet:null,importMeta:{},sourceView:'all',sourceSheets:[],sourceCounts:{},exportScope:'current'};
const swal={background:'#101827',color:'#edf4ff',confirmButtonColor:'#6ca8ff',cancelButtonColor:'#65758a'};
const msg=(icon,title,text='')=>Swal.fire({...swal,icon,title,text,confirmButtonText:'Aceptar'});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=v=>String(v??'').trim().slice(0,120);
const fmt=v=>v?new Date(v).toLocaleString('es-AR'):'—';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function switchView(id){$$('.view').forEach(v=>v.classList.remove('active'));$(id).classList.add('active');scrollTo({top:0,behavior:'smooth'})}
function setConnection(){
 const badge=$('#connectionBadge'); if(!badge)return;
 badge.textContent=configured?'● Supabase configurado':'● Falta configurar Supabase';
 badge.style.color=configured?'#69d6a5':'#ffd27d';
}
function isSuper(){return state.role==='superadmin'}

async function loadSettings(){
 if(!sb)return;
 const {data}=await sb.from('app_settings').select('*').eq('id',1).maybeSingle();
 state.settings=data||{};
 const appName=data?.app_name||'RELEVAMIENTO MANAGER', short=data?.short_name||'MEDTUC';
 $('#brandTitle').textContent=appName; document.title=appName;
 $('#settingAppName').value=appName; $('#settingShortName').value=short;
 const fav=data?.favicon_url||'assets/icons/favicon.svg';
 const pwa=data?.pwa_icon_url||'assets/icons/logo.svg';
 $('#appFavicon').href=fav; $('#faviconPreview').src=fav; $('#pwaIconPreview').src=pwa;
 applyDynamicManifest(appName,short,pwa);
}
function applyDynamicManifest(name,shortName,icon){
 try{
   const base=new URL(C.PROJECT_URL||location.href,location.href);
   const startUrl=base.href.endsWith('/')?base.href:base.href.replace(/[^/]*$/,'');
   const iconUrl=new URL(icon,startUrl).href;
   const m={name,short_name:shortName,display:'standalone',background_color:'#08111f',theme_color:'#08111f',
     icons:[{src:iconUrl,sizes:'192x192',purpose:'any'},{src:iconUrl,sizes:'512x512',purpose:'any maskable'}]};
   const blob=new Blob([JSON.stringify(m)],{type:'application/manifest+json'});
   if(state.manifestObjectUrl)URL.revokeObjectURL(state.manifestObjectUrl);
   state.manifestObjectUrl=URL.createObjectURL(blob); $('#manifestLink').href=state.manifestObjectUrl;
 }catch(e){console.warn('No se pudo actualizar manifest dinámico',e)}
}
async function uploadBranding(file,prefix){
 if(!file)return null;
 const ext=(file.name.split('.').pop()||'png').toLowerCase();
 const path=`${prefix}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
 const {error}=await sb.storage.from('branding').upload(path,file,{upsert:false,cacheControl:'3600'});
 if(error)throw error;
 return sb.storage.from('branding').getPublicUrl(path).data.publicUrl;
}
async function saveBranding(){
 try{
  const app_name=clean($('#settingAppName').value)||'RELEVAMIENTO MANAGER';
  const short_name=clean($('#settingShortName').value)||'MEDTUC';
  let favicon_url=state.settings?.favicon_url||null,pwa_icon_url=state.settings?.pwa_icon_url||null;
  if($('#faviconFile').files[0])favicon_url=await uploadBranding($('#faviconFile').files[0],'favicon');
  if($('#pwaIconFile').files[0])pwa_icon_url=await uploadBranding($('#pwaIconFile').files[0],'pwa');
  const {error}=await sb.from('app_settings').upsert({id:1,app_name,short_name,favicon_url,pwa_icon_url,updated_by:state.user.id,updated_at:new Date().toISOString()});
  if(error)throw error;
  await loadSettings();msg('success','Identidad actualizada','El favicon y el icono de instalación fueron guardados.');
 }catch(e){msg('error','No se pudo guardar',e.message)}
}

async function loadCatalogs(){
 if(!sb)return;
 const [{data:o,error:oe},{data:e,error:ee}]=await Promise.all([
  sb.from('offices').select('id,name').order('name'),
  sb.from('equipment_names').select('id,office_id,name').order('name')
 ]);
 if(oe||ee)return msg('error','No se pudo cargar el catálogo',(oe||ee).message);
 $('#officeSelect').innerHTML='<option value="">Seleccionar...</option>'+o.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
 $('#officeSelect').dataset.items=JSON.stringify(o); $('#equipmentSelect').dataset.items=JSON.stringify(e); renderEquipment();
 const fo=$('#filterOffice'); if(fo)fo.innerHTML='<option value="">Todas las oficinas</option>'+o.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
 if(isSuper()&&$('#officesAdminBody')) renderOfficesAdmin(o,e);
}
function renderEquipment(){
 const oid=$('#officeSelect').value;let items=[];try{items=JSON.parse($('#equipmentSelect').dataset.items||'[]')}catch{}
 items=items.filter(x=>!oid||x.office_id===oid);
 $('#equipmentSelect').innerHTML='<option value="">Seleccionar...</option>'+items.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
}
async function createCatalog(type){
 if(!sb)return;
 const oid=$('#officeSelect').value;if(type==='equipment'&&!oid)return msg('warning','Primero seleccioná una oficina');
 const {value}=await Swal.fire({...swal,title:type==='office'?'Nueva oficina':'Nuevo equipo',input:'text',showCancelButton:true,confirmButtonText:'Crear',cancelButtonText:'Cancelar',inputValidator:v=>clean(v).length<1?'Ingresá un nombre':undefined});
 if(!value)return;
 const payload=type==='office'?{name:clean(value)}:{office_id:oid,name:clean(value)};
 const table=type==='office'?'offices':'equipment_names';
 const {error}=await sb.from(table).insert(payload);if(error)return msg('error','No se pudo crear',error.message);
 await loadCatalogs();msg('success','Creado correctamente');
}

function psQuote(v){return String(v??'').replace(/'/g,"''")}
function collectorPS(officeId,equipmentId,officeName,equipmentName,submissionToken){
 const endpoint=C.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/register_inventory';
 return `$ErrorActionPreference = 'Stop'\r\n`+
`$SupabaseEndpoint='${psQuote(endpoint)}'\r\n$AnonKey='${psQuote(C.SUPABASE_ANON_KEY)}'\r\n$OfficeId='${psQuote(officeId)}'\r\n$EquipmentId='${psQuote(equipmentId)}'\r\n$OfficeName='${psQuote(officeName)}'\r\n$EquipmentName='${psQuote(equipmentName)}'\r\n$SubmissionToken='${psQuote(submissionToken)}'\r\n`+
`function CleanValue { param([object]$Value,[string]$Fallback='No detectado'); if($null -eq $Value){return $Fallback}; $Text=([string]$Value).Trim(); if([string]::IsNullOrEmpty($Text)){return $Fallback}; return $Text }\r\n`+
`try {\r\n  try {[Net.ServicePointManager]::SecurityProtocol = [Enum]::ToObject([Net.SecurityProtocolType],3072)} catch {}\r\n`+
`  Write-Host ''\r\n  Write-Host '============================================================' -ForegroundColor DarkCyan\r\n  Write-Host ' RELEVAMIENTO MANAGER - RECOPILADOR v${APP_VERSION}' -ForegroundColor Cyan\r\n  Write-Host ' Direccion de Informatica - Ministerio de Educacion Tucuman' -ForegroundColor Gray\r\n  Write-Host '============================================================' -ForegroundColor DarkCyan\r\n  Write-Host 'Recopilando datos del equipo...' -ForegroundColor White\r\n`+
`  $cs=Get-WmiObject -Class Win32_ComputerSystem | Select-Object -First 1\r\n  $csp=Get-WmiObject -Class Win32_ComputerSystemProduct | Select-Object -First 1\r\n  $cpu=Get-WmiObject -Class Win32_Processor | Select-Object -First 1\r\n  $os=Get-WmiObject -Class Win32_OperatingSystem | Select-Object -First 1\r\n  $board=Get-WmiObject -Class Win32_BaseBoard | Select-Object -First 1\r\n  $bios=Get-WmiObject -Class Win32_BIOS | Select-Object -First 1\r\n  $gpu=Get-WmiObject -Class Win32_VideoController | Where-Object {$_.Name} | Select-Object -First 1\r\n  $disks=@(Get-WmiObject -Class Win32_DiskDrive | Where-Object {[double]$_.Size -gt 0})\r\n  $rams=@(Get-WmiObject -Class Win32_PhysicalMemory)\r\n`+
`  $ramBytes=($rams | Measure-Object -Property Capacity -Sum).Sum\r\n  if(-not $ramBytes){$ramBytes=$cs.TotalPhysicalMemory}\r\n  $ramGB=[math]::Round(([double]$ramBytes/1GB),0)\r\n  $memMap=@{20='DDR';21='DDR2';22='DDR2 FB-DIMM';24='DDR3';26='DDR4';34='DDR5'}\r\n  $ramTypes=@()\r\n  foreach($mem in $rams){$typeCode=0; if($mem.PSObject.Properties['SMBIOSMemoryType']){$typeCode=[int]$mem.SMBIOSMemoryType}; if($memMap.ContainsKey($typeCode)){$ramTypes+=$memMap[$typeCode]} elseif($mem.MemoryType -and $memMap.ContainsKey([int]$mem.MemoryType)){$ramTypes+=$memMap[[int]$mem.MemoryType]}}\r\n  $ramType=if($ramTypes.Count -gt 0){($ramTypes | Select-Object -Unique) -join ', '}else{'No detectado'}\r\n`+
`  $storageParts=@(); foreach($disk in $disks){$gb=[math]::Round(([double]$disk.Size/1GB),0);$diskModel=CleanValue -Value $disk.Model;$kind='HDD';if(($disk.MediaType -match 'SSD|Solid') -or ($diskModel -match 'SSD|Solid')){$kind='SSD'}elseif($disk.InterfaceType -match 'USB'){$kind='USB'};$storageParts+=("{0} GB ({1}) {2}" -f $gb,$kind,$diskModel)}\r\n  $storage=if($storageParts.Count -gt 0){$storageParts -join ' + '}else{'No detectado'}\r\n  $fullName=$env:COMPUTERNAME; if($cs.Domain -and $cs.Domain -ne 'WORKGROUP' -and $cs.Domain -ne $env:COMPUTERNAME){$fullName="$($env:COMPUTERNAME).$($cs.Domain)"}\r\n  $installDate=''; try{$installDate=[Management.ManagementDateTimeConverter]::ToDateTime($os.InstallDate).ToString('yyyy-MM-dd HH:mm:ss')}catch{}\r\n`+
`  $cv='HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';$displayVersion='';$windowsProductId='';try{$reg=Get-ItemProperty -Path $cv;$displayVersion=if($reg.DisplayVersion){$reg.DisplayVersion}elseif($reg.ReleaseId){$reg.ReleaseId}else{''};$windowsProductId=$reg.ProductId}catch{}\r\n  $arch=CleanValue -Value $os.OSArchitecture; if($arch -eq 'No detectado'){if([IntPtr]::Size -eq 8){$arch='64 bits'}else{$arch='32 bits'}}\r\n`+
`  $licenseStatus='Desconocido';$licenseChannel='No detectado';$partialKey='';$oemKey=''\r\n  try {$lic=Get-WmiObject -Class SoftwareLicensingProduct | Where-Object {$_.PartialProductKey -and $_.Name -match 'Windows'} | Sort-Object LicenseStatus -Descending | Select-Object -First 1; if($lic){if([int]$lic.LicenseStatus -eq 1){$licenseStatus='Licenciado'}else{$licenseStatus='No licenciado'};$partialKey=CleanValue -Value $lic.PartialProductKey -Fallback '';$licenseChannel=CleanValue -Value $lic.Description}} catch {}\r\n  try {$svc=Get-WmiObject -Class SoftwareLicensingService | Select-Object -First 1; if($svc -and $svc.PSObject.Properties['OA3xOriginalProductKey']){$oemKey=CleanValue -Value $svc.OA3xOriginalProductKey -Fallback ''}} catch {}\r\n`+
`  $boardManufacturer=CleanValue -Value $board.Manufacturer -Fallback ''\r\n  $boardProduct=CleanValue -Value $board.Product -Fallback ''\r\n  $motherboard=("{0} {1}" -f $boardManufacturer,$boardProduct).Trim(); if([string]::IsNullOrEmpty($motherboard)){$motherboard='No detectado'}\r\n`+
`  $payload=@{\r\n    office_id=$OfficeId; equipment_id=$EquipmentId; office_name=$OfficeName; equipment_name=$EquipmentName; submission_token=$SubmissionToken;\r\n    brand=(CleanValue -Value $cs.Manufacturer); model=(CleanValue -Value $cs.Model); processor=(CleanValue -Value $cpu.Name); cores=[int]$cpu.NumberOfCores;\r\n    operating_system=("{0} ({1})" -f (CleanValue -Value $os.Caption),$arch); windows_version=(CleanValue -Value $displayVersion); windows_build=(CleanValue -Value $os.BuildNumber); windows_install_date=(CleanValue -Value $installDate);\r\n    motherboard=$motherboard; ram_gb=[int]$ramGB; ram_type=$ramType; storage=$storage; graphics=(CleanValue -Value $gpu.Name);\r\n    hostname=$env:COMPUTERNAME; full_device_name=$fullName; domain_workgroup=(CleanValue -Value $cs.Domain); system_type=(CleanValue -Value $cs.SystemType);\r\n    device_uuid=(CleanValue -Value $csp.UUID); product_id=(CleanValue -Value $windowsProductId); bios_serial=(CleanValue -Value $bios.SerialNumber); bios_version=(CleanValue -Value (($bios.SMBIOSBIOSVersion -join ' ')));\r\n    windows_license_status=$licenseStatus; windows_license_channel=$licenseChannel; windows_partial_product_key=$partialKey; windows_oem_key=$oemKey; collector_version='${APP_VERSION}'\r\n  }\r\n`+
`  Add-Type -AssemblyName System.Web.Extensions\r\n  $serializer=New-Object System.Web.Script.Serialization.JavaScriptSerializer\r\n  $request=@{p_payload=$payload}\r\n  $json=$serializer.Serialize($request)\r\n  $wc=New-Object System.Net.WebClient\r\n  $wc.Encoding=[Text.Encoding]::UTF8\r\n  $wc.Headers.Add('apikey',$AnonKey)\r\n  $wc.Headers.Add('Authorization',('Bearer '+$AnonKey))\r\n  $wc.Headers.Add('Content-Type','application/json')\r\n  $result=$wc.UploadString($SupabaseEndpoint,'POST',$json)\r\n`+
`  Write-Host ''\r\n  if($result -match '"already_registered"\\s*:\\s*true'){\r\n    Write-Host 'INVENTARIO YA COMPLETADO.' -ForegroundColor Green\r\n    Write-Host 'Este equipo ya fue relevado correctamente 3 veces y ya se encuentra cargado al inventario principal de la Direccion de Informatica - Ministerio de Educacion Tucuman.' -ForegroundColor Yellow\r\n  } else {\r\n    $attempt=''; if($result -match '"attempt_count"\\s*:\\s*(\\d+)'){$attempt=$matches[1]}\r\n    Write-Host 'OK - Datos guardados correctamente.' -ForegroundColor Green\r\n    if($attempt){Write-Host ('Ejecucion registrada: '+$attempt+' de 3.') -ForegroundColor Cyan}\r\n    Write-Host ('Equipo: '+$EquipmentName+' | Oficina: '+$OfficeName) -ForegroundColor Gray\r\n  }\r\n`+
`  Write-Host ''\r\n  Write-Host 'RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina' -ForegroundColor DarkGray\r\n  Write-Host 'by Ing. Fernando Gambino - https://github.com/fmgambino - Todos los Derechos Registrados' -ForegroundColor DarkGray\r\n  Read-Host 'Presione ENTER para cerrar'\r\n  exit 0\r\n`+
`} catch {\r\n  Write-Host ''\r\n  Write-Host ('ERROR: '+$_.Exception.Message) -ForegroundColor Red\r\n  Write-Host 'Verifique la conexion a Internet e intente nuevamente.' -ForegroundColor Yellow\r\n  Write-Host ''\r\n  Write-Host 'RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina' -ForegroundColor DarkGray\r\n  Write-Host 'by Ing. Fernando Gambino - https://github.com/fmgambino - Todos los Derechos Registrados' -ForegroundColor DarkGray\r\n  Read-Host 'Presione ENTER para cerrar'\r\n  exit 1\r\n}\r\n`;
}
function utf8BomBase64(text){const bytes=new TextEncoder().encode('\uFEFF'+text);let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin)}
function buildBat(ps,name){
 const b64=utf8BomBase64(ps),chunks=b64.match(/.{1,700}/g)||[],safeName=name.replace(/[&|<>^%]/g,'');
 return ['@echo off','setlocal EnableExtensions','chcp 65001 >nul','title RELEVAMIENTO MANAGER - Registro de equipo','echo.','echo ============================================================','echo  RELEVAMIENTO MANAGER - Direccion de Informatica','echo  Ministerio de Educacion Tucuman','echo ============================================================',`echo  Preparando recopilador para ${safeName}`,'echo.','set "B64=%TEMP%\\medtuc_collector_%RANDOM%.b64"','set "PS1=%TEMP%\\medtuc_collector_%RANDOM%.ps1"','break>"%B64%"',...chunks.map(c=>`>>"%B64%" echo ${c}`),`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$b=[IO.File]::ReadAllText($env:B64).Replace([Environment]::NewLine,'').Replace(' ','');[IO.File]::WriteAllBytes($env:PS1,[Convert]::FromBase64String($b)); & $env:PS1; exit $LASTEXITCODE"`,'set "RC=%ERRORLEVEL%"','del /q "%B64%" "%PS1%" >nul 2>&1','echo.','echo RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina','echo by Ing. Fernando Gambino - https://github.com/fmgambino - Todos los Derechos Registrados','if not "%RC%"=="0" (echo. & echo El recopilador finalizo con errores. & pause)','exit /b %RC%'].join('\r\n')+'\r\n';
}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
async function getSubmissionStatus(token){
 const {data,error}=await sb.rpc('inventory_submission_status',{p_submission_token:token});
 if(error)throw error;
 return Array.isArray(data)?data[0]:data;
}
function setPollVisual(mode,title,text){
 const card=$('#pollCard'); if(!card)return;
 card.classList.remove('hidden');
 const icon=card.querySelector('.spinner,.poll-success,.poll-warning');
 if(icon){
   icon.className=mode==='success'?'poll-success':mode==='warning'?'poll-warning':'spinner';
   icon.textContent=mode==='success'?'✓':mode==='warning'?'!':'';
 }
 $('#pollTitle').textContent=title;
 $('#pollText').textContent=text;
}
function inventoryProcessStatus(count){
 const n=Number(count||0);
 if(n>=3)return ['ok','Completo'];
 if(n===2)return ['info','Actualizado'];
 if(n===1)return ['ok','Registrado'];
 return ['warn','Pendiente'];
}
async function downloadCollector(){
 const oid=$('#officeSelect').value,eid=$('#equipmentSelect').value;
 if(!oid||!eid)return msg('warning','Faltan datos','Seleccioná oficina y equipo.');
 const on=$('#officeSelect').selectedOptions[0].textContent,en=$('#equipmentSelect').selectedOptions[0].textContent;
 const token=crypto.randomUUID();
 state.collectorToken=token;

 const ps=collectorPS(oid,eid,on,en,token),bat=buildBat(ps,en),fn='MEDTUC_'+en.replace(/[^\w.-]+/g,'_')+'.bat';
 downloadBlob(new Blob([bat],{type:'application/x-bat;charset=utf-8'}),fn);

 setPollVisual('waiting','Esperando datos del equipo...',`Ejecutá ${fn} con doble clic. El sistema identificará físicamente esta PC y confirmará la carga.`);
 Swal.fire({...swal,title:'Esperando relevamiento...',html:`<b>${esc(en)}</b><br><br>Ejecutá <b>${esc(fn)}</b> con doble clic.<br>Esta ventana se cerrará automáticamente cuando Supabase confirme la carga.`,allowOutsideClick:false,allowEscapeKey:true,showCancelButton:true,showConfirmButton:false,cancelButtonText:'Cerrar espera',didOpen:()=>Swal.showLoading()});

 if(state.poll)clearInterval(state.poll);
 const started=Date.now();
 state.poll=setInterval(async()=>{try{
   const r=await getSubmissionStatus(token);
   if(r?.exists){
     clearInterval(state.poll);state.poll=null;Swal.close();
     const count=Number(r.submission_count||0);
     const result=String(r.submission_result||'').toLowerCase();

     if(result==='already_completed'){
       setPollVisual('success','Relevamiento ya completado',`Este equipo ya había alcanzado el máximo de 3 relevamientos.`);
       if(state.user)await loadInventory();
       await msg('success','Equipo ya relevado',`Este equipo ya se encontraba completo (3/3) en el inventario principal.`);
       return;
     }

     const title=result==='completed'?'Relevamiento completado':result==='updated'?'Equipo actualizado correctamente':'Equipo registrado correctamente';
     setPollVisual('success',title,`Registro confirmado. Ejecución ${count} de 3.`);
     if(state.user)await loadInventory();
     await msg('success','Carga finalizada correctamente',`El equipo ${en} fue guardado en el inventario principal (${count}/3).`);
     return;
   }

   if(Date.now()-started>10*60*1000){
     clearInterval(state.poll);state.poll=null;Swal.close();
     setPollVisual('warning','No se confirmó una nueva carga','Podés volver a ejecutar el recopilador. No se registró una nueva ejecución.');
     await msg('warning','Tiempo de espera agotado','No se confirmó una carga en 10 minutos. Podés volver a ejecutar el recopilador.');
   }
 }catch(e){console.warn('Polling de inventario',e)}},2500);
}

async function openAdmin(){switchView('#adminView');if(sb){const {data}=await sb.auth.getSession();if(data.session)await hydrateSession(data.session)}}
async function login(ev){ev.preventDefault();const email=$('#adminEmail').value.trim(),password=$('#adminPassword').value;const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)return msg('error','No se pudo ingresar',error.message);await hydrateSession(data.session)}
async function hydrateSession(session){
 state.user=session.user;
 const {data,error}=await sb.from('admin_users').select('role,display_name').eq('user_id',state.user.id).maybeSingle();
 if(error||!data){await sb.auth.signOut();return msg('error','Acceso denegado','Este usuario no tiene permisos administrativos.')}
 state.role=data.role;$('#loginCard').classList.add('hidden');$('#adminPanel').classList.remove('hidden');$('#logoutBtn').classList.remove('hidden');$('#roleChip').textContent=isSuper()?'SuperAdmin':'Administrador';
 $$('.super-only').forEach(x=>x.classList.toggle('hidden',!isSuper()));await loadTags();await loadRamOptions();await loadSourceSheets();await loadInventory();if(isSuper()){await loadAdmins();await loadSettings();await loadHistory();await loadOfficesAdmin()}
}
async function logout(){await sb.auth.signOut();state.user=null;state.role=null;$('#adminPanel').classList.add('hidden');$('#loginCard').classList.remove('hidden');$('#logoutBtn').classList.add('hidden')}
function switchTab(name){$$('.admin-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.admin-section').forEach(s=>s.classList.toggle('active',s.dataset.section===name));if(name==='inventory'){loadSourceSheets();loadInventory()}if(name==='admins')loadAdmins();if(name==='settings'){loadSettings();loadHistory()}}
function switchSetting(name){$$('.settings-item').forEach(b=>b.classList.toggle('active',b.dataset.setting===name));$$('.settings-pane').forEach(p=>p.classList.toggle('active',p.dataset.pane===name));if(name==='offices')loadOfficesAdmin()}


async function loadTags(){
 if(!state.user)return;
 const {data,error}=await sb.from('tags').select('*').order('name');
 if(error){console.warn('tags',error);return}
 state.tags=data||[];
 const ft=$('#filterTag'); if(ft)ft.innerHTML='<option value="">Todas las etiquetas</option>'+state.tags.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
}
async function loadRamOptions(){
 if(!state.user)return;
 const {data}=await sb.from('inventories').select('ram_gb').not('ram_gb','is',null);
 const vals=[...new Set((data||[]).map(x=>Number(x.ram_gb)).filter(Boolean))].sort((a,b)=>a-b);
 const el=$('#filterRam'); if(el)el.innerHTML='<option value="">Toda RAM</option>'+vals.map(v=>`<option value="${v}">${v} GB</option>`).join('');
}
async function resolveTagInventoryIds(tagId){
 if(!tagId)return null;
 const {data,error}=await sb.from('inventory_tags').select('inventory_id').eq('tag_id',tagId);
 if(error)throw error;
 return (data||[]).map(x=>x.inventory_id);
}
function applyInventoryFilters(q,ids){
 const f=state.filters;
 if(f.office)q=q.eq('office_id',f.office);
 if(f.status)q=q.eq('submission_count',Number(f.status));
 if(f.license)q=q.eq('windows_license_status',f.license);
 if(f.ram)q=q.eq('ram_gb',Number(f.ram));
 if(ids)q=ids.length?q.in('id',ids):q.eq('id','00000000-0000-0000-0000-000000000000');
 const txt=state.filter.trim();
 if(txt){const s=txt.replace(/[%(),]/g,' ');q=q.or(`office_name.ilike.%${s}%,equipment_name.ilike.%${s}%,brand.ilike.%${s}%,model.ilike.%${s}%,processor.ilike.%${s}%,operating_system.ilike.%${s}%,hostname.ilike.%${s}%`)}
 return q;
}

function sourceDisplayName(v){return v||'Relevamiento automático'}
function sourceSlug(v){return String(v||'automatico').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'inventario'}
function applySourceFilter(q,override){
 const s=override===undefined?state.sourceView:override;
 if(!s||s==='all')return q;
 return s==='__automatic__'?q.is('source_sheet',null):q.eq('source_sheet',s);
}
async function loadSourceSheets(){
 if(!state.user)return;
 const {data,error}=await sb.from('inventories').select('source_sheet');
 if(error){console.warn('source sheets',error);return}
 const counts={all:(data||[]).length,__automatic__:0};
 (data||[]).forEach(r=>{const k=r.source_sheet||'__automatic__';counts[k]=(counts[k]||0)+1});
 const preferred=['Inventario Actual','Inventario a solicitar','Equipos a Actualizar'];
 const found=Object.keys(counts).filter(k=>!['all','__automatic__'].includes(k));
 state.sourceSheets=[...preferred.filter(s=>found.includes(s)),...found.filter(s=>!preferred.includes(s)).sort((a,b)=>a.localeCompare(b,'es'))];
 state.sourceCounts=counts;
 renderSourceTabs();
}
function renderSourceTabs(){
 const el=$('#sourceSheetTabs');if(!el)return;
 const items=[
  {key:'all',label:'Todos',count:state.sourceCounts.all||0},
  ...state.sourceSheets.map(s=>({key:s,label:s,count:state.sourceCounts[s]||0})),
  ...(state.sourceCounts.__automatic__?[{key:'__automatic__',label:'Relevamiento automático',count:state.sourceCounts.__automatic__}]:[])
 ];
 if(!items.some(x=>x.key===state.sourceView))state.sourceView='all';
 el.innerHTML=items.map(x=>`<button type="button" class="source-sheet-tab ${x.key===state.sourceView?'active':''}" data-source-sheet="${esc(x.key)}"><span>${esc(x.label)}</span><b>${x.count}</b></button>`).join('');
 const cur=items.find(x=>x.key===state.sourceView);
 if($('#sourceSheetSummary'))$('#sourceSheetSummary').textContent=cur?`${cur.label} · ${cur.count} equipo${cur.count===1?'':'s'}`:'Todos los registros';
}
async function changeSourceView(v){
 state.sourceView=v||'all';state.page=0;state.selected.clear();renderSourceTabs();await loadInventory();
}

async function fetchFilteredInventory(paged=true,sourceOverride=undefined){
 const tagIds=await resolveTagInventoryIds(state.filters.tag);
 let q=sb.from('inventories').select('*,inventory_tags(tag_id,tags(id,name,color))',{count:paged?'exact':undefined}).order('last_submitted_at',{ascending:false});
 q=applyInventoryFilters(q,tagIds);
 q=applySourceFilter(q,sourceOverride);
 if(paged)q=q.range(state.page*state.size,state.page*state.size+state.size-1);
 return await q;
}
function rowTags(r){
 return (r.inventory_tags||[]).map(x=>x.tags).filter(Boolean);
}
function renderTags(r){
 const tags=rowTags(r); if(!tags.length)return '<span class="muted">—</span>';
 return `<div class="tag-list">${tags.map(t=>`<span class="tag-chip" style="--tag-color:${esc(t.color||'#7aa7ff')}"><i class="tag-dot"></i>${esc(t.name)}</span>`).join('')}</div>`;
}
function groupLabel(field,row){
 if(field==='submission_count')return inventoryProcessStatus(row.submission_count)[1];
 if(field==='ram_gb')return row.ram_gb?`${row.ram_gb} GB`:'Sin dato';
 if(field==='tags'){const t=rowTags(row);return t.length?t.map(x=>x.name):['Sin etiqueta']}
 return row[field]||'Sin dato';
}
async function updateGroupSummary(){
 const el=$('#groupSummary'),countEl=$('#filteredCount'); if(!el||!countEl)return;
 try{
  const {data,error}=await fetchFilteredInventory(false); if(error)throw error;
  const rows=data||[]; countEl.textContent=`${rows.length} resultado${rows.length===1?'':'s'}`;
  const g=state.filters.group;
  if(!g){el.innerHTML='';return}
  const m=new Map();
  rows.forEach(r=>{const labs=[groupLabel(g,r)].flat();labs.forEach(l=>m.set(l,(m.get(l)||0)+1))});
  el.innerHTML=[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="group-chip">${esc(k)} <b>${v}</b></span>`).join('');
 }catch(e){console.warn('group summary',e)}
}
async function createTag(){
 const {value:v}=await Swal.fire({
   ...swal,
   title:'Nueva etiqueta',
   html:`
     <div class="tag-create-form">
       <div class="edit-field">
         <label for="tagName">Nombre</label>
         <input id="tagName" class="swal2-input" maxlength="40" autocomplete="off" placeholder="Ej.: Administración">
       </div>
       <div class="edit-field">
         <label for="tagColor">Color</label>
         <div class="tag-color-row">
           <input id="tagColor" type="color" value="#6ca8ff">
           <span id="tagColorPreview" class="tag-chip tag-preview" style="--tag-color:#6ca8ff"><i class="tag-dot"></i>Vista previa</span>
         </div>
       </div>
     </div>`,
   showCancelButton:true,
   confirmButtonText:'Crear etiqueta',
   cancelButtonText:'Cancelar',
   focusConfirm:false,
   didOpen:()=>{
     const color=$('#tagColor'),preview=$('#tagColorPreview');
     color?.addEventListener('input',()=>preview?.style.setProperty('--tag-color',color.value));
     setTimeout(()=>$('#tagName')?.focus(),50);
   },
   preConfirm:()=>{
     const name=clean($('#tagName').value).replace(/\s+/g,' ').trim();
     if(!name){Swal.showValidationMessage('Ingresá un nombre para la etiqueta.');return false}
     if(name.length>40){Swal.showValidationMessage('El nombre no puede superar 40 caracteres.');return false}
     return {name,color:$('#tagColor').value};
   }
 });
 if(!v)return;

 const normalized=v.name.toLocaleLowerCase('es-AR');
 const existing=(state.tags||[]).find(t=>(t.name||'').trim().toLocaleLowerCase('es-AR')===normalized);
 if(existing){
   await msg('info','La etiqueta ya existe',`Ya existe la etiqueta "${existing.name}". Podés seleccionarla directamente en Editar o Etiquetar seleccionados.`);
   return existing;
 }

 const {data,error}=await sb.from('tags')
   .insert({name:v.name,color:v.color,created_by:state.user.id})
   .select()
   .single();

 if(error){
   if(error.code==='23505'||/tags_name_lower_uidx|duplicate key/i.test(error.message||'')){
     await loadTags();
     const found=(state.tags||[]).find(t=>(t.name||'').trim().toLocaleLowerCase('es-AR')===normalized);
     return msg('info','La etiqueta ya existe',found?`Ya existe "${found.name}".`:'Ya existe una etiqueta con ese nombre.');
   }
   return msg('error','No se pudo crear',error.message);
 }

 await loadTags();
 await msg('success','Etiqueta creada',data?.name||v.name);
 return data;
}
async function assignTag(){
 if(!state.selected.size)return msg('warning','Sin selección','Seleccioná uno o más equipos.');
 if(!state.tags.length)return msg('info','No hay etiquetas','Creá una etiqueta primero.');
 const opts=Object.fromEntries(state.tags.map(t=>[t.id,t.name]));
 const {value:tagId}=await Swal.fire({...swal,title:'Etiquetar seleccionados',input:'select',inputOptions:opts,showCancelButton:true,confirmButtonText:'Aplicar',cancelButtonText:'Cancelar'});
 if(!tagId)return;
 const payload=[...state.selected].map(id=>({inventory_id:id,tag_id:tagId,created_by:state.user.id}));
 const {error}=await sb.from('inventory_tags').upsert(payload,{onConflict:'inventory_id,tag_id'});if(error)return msg('error','No se pudo etiquetar',error.message);
 await loadInventory();msg('success','Etiqueta aplicada',`${payload.length} equipo(s).`);
}
function renderOfficesAdmin(offices,equipment){
 if(!$('#officesAdminBody'))return;
 const invCounts={};state.rows.forEach(r=>{if(r.office_id)invCounts[r.office_id]=(invCounts[r.office_id]||0)+1});
 $('#officesAdminBody').innerHTML=(offices||[]).map(o=>`<tr><td class="office-name-cell">${esc(o.name)}</td><td>${equipment.filter(e=>e.office_id===o.id).length}</td><td>${invCounts[o.id]||'—'}</td><td><button class="action-btn edit-office" data-id="${o.id}" title="Editar">${editSvg}</button></td></tr>`).join('')||'<tr><td colspan="4">Sin oficinas.</td></tr>';
}
async function loadOfficesAdmin(){
 if(!isSuper())return;
 const [{data:o,error:oe},{data:e,error:ee},{data:i,error:ie}]=await Promise.all([
  sb.from('offices').select('id,name').order('name'),
  sb.from('equipment_names').select('id,office_id'),
  sb.from('inventories').select('office_id')
 ]);
 if(oe||ee||ie)return msg('error','No se pudo cargar oficinas',(oe||ee||ie).message);
 const counts={};(i||[]).forEach(r=>{if(r.office_id)counts[r.office_id]=(counts[r.office_id]||0)+1});
 $('#officesAdminBody').innerHTML=(o||[]).map(x=>`<tr><td class="office-name-cell">${esc(x.name)}</td><td>${(e||[]).filter(y=>y.office_id===x.id).length}</td><td>${counts[x.id]||0}</td><td><button class="action-btn edit-office" data-id="${x.id}" title="Editar">${editSvg}</button></td></tr>`).join('')||'<tr><td colspan="4">Sin oficinas.</td></tr>';
}
async function editOffice(id){
 const {data:office,error}=await sb.from('offices').select('id,name').eq('id',id).single();if(error)return msg('error','Oficina',error.message);
 const {value:name}=await Swal.fire({...swal,title:'Editar oficina',input:'text',inputValue:office.name,showCancelButton:true,confirmButtonText:'Guardar',cancelButtonText:'Cancelar',inputValidator:v=>clean(v).length<2?'Ingresá al menos 2 caracteres':undefined});
 if(!name||clean(name)===office.name)return;
 const {data,error:rpcErr}=await sb.rpc('superadmin_rename_office',{p_office_id:id,p_new_name:clean(name)});
 if(rpcErr)return msg('error','No se pudo editar',rpcErr.message);
 await loadCatalogs();await loadOfficesAdmin();if(state.user)await loadInventory();msg('success','Oficina actualizada',data?.name||clean(name));
}


const importAliases={
 date:['fecha','date','createdat','fechahora'],
 office_name:['oficina','office','dependencia','sector','reparticion','repartición'],
 equipment_name:['nombreequipo','nombre_equipo','equipo','hostname','nombredel equipo'],
 equipment_type:['tipo2','tipo','tipodeequipo','tipoequipo'],
 source_item_no:['itemn','itemno','itemnumero','itemnro','item'],
 source_quantity:['cantidad','cant','unidades'],
 brand:['marca','brand','fabricante'],
 model:['modelo','model'],
 acquisition_year:['ano','año','anio','anodeadquisicion','añodeadquisicion'],
 processor_count:['cantdeprocesadores','cantidaddeprocesadores','procesadoresfisicos','cantprocesadores'],
 processor:['modelodeprocesador','procesador','processor','cpu'],
 cores:['cantdecoresdecprocesador','cantdecoresporprocesador','cores','nucleos','núcleos'],
 ram_gb:['ramgb','ram_gb','ram','memoria'],
 storage_capacity:['capacidadtb','capacidad','storagecapacity'],
 storage_unit:['unidadmedida','unidad','unit'],
 operating_system:['sistemaoperativo','sistema_operativo','so','windows','os'],
 motherboard:['placamadre','placa_madre','motherboard','mainboard'],
 ram_type:['ramtipo','ram_tipo','tiporam','tipo_ram'],
 storage:['almacenamiento','storage','disco','discos'],
 graphics:['tarjetagrafica','tarjeta_grafica','gpu','grafica','gráfica']
};
function normHeader(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'')}
function detectImportMap(headers){
 const normalized=Object.fromEntries(headers.map(h=>[normHeader(h),h]).filter(([n])=>n)),map={};
 for(const [field,aliases] of Object.entries(importAliases)){
   for(const a of aliases){const hit=normalized[normHeader(a)];if(hit!==undefined){map[field]=hit;break}}
 }
 return map;
}
function scoreHeaderRow(row){
 const headers=(row||[]).map(v=>String(v??'').trim()).filter(Boolean);
 if(headers.length<2)return {score:0,map:{}};
 const map=detectImportMap(headers);
 let score=Object.keys(map).length;
 if(map.source_item_no)score+=2;
 if(map.equipment_type)score+=2;
 if(map.brand)score++;
 if(map.processor)score++;
 if(map.ram_gb)score++;
 return {score,map,headers};
}
function findHeaderRow(matrix){
 let best={rowIndex:-1,score:0,map:{},headers:[]};
 const max=Math.min(matrix.length,45);
 for(let i=0;i<max;i++){
   const s=scoreHeaderRow(matrix[i]);
   if(s.score>best.score)best={rowIndex:i,...s};
 }
 return best;
}
function findMetadataValue(matrix,aliases){
 const norms=aliases.map(normHeader);
 for(let r=0;r<Math.min(matrix.length,35);r++){
   const row=matrix[r]||[];
   for(let c=0;c<row.length;c++){
     const key=normHeader(row[c]);
     if(!key)continue;
     if(norms.some(a=>key===a||key.startsWith(a))){
       for(let j=c+1;j<row.length;j++){
         const value=String(row[j]??'').trim();
         if(value)return value;
       }
       for(let rr=r+1;rr<Math.min(matrix.length,r+4);rr++){
         const value=String((matrix[rr]||[])[c]??'').trim();
         if(value)return value;
       }
     }
   }
 }
 return '';
}
function inspectImportSheet(wb,sheetName){
 const ws=wb.Sheets[sheetName];
 const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
 const header=findHeaderRow(matrix);
 const officeMeta=findMetadataValue(matrix,['Nombre de la Repartición','Repartición','Dependencia','Oficina']);
 const techMeta=findMetadataValue(matrix,['Nombre del Ref. Técnico','Responsable Técnico','Referente Técnico']);
 const phoneMeta=findMetadataValue(matrix,['Tel de contacto','Teléfono de contacto']);
 const emailMeta=findMetadataValue(matrix,['Mail de contacto','Email de contacto','Correo de contacto']);
 return {sheetName,matrix,header,meta:{office_name:officeMeta,technical_contact:techMeta,phone:phoneMeta,email:emailMeta}};
}
function candidatePriority(c){
 const n=normHeader(c.sheetName);
 let p=c.header.score;
 if(n==='inventarioactual'||n.includes('inventarioactual'))p+=20;
 if(n.includes('config'))p-=30;
 if(n.includes('solicitar'))p-=5;
 return p;
}
function buildSheetCandidates(wb){
 return wb.SheetNames.map(n=>inspectImportSheet(wb,n))
   .filter(c=>c.header.rowIndex>=0&&c.header.score>=4)
   .sort((a,b)=>candidatePriority(b)-candidatePriority(a));
}
function sheetRowsAsObjects(candidate){
 const {matrix,header}=candidate;
 const headers=(matrix[header.rowIndex]||[]).map(v=>String(v??'').trim());
 const rows=[];
 for(let r=header.rowIndex+1;r<matrix.length;r++){
   const arr=matrix[r]||[];
   if(!arr.some(v=>String(v??'').trim()!==''))continue;
   const obj={__rowNumber:r+1};
   headers.forEach((h,i)=>{if(h)obj[h]=arr[i]??''});
   rows.push(obj);
 }
 return {headers,rows,map:detectImportMap(headers)};
}
function parseNumber(v){
 const s=String(v??'').trim().replace(',','.').replace(/[^\d.-]/g,'');
 const n=Number(s);return Number.isFinite(n)?n:null;
}
function intNumber(v){
 const n=parseNumber(v);return Number.isFinite(n)?Math.trunc(n):null;
}
function normalizedStorage(capacity,unit,storage){
 const direct=clean(storage);
 if(direct)return direct;
 const n=parseNumber(capacity);
 if(n===null)return '';
 let u=String(unit??'').trim().toUpperCase();
 if(/^G/.test(u))u='GB'; else if(/^T/.test(u))u='TB'; else if(/^M/.test(u))u='MB';
 return `${n} ${u||''}`.trim();
}
function compactEquipmentName(type,item,unitIndex,qty,brand,model){
 const t=clean(type)||'Equipo';
 const itemTxt=String(item??'').trim();
 let base=itemTxt?`${t} #${itemTxt}`:t;
 if(Number(qty)>1)base+=`-${String(unitIndex).padStart(2,'0')}`;
 // El nombre de catálogo debe caber en 80 caracteres.
 return base.slice(0,80);
}
function normalizeImportRow(row,map,context={}){
 const get=f=>map[f]!==undefined?(row[map[f]]??''):'';
 const n=v=>clean(v);
 const cores=intNumber(get('cores'));
 const ram=parseNumber(get('ram_gb'));
 const qty=Math.max(1,Math.min(500,intNumber(get('source_quantity'))||1));
 const processorCount=intNumber(get('processor_count'));
 const year=intNumber(get('acquisition_year'));
 let dt=n(get('date')); if(dt){const d=new Date(dt.replace(' ','T'));if(!isNaN(d))dt=d.toISOString()}
 return {
   office_name:n(get('office_name'))||n(context.office_name),
   explicit_equipment_name:n(get('equipment_name')),
   equipment_type:n(get('equipment_type')),
   source_item_no:n(get('source_item_no'))||String(row.__rowNumber||''),
   source_quantity:qty,
   brand:n(get('brand')),
   model:n(get('model')),
   acquisition_year:year,
   processor_count:processorCount,
   processor:n(get('processor')),
   cores:Number.isFinite(cores)?cores:null,
   operating_system:n(get('operating_system')),
   motherboard:n(get('motherboard')),
   ram_gb:Number.isFinite(ram)?ram:null,
   ram_type:n(get('ram_type')),
   storage:normalizedStorage(get('storage_capacity'),get('storage_unit'),get('storage')),
   graphics:n(get('graphics')),
   source_date:dt||null,
   source_sheet:n(context.sheetName),
   source_row:Number(row.__rowNumber||0)||null,
   collector_version:'IMPORT-v1.3.0'
 };
}
function expandImportUnits(base){
 const out=[];
 for(let unit=1;unit<=base.source_quantity;unit++){
   const name=base.explicit_equipment_name
     ? (base.source_quantity>1?`${base.explicit_equipment_name}-${String(unit).padStart(2,'0')}`:base.explicit_equipment_name).slice(0,80)
     : compactEquipmentName(base.equipment_type,base.source_item_no,unit,base.source_quantity,base.brand,base.model);
   out.push({...base,equipment_name:name,source_unit_no:unit});
 }
 return out;
}
function renderImportCandidate(candidate){
 const parsed=sheetRowsAsObjects(candidate);
 const map=parsed.map;
 state.importSheet=candidate;
 state.importRows=parsed.rows;
 state.importMap=map;
 state.importMeta=candidate.meta||{};

 const officeInput=$('#importOfficeFallback');
 if(officeInput&&!officeInput.value)officeInput.value=candidate.meta?.office_name||'';

 $('#importDetectedPanel')?.classList.remove('hidden');
 const meta=[];
 meta.push(`<span><b>Encabezados:</b> fila ${candidate.header.rowIndex+1}</span>`);
 if(candidate.meta?.office_name)meta.push(`<span><b>Repartición:</b> ${esc(candidate.meta.office_name)}</span>`);
 if(candidate.meta?.technical_contact)meta.push(`<span><b>Ref. técnico:</b> ${esc(candidate.meta.technical_contact)}</span>`);
 $('#importMetaInfo').innerHTML=meta.join('');

 $('#importMapping').classList.remove('hidden');
 $('#importMapping').innerHTML=Object.entries(map).map(([f,h])=>`<div class="mapping-item"><b>${esc(f)}</b><span>${esc(h)}</span></div>`).join('');

 const fallback=clean(officeInput?.value||candidate.meta?.office_name||'');
 const normalized=parsed.rows.flatMap(r=>expandImportUnits(normalizeImportRow(r,map,{office_name:fallback,sheetName:candidate.sheetName})));
 const sample=normalized.slice(0,8);

 $('#importPreview').classList.remove('hidden');
 $('#importPreview').innerHTML=`
   <div class="import-preview-head">
     <b>${sample.length?'Vista previa':'Sin filas válidas'}</b>
     <span>${parsed.rows.length} fila(s) origen → ${normalized.length} equipo(s) individuales</span>
   </div>
   <table>
     <thead><tr><th>Oficina</th><th>Equipo generado</th><th>Tipo</th><th>Marca/Modelo</th><th>CPU</th><th>RAM</th><th>Almacenamiento</th></tr></thead>
     <tbody>${sample.map(r=>`<tr>
       <td>${esc(r.office_name||'—')}</td>
       <td>${esc(r.equipment_name)}</td>
       <td>${esc(r.equipment_type||'—')}</td>
       <td>${esc(`${r.brand||''} ${r.model||''}`.trim()||'—')}</td>
       <td>${esc(r.processor||'—')}</td>
       <td>${esc(r.ram_gb??'—')} GB</td>
       <td>${esc(r.storage||'—')}</td>
     </tr>`).join('')}</tbody>
   </table>`;

 const hasOffice=Boolean(fallback||map.office_name);
 const hasEquipment=Boolean(map.equipment_name||map.equipment_type||map.source_item_no);
 $('#runImportBtn').disabled=!(hasOffice&&hasEquipment&&normalized.length);
 $('#importStatus').textContent=`Hoja "${candidate.sheetName}" · ${parsed.rows.length} fila(s) detectadas · ${normalized.length} equipo(s) a procesar.`;
}
async function parseImportFile(file){
 if(!window.XLSX)throw new Error('No se cargó el motor XLSX. Verificá la conexión a Internet.');
 const ext=(file.name.split('.').pop()||'').toLowerCase();let wb;
 if(ext==='csv'){
   const text=await file.text();
   wb=XLSX.read(text,{type:'string'});
 }else{
   const ab=await file.arrayBuffer();
   wb=XLSX.read(ab,{type:'array',cellDates:true});
 }

 const candidates=buildSheetCandidates(wb);
 if(!candidates.length)throw new Error('No pude localizar una tabla de inventario. El archivo no contiene encabezados reconocibles.');

 state.importWorkbook=wb;
 state.importCandidates=candidates;

 const sel=$('#importSheetSelect');
 if(sel){
   sel.innerHTML=candidates.map((c,i)=>`<option value="${i}">${esc(c.sheetName)} · encabezados fila ${c.header.rowIndex+1}</option>`).join('');
   sel.value='0';
 }
 $('#importOfficeFallback').value=candidates[0].meta?.office_name||'';
 renderImportCandidate(candidates[0]);
}
function expandedRowsForCandidate(c,officeFallback=''){
 const parsed=sheetRowsAsObjects(c),fallback=clean(c.meta?.office_name||officeFallback||'');
 return parsed.rows.map(r=>normalizeImportRow(r,parsed.map,{office_name:fallback,sheetName:c.sheetName}))
  .filter(r=>r.office_name&&(r.explicit_equipment_name||r.equipment_type||r.source_item_no)).flatMap(expandImportUnits);
}
function currentExpandedImportRows(){
 const office=clean($('#importOfficeFallback')?.value||state.importMeta?.office_name||'');
 if(($('#importMode')?.value||'all')==='all')return (state.importCandidates||[]).flatMap(c=>expandedRowsForCandidate(c,office));
 return state.importSheet?expandedRowsForCandidate(state.importSheet,office):[];
}

async function runImport(){
 const rows=currentExpandedImportRows();
 if(!rows.length)return msg('warning','Sin datos para importar','Revisá la hoja seleccionada y la Oficina/Repartición.');

 const offices=new Set(rows.map(r=>r.office_name)),bySheet={};
 rows.forEach(r=>bySheet[r.source_sheet]=(bySheet[r.source_sheet]||0)+1);
 const sheetSummary=Object.entries(bySheet).map(([k,v])=>`${esc(k)}: <b>${v}</b>`).join(' · ');
 const ask=await Swal.fire({
   ...swal,icon:'question',title:'Importar inventario',
   html:`Se procesarán <b>${rows.length}</b> equipos individuales.<br>${sheetSummary}<br>
         Reparticiones: <b>${offices.size}</b>.<br><br>
         <small>Las hojas operativas quedarán separadas en pestañas dentro del Inventario. La hoja config se ignora automáticamente.</small>`,
   showCancelButton:true,confirmButtonText:'Importar',cancelButtonText:'Cancelar'
 });
 if(!ask.isConfirmed)return;

 Swal.fire({...swal,title:'Importando datos...',html:`<div class="import-progress"><i id="importProgressBar"></i></div><div id="importProgressText">0 / ${rows.length}</div>`,allowOutsideClick:false,showConfirmButton:false});

 let inserted=0,updated=0,duplicates=0,errors=[];
 for(let i=0;i<rows.length;i++){
   try{
     const {data,error}=await sb.rpc('superadmin_import_inventory_row',{p_payload:rows[i]});
     if(error)throw error;
     const action=data?.action||'';
     if(action==='inserted')inserted++;
     else if(action==='duplicate')duplicates++;
     else updated++;
   }catch(e){
     errors.push({row:rows[i].source_row||i+1,error:e.message});
   }
   const pct=Math.round(((i+1)/rows.length)*100);
   const bar=document.getElementById('importProgressBar'),txt=document.getElementById('importProgressText');
   if(bar)bar.style.width=pct+'%';
   if(txt)txt.textContent=`${i+1} / ${rows.length}`;
 }
 Swal.close();
 await loadCatalogs();await loadSourceSheets();await loadInventory();await loadOfficesAdmin();

 const detail=`Nuevos: ${inserted} · Actualizados: ${updated} · Duplicados: ${duplicates} · Errores: ${errors.length}`;
 $('#importStatus').textContent=detail;
 if(errors.length){
   await Swal.fire({...swal,icon:'warning',title:'Importación finalizada con observaciones',
     html:`${esc(detail)}<br><small>${esc(errors.slice(0,8).map(x=>`Fila ${x.row}: ${x.error}`).join(' | '))}</small>`,
     confirmButtonText:'Aceptar'});
 }else{
   await msg('success','Importación completada',detail);
 }
}

async function loadInventory(){
 if(!state.user)return;
 state.size=Number($('#pageSize').value||10);
 try{
  const {data,error,count}=await fetchFilteredInventory(true);
  if(error)throw error;
  state.rows=data||[];state.total=count||0;
  renderInventory();await loadStats();await updateGroupSummary();
 }catch(e){msg('error','No se pudo cargar inventario',e.message)}
}
async function loadStats(){
 let q=sb.from('inventories').select('windows_license_status,submission_count,source_sheet');
 q=applySourceFilter(q);
 const {data}=await q;
 const rows=data||[];
 $('#statTotal').textContent=rows.length;
 $('#statLicensed').textContent=rows.filter(r=>/licenciado/i.test(r.windows_license_status||'')&&!/no licenciado/i.test(r.windows_license_status||'')).length;
 $('#statUnlicensed').textContent=rows.filter(r=>/no licenciado/i.test(r.windows_license_status||'')).length;
 $('#statComplete').textContent=rows.filter(r=>(r.submission_count||0)>=3).length;
}
const eyeSvg='<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>';
const editSvg='<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
const trashSvg='<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M7 6l1 14h8l1-14"/></svg>';
function licenseStatus(r){const s=(r.windows_license_status||'Desconocido').toLowerCase();if(s.includes('no licenciado'))return ['bad','No licenciado'];if(s.includes('licenciado'))return ['ok','Licenciado'];return ['warn','Desconocido']}
function renderInventory(){
 $('#inventoryBody').innerHTML=state.rows.map(r=>{const [lc,lt]=licenseStatus(r);const [sc,st]=inventoryProcessStatus(r.submission_count);return `<tr>
 <td><input class="row-check" type="checkbox" data-id="${esc(r.id)}" ${state.selected.has(r.id)?'checked':''}></td>
 <td><span class="status ${sc}">${st}</span></td>
 <td><span class="source-badge">${esc(sourceDisplayName(r.source_sheet))}</span></td>
 <td>${esc(fmt(r.last_submitted_at))}</td><td>${esc(r.office_name)}</td><td>${esc(r.equipment_name)}</td><td>${esc((r.brand||'')+' '+(r.model||''))}</td><td>${esc(r.processor||'—')}</td><td>${esc(r.ram_gb||'—')} GB ${esc(r.ram_type||'')}</td><td>${esc(r.operating_system||'—')}</td><td><span class="status ${lc}">${lt}</span></td><td>${renderTags(r)}</td><td>${esc(r.submission_count||0)}/3</td>
 <td><div class="action-group"><button class="action-btn view-row" data-id="${r.id}" title="Ver">${eyeSvg}</button><button class="action-btn edit-row" data-id="${r.id}" title="Editar">${editSvg}</button>${isSuper()?`<button class="action-btn delete-row" data-id="${r.id}" title="Eliminar">${trashSvg}</button>`:''}</div></td></tr>`}).join('')||'<tr><td colspan="14">Sin registros.</td></tr>';
 const pages=Math.max(1,Math.ceil(state.total/state.size));
 $$('.pager-info').forEach(el=>el.textContent=`Página ${state.page+1} de ${pages} · ${state.total} registros`);
 $$('.pager-prev').forEach(el=>el.disabled=state.page===0);
 $$('.pager-next').forEach(el=>el.disabled=state.page+1>=pages);
 syncSelectionUI();
}
function syncSelectionUI(){
 $('#selectedCount').textContent=`${state.selected.size} seleccionados`;
 const del=$('#deleteSelectedBtn');
 if(del){del.classList.toggle('super-only-hidden',!isSuper());del.disabled=!isSuper()||!state.selected.size}
 if($('#assignTagBtn'))$('#assignTagBtn').disabled=!state.selected.size;
 $('#selectPage').checked=state.rows.length>0&&state.rows.every(r=>state.selected.has(r.id));
}
function detailsHtml(r){const fields=[['Oficina',r.office_name],['Equipo',r.equipment_name],['Tipo de equipo',r.equipment_type],['Ítem origen',r.source_item_no],['Hoja origen',r.source_sheet],['Año adquisición',r.acquisition_year],['Cant. procesadores',r.processor_count],['Host',r.hostname],['Marca',r.brand],['Modelo',r.model],['Procesador',r.processor],['Núcleos',r.cores],['RAM',`${r.ram_gb||'—'} GB ${r.ram_type||''}`],['Almacenamiento',r.storage],['Gráfica',r.graphics],['Windows',r.operating_system],['Versión',r.windows_version],['Build',r.windows_build],['Product ID',r.product_id],['Licencia',r.windows_license_status],['Canal',r.windows_license_channel],['Clave parcial',r.windows_partial_product_key],['OEM Key',r.windows_oem_key],['Placa madre',r.motherboard],['BIOS Serial',r.bios_serial],['BIOS',r.bios_version],['UUID',r.device_uuid],['Dominio/Grupo',r.domain_workgroup],['Sistema',r.system_type],['Etiquetas',rowTags(r).map(t=>t.name).join(', ')||'—'],['Relevamientos',`${r.submission_count}/3`]];return `<div class="details-grid">${fields.map(([a,b])=>`<div><b>${esc(a)}</b>${esc(b||'—')}</div>`).join('')}</div>`}
async function viewRow(id){const r=state.rows.find(x=>x.id===id);if(r)Swal.fire({...swal,title:esc(r.equipment_name),html:detailsHtml(r),width:850,confirmButtonText:'Cerrar'})}
function editTagSelector(row){
 const selected=new Set(rowTags(row).map(t=>t.id));
 if(!state.tags?.length){
   return `<div class="edit-field edit-tags-field"><label>Etiquetas</label><div class="tag-selector-empty">No hay etiquetas creadas. Crealas desde “+ Crear etiqueta”.</div></div>`;
 }
 return `<div class="edit-field edit-tags-field">
   <label>Etiquetas</label>
   <div class="tag-selector" id="eTagSelector">
     ${state.tags.map(t=>`
       <label class="tag-option ${selected.has(t.id)?'selected':''}" style="--tag-color:${esc(t.color||'#6ca8ff')}">
         <input type="checkbox" value="${esc(t.id)}" ${selected.has(t.id)?'checked':''}>
         <span class="tag-option-dot"></span>
         <span>${esc(t.name)}</span>
       </label>`).join('')}
   </div>
   <small class="field-help">Podés elegir una o varias etiquetas existentes.</small>
 </div>`;
}
function selectedEditTagIds(){
 return $$('#eTagSelector input[type="checkbox"]:checked').map(x=>x.value);
}
async function saveInventoryTags(inventoryId,tagIds){
 const ids=[...new Set((tagIds||[]).filter(Boolean))];
 const {error:delErr}=await sb.from('inventory_tags').delete().eq('inventory_id',inventoryId);
 if(delErr)throw delErr;
 if(!ids.length)return;
 const payload=ids.map(tag_id=>({inventory_id:inventoryId,tag_id,created_by:state.user.id}));
 const {error:insErr}=await sb.from('inventory_tags').insert(payload);
 if(insErr)throw insErr;
}

async function editRow(id){
 const r=state.rows.find(x=>x.id===id);if(!r)return;

 let offices=[];try{offices=JSON.parse($('#officeSelect').dataset.items||'[]')}catch{}
 const officeOptions=offices.map(o=>`<option value="${esc(o.id)}" ${o.id===r.office_id?'selected':''}>${esc(o.name)}</option>`).join('');
 const text=(id,label,value,type='text')=>`<div class="edit-field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value??'')}"></div>`;
 const area=(id,label,value)=>`<div class="edit-field"><label for="${id}">${label}</label><textarea id="${id}">${esc(value??'')}</textarea></div>`;

 const form=`
 <div class="inventory-edit-form">
   <div class="edit-section-title">Identificación</div>
   <div class="edit-field"><label>Oficina</label><select id="eOfficeId" class="modern-select">${officeOptions}</select></div>
   ${text('eEquip','Equipo',r.equipment_name)}
   ${text('eEquipmentType','Tipo de equipo',r.equipment_type)}
   ${text('eSourceItem','Ítem origen',r.source_item_no)}
   ${text('eSourceSheet','Hoja origen',r.source_sheet)}
   ${text('eAcquisitionYear','Año de adquisición',r.acquisition_year,'number')}
   ${text('eProcessorCount','Cant. de procesadores',r.processor_count,'number')}
   ${text('eHostname','Hostname',r.hostname)}
   ${text('eFullName','Nombre completo del dispositivo',r.full_device_name)}
   ${text('eDomain','Dominio / Grupo',r.domain_workgroup)}
   ${text('eSystemType','Tipo de sistema',r.system_type)}

   <div class="edit-section-title">Hardware</div>
   ${text('eBrand','Marca',r.brand)}
   ${text('eModel','Modelo',r.model)}
   ${text('eProcessor','Procesador',r.processor)}
   ${text('eCores','Núcleos',r.cores,'number')}
   ${text('eRamGb','RAM (GB)',r.ram_gb,'number')}
   ${text('eRamType','Tipo de RAM',r.ram_type)}
   ${area('eStorage','Almacenamiento',r.storage)}
   ${area('eGraphics','Gráfica',r.graphics)}
   ${text('eMotherboard','Placa madre',r.motherboard)}
   ${text('eBiosSerial','BIOS Serial',r.bios_serial)}
   ${text('eBiosVersion','Versión BIOS',r.bios_version)}
   ${text('eUuid','UUID',r.device_uuid)}

   <div class="edit-section-title">Windows y licencia</div>
   ${area('eOS','Sistema operativo',r.operating_system)}
   ${text('eWinVersion','Versión Windows',r.windows_version)}
   ${text('eWinBuild','Build',r.windows_build)}
   ${text('eProductId','Product ID',r.product_id)}
   ${text('eInstallDate','Fecha instalación Windows',r.windows_install_date)}
   <div class="edit-field"><label>Estado de licencia</label><select id="eLicenseStatus" class="modern-select">
      <option ${r.windows_license_status==='Licenciado'?'selected':''}>Licenciado</option>
      <option ${r.windows_license_status==='No licenciado'?'selected':''}>No licenciado</option>
      <option ${!['Licenciado','No licenciado'].includes(r.windows_license_status||'')?'selected':''}>Desconocido</option>
   </select></div>
   ${area('eLicenseChannel','Canal de licencia',r.windows_license_channel)}
   ${text('ePartialKey','Clave parcial',r.windows_partial_product_key)}
   ${text('eOemKey','OEM Key',r.windows_oem_key)}

   <div class="edit-section-title">Clasificación</div>
   ${editTagSelector(r)}

   <div class="edit-section-title">Control del relevamiento</div>
   <div class="edit-field"><label>Relevamientos</label><select id="eSubmissionCount" class="modern-select">
     <option value="1" ${(r.submission_count||1)==1?'selected':''}>1/3 · Registrado</option>
     <option value="2" ${(r.submission_count||1)==2?'selected':''}>2/3 · Actualizado</option>
     <option value="3" ${(r.submission_count||1)>=3?'selected':''}>3/3 · Completo</option>
   </select></div>
   ${text('eCollector','Versión recopilador',r.collector_version)}
 </div>`;

 let selectedTagIds=[];
 const {value:v}=await Swal.fire({
   ...swal,title:'Editar inventario',html:form,width:900,
   showCancelButton:true,confirmButtonText:'Guardar cambios',cancelButtonText:'Cancelar',
   focusConfirm:false,
   didOpen:()=>{
     $$('#eTagSelector input[type="checkbox"]').forEach(ch=>ch.addEventListener('change',()=>{
       ch.closest('.tag-option')?.classList.toggle('selected',ch.checked);
     }));
   },
   preConfirm:()=>{
     const officeId=$('#eOfficeId').value;
     selectedTagIds=selectedEditTagIds();
     const office=offices.find(o=>o.id===officeId);
     return {
       office_id:officeId,
       office_name:office?.name||r.office_name,
       equipment_name:clean($('#eEquip').value),
       equipment_type:clean($('#eEquipmentType').value),
       source_item_no:clean($('#eSourceItem').value),
       source_sheet:clean($('#eSourceSheet').value),
       acquisition_year:Number($('#eAcquisitionYear').value)||null,
       processor_count:Number($('#eProcessorCount').value)||null,
       hostname:clean($('#eHostname').value),
       full_device_name:clean($('#eFullName').value),
       domain_workgroup:clean($('#eDomain').value),
       system_type:clean($('#eSystemType').value),
       brand:clean($('#eBrand').value),
       model:clean($('#eModel').value),
       processor:clean($('#eProcessor').value),
       cores:Number($('#eCores').value)||null,
       ram_gb:Number($('#eRamGb').value)||null,
       ram_type:clean($('#eRamType').value),
       storage:clean($('#eStorage').value),
       graphics:clean($('#eGraphics').value),
       motherboard:clean($('#eMotherboard').value),
       bios_serial:clean($('#eBiosSerial').value),
       bios_version:clean($('#eBiosVersion').value),
       device_uuid:clean($('#eUuid').value),
       operating_system:clean($('#eOS').value),
       windows_version:clean($('#eWinVersion').value),
       windows_build:clean($('#eWinBuild').value),
       product_id:clean($('#eProductId').value),
       windows_install_date:clean($('#eInstallDate').value),
       windows_license_status:$('#eLicenseStatus').value,
       windows_license_channel:clean($('#eLicenseChannel').value),
       windows_partial_product_key:clean($('#ePartialKey').value),
       windows_oem_key:clean($('#eOemKey').value),
       submission_count:Number($('#eSubmissionCount').value)||1,
       collector_version:clean($('#eCollector').value),
       last_submitted_at:new Date().toISOString()
     };
   }
 });
 if(!v)return;
 const {error}=await sb.from('inventories').update(v).eq('id',id);
 if(error)return msg('error','No se pudo editar',error.message);
 try{
   await saveInventoryTags(id,selectedTagIds);
 }catch(e){
   console.error('inventory_tags',e);
   return msg('warning','Datos guardados, etiquetas pendientes',`El inventario se actualizó, pero no se pudieron guardar las etiquetas: ${e.message||e}`);
 }
 await loadTags();
 await loadInventory();
 msg('success','Registro actualizado','Los datos y etiquetas fueron guardados correctamente.');
}
async function deleteIds(ids){
 if(!isSuper())return msg('warning','Acción restringida','Solo un SuperAdmin puede eliminar equipos.');
 if(!ids.length)return;const ok=await Swal.fire({...swal,icon:'warning',title:`Eliminar ${ids.length} registro(s)`,text:'Esta acción no se puede deshacer.',showCancelButton:true,confirmButtonText:'Eliminar',cancelButtonText:'Cancelar',confirmButtonColor:'#d65f69'});if(!ok.isConfirmed)return;
 const {error}=await sb.rpc('superadmin_delete_inventories',{p_ids:ids});if(error)return msg('error','No se pudo eliminar',error.message);ids.forEach(id=>state.selected.delete(id));await loadInventory();msg('success','Eliminación completada');
}
function csvEscape(v){const s=String(v??'');return `"${s.replace(/"/g,'""')}"`}
async function allInventory(options={}){
 const source=options.ignoreSource?'all':undefined;
 const {data,error}=await fetchFilteredInventory(false,source);
 if(error)throw error;return data||[];
}
function exportAllSheets(){return ($('#exportScope')?.value||state.exportScope)==='all'}
function exportLabel(){return exportAllSheets()?'Todas las hojas':(state.sourceView==='all'?'Todos':sourceDisplayName(state.sourceView==='__automatic__'?null:state.sourceView))}
function exportSuffix(){return exportAllSheets()?'todas-las-hojas':sourceSlug(state.sourceView==='all'?'todos':state.sourceView==='__automatic__'?'relevamiento-automatico':state.sourceView)}
async function exportCSV(){
 try{
  const rows=await allInventory({ignoreSource:exportAllSheets()});
  const headers=['Hoja/Origen','Fecha','Oficina','Equipo','Tipo','Item','Unidad','Marca','Modelo','Año','Cant. procesadores','CPU','Núcleos','RAM GB','Tipo RAM','Almacenamiento','Gráfica','Windows','Versión','Build','Licencia','Canal','Clave parcial','Hostname','Placa madre','BIOS Serial','UUID','3x','Etiquetas'];
  const csv=[headers.map(csvEscape).join(','),...rows.map(r=>[
    sourceDisplayName(r.source_sheet),r.last_submitted_at,r.office_name,r.equipment_name,r.equipment_type,r.source_item_no,r.source_unit_no,
    r.brand,r.model,r.acquisition_year,r.processor_count,r.processor,r.cores,r.ram_gb,r.ram_type,r.storage,r.graphics,r.operating_system,
    r.windows_version,r.windows_build,r.windows_license_status,r.windows_license_channel,r.windows_partial_product_key,r.hostname,
    r.motherboard,r.bios_serial,r.device_uuid,`${r.submission_count||0}/3`,rowTags(r).map(t=>t.name).join('|')
  ].map(csvEscape).join(','))].join('\r\n');
  downloadBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`inventario_${exportSuffix()}_${Date.now()}.csv`);
 }catch(e){msg('error','No se pudo exportar CSV',e.message)}
}
async function exportPDF(){
 try{
  const rows=await allInventory({ignoreSource:exportAllSheets()});
  const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape'});
  let logo=null;try{const res=await fetch($('#brandLogo').src),blob=await res.blob();logo=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(blob)})}catch{}
  if(logo)doc.addImage(logo,'PNG',12,8,34,15);
  doc.setFontSize(15);doc.text('RELEVAMIENTO MANAGER - Inventario de Equipos',52,15);
  doc.setFontSize(9);doc.text(`Hoja/alcance: ${exportLabel()}`,52,21);
  doc.text(`Fecha: ${new Date().toLocaleString('es-AR')} · Usuario: ${state.user.email}`,52,26);
  doc.autoTable({
   startY:32,
   head:[['Hoja/Origen','Oficina','Equipo','Tipo','Marca/Modelo','CPU','RAM','Windows','Licencia','3x']],
   body:rows.map(r=>[sourceDisplayName(r.source_sheet),r.office_name,r.equipment_name,r.equipment_type||'—',`${r.brand||''} ${r.model||''}`.trim(),r.processor,`${r.ram_gb||''} GB ${r.ram_type||''}`,r.operating_system,r.windows_license_status,`${r.submission_count||0}/3`]),
   styles:{fontSize:6.6},headStyles:{fillColor:[30,50,78]},columnStyles:{0:{cellWidth:30}}
  });
  const pages=doc.internal.getNumberOfPages();
  for(let p=1;p<=pages;p++){doc.setPage(p);doc.setFontSize(7);doc.text(`RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina · by Ing. Fernando Gambino · Todos los Derechos Registrados · Página ${p}/${pages}`,12,doc.internal.pageSize.height-8)}
  doc.save(`inventario_${exportSuffix()}_${Date.now()}.pdf`);
 }catch(e){msg('error','No se pudo generar PDF',e.message)}
}

async function invokeFn(name,body){
 const {data,error}=await sb.functions.invoke(name,{body});if(error){let detail=error.message;try{if(error.context){const j=await error.context.json();detail=j.error||j.message||detail}}catch{}throw new Error(detail)}return data;
}
async function loadAdmins(){
 if(!isSuper())return;
 try{const {data,error}=await sb.rpc('superadmin_list_admins');if(error)throw error;const users=data||[];$('#adminsBody').innerHTML=users.map(u=>`<tr><td>${esc(u.display_name||'—')}</td><td>${esc(u.email||'—')}</td><td><span class="status ${u.role==='superadmin'?'ok':'warn'}">${esc(u.role)}</span></td><td>${esc(fmt(u.created_at))}</td></tr>`).join('')||'<tr><td colspan="4">Sin usuarios.</td></tr>'}
 catch(e){$('#adminsBody').innerHTML='<tr><td colspan="4">No se pudo cargar el listado.</td></tr>';msg('error','Administradores',e.message)}
}
async function createAdminFallback(v){
 const isolated=window.supabase.createClient(C.SUPABASE_URL.replace(/\/$/,''),C.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'medtuc-admin-create-'+Date.now()}});
 const {error:signErr}=await isolated.auth.signUp({email:v.email,password:v.password,options:{data:{display_name:v.display_name}}});
 if(signErr&&!/already registered|already been registered|user already registered/i.test(signErr.message||''))throw signErr;
 for(let i=0;i<10;i++){const {data,error}=await sb.rpc('superadmin_assign_role_by_email',{p_email:v.email,p_display_name:v.display_name,p_role:v.role});if(!error&&data?.ok)return data;if(error&&!/no existe|not found|no user/i.test(error.message||''))throw error;await sleep(500)}
 throw new Error('La cuenta Auth no pudo vincularse al rol administrativo. Verificá que Authentication permita crear usuarios.');
}
async function addAdmin(){
 const {value:v}=await Swal.fire({...swal,title:'Nuevo usuario administrativo',html:`<input id="aName" class="swal2-input" placeholder="Nombre y apellido"><input id="aEmail" type="email" class="swal2-input" placeholder="Email"><input id="aPass" type="password" class="swal2-input" placeholder="Contraseña (mín. 8)"><select id="aRole" class="swal2-select"><option value="admin">Administrador</option><option value="superadmin">SuperAdmin</option></select>`,showCancelButton:true,confirmButtonText:'Crear usuario',cancelButtonText:'Cancelar',preConfirm:()=>{const x={display_name:clean($('#aName').value),email:clean($('#aEmail').value).toLowerCase(),password:$('#aPass').value,role:$('#aRole').value};if(!x.display_name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)||x.password.length<8){Swal.showValidationMessage('Completá nombre, email válido y contraseña de al menos 8 caracteres.');return false}return x}});
 if(!v)return;Swal.fire({...swal,title:'Creando usuario...',allowOutsideClick:false,showConfirmButton:false,didOpen:()=>Swal.showLoading()});
 try{try{await invokeFn('medtuc-admins',{action:'create',...v})}catch(edgeError){console.warn('medtuc-admins no disponible; usando alternativa RPC.',edgeError);await createAdminFallback(v)}Swal.close();await loadAdmins();msg('success','Usuario creado',`Se creó ${v.email} como ${v.role==='superadmin'?'SuperAdmin':'Administrador'}.`)}
 catch(e){Swal.close();msg('error','No se pudo crear',e.message)}
}

async function idbPut(file){return new Promise((res,rej)=>{const q=indexedDB.open('medtuc-updater',1);q.onupgradeneeded=()=>q.result.createObjectStore('patches');q.onerror=()=>rej(q.error);q.onsuccess=()=>{const tx=q.result.transaction('patches','readwrite');tx.objectStore('patches').put(file,'current');tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)}})}
async function idbGet(){return new Promise((res,rej)=>{const q=indexedDB.open('medtuc-updater',1);q.onupgradeneeded=()=>q.result.createObjectStore('patches');q.onerror=()=>rej(q.error);q.onsuccess=()=>{const tx=q.result.transaction('patches','readonly');const g=tx.objectStore('patches').get('current');g.onsuccess=()=>res(g.result||null);g.onerror=()=>rej(g.error)}})}
async function selectPatch(file){
 if(!file)return;try{const zip=await JSZip.loadAsync(file),manifestFile=zip.file('patch.json');if(!manifestFile)throw new Error('El ZIP no contiene patch.json');const manifest=JSON.parse(await manifestFile.async('text'));const allowed=Array.isArray(manifest.from)?manifest.from:[manifest.from];if(!allowed.includes(APP_VERSION))throw new Error(`Patch para ${allowed.join(', ')}, versión instalada ${APP_VERSION}`);state.patch={file,manifest};await idbPut(file);renderPatch();}catch(e){state.patch=null;msg('error','Patch inválido',e.message)}}
function renderPatch(){const p=state.patch;if(!p){$('#patchState').innerHTML='<span class="dot warn"></span><div><b>Sin patch adjunto</b><small>Adjuntá un .ZIP compatible.</small></div>';$('#installPatchBtn').disabled=true;return}$('#patchState').innerHTML=`<span class="dot ok"></span><div><b>Patch listo: v${esc(p.manifest.to)}</b><small>${esc(p.file.name)} · ${(p.file.size/1024).toFixed(1)} KB · ${esc(p.manifest.title||'')}</small></div>`;$('#installPatchBtn').disabled=false}
async function fileToBase64(file){const a=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)}
async function installPatch(){
 if(!state.patch){const f=await idbGet();if(f)await selectPatch(f)}if(!state.patch)return msg('warning','Sin patch','Adjuntá un patch .ZIP.');
 const p=state.patch;const ask=await Swal.fire({...swal,icon:'warning',title:`Instalar v${p.manifest.to}`,html:'Se ejecutarán automáticamente las migraciones SQL y luego se actualizarán los archivos del repositorio GitHub.',showCancelButton:true,confirmButtonText:'Instalar actualización',cancelButtonText:'Cancelar'});if(!ask.isConfirmed)return;
 Swal.fire({...swal,title:'Instalando actualización',html:'Validando, migrando base de datos y actualizando GitHub...<br><b>No cierres esta ventana.</b>',allowOutsideClick:false,showConfirmButton:false,didOpen:()=>Swal.showLoading()});
 try{
  const zip_base64=await fileToBase64(p.file);const d=await invokeFn('medtuc-updater',{action:'install',zip_base64});
  await Swal.fire({...swal,icon:'success',title:'Actualización instalada',text:`Versión ${d.to||p.manifest.to} instalada correctamente. GitHub Pages puede tardar unos segundos en publicar.`,confirmButtonText:'Recargar'});
  if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();for(const r of regs)await r.update().catch(()=>{})}
  location.href=location.pathname+'?v='+Date.now();
 }catch(e){msg('error','No se pudo instalar',e.message)}
}
async function checkUpdates(){try{const u=(C.PROJECT_URL||location.href).replace(/\/?$/,'/')+'update_manifest.json?ts='+Date.now();const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const m=await r.json();if(m.latest_version===APP_VERSION)return msg('success','Sistema actualizado',`La versión ${APP_VERSION} es la más reciente.`);msg('info','Actualización disponible',`Última versión: ${m.latest_version}. Podés adjuntar el patch correspondiente.`)}catch(e){msg('error','No se pudo buscar',e.message)}}
async function loadHistory(){if(!isSuper())return;const {data}=await sb.from('update_history').select('*').order('created_at',{ascending:false}).limit(20);$('#updateHistory').innerHTML=(data||[]).map(x=>`<div class="patch-state"><span class="dot ${x.status==='success'?'ok':'warn'}"></span><div><b>${esc(x.from_version)} → ${esc(x.to_version)}</b><small>${esc(fmt(x.created_at))} · ${esc(x.applied_by_email||'')}</small></div></div>`).join('')||'Sin registros.'}

function bind(){
 const on=(sel,event,fn)=>{const el=$(sel);if(el)el.addEventListener(event,fn);return el};
 const click=(sel,fn)=>on(sel,'click',fn);
 const change=(sel,fn)=>on(sel,'change',fn);

 click('#homeBtn',()=>switchView('#publicView'));
 click('#backBtn',()=>switchView('#publicView'));
 click('#adminOpenBtn',openAdmin);
 on('#loginForm','submit',login);
 click('#logoutBtn',logout);

 change('#officeSelect',renderEquipment);
 click('#newOfficeBtn',()=>createCatalog('office'));
 click('#newEquipmentBtn',()=>createCatalog('equipment'));
 click('#downloadCollectorBtn',downloadCollector);

 $$('.admin-tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
 $$('.settings-item').forEach(b=>b.addEventListener('click',()=>switchSetting(b.dataset.setting)));

 change('#pageSize',()=>{state.page=0;loadInventory()});
 let searchTimer;
 on('#inventoryFilter','input',e=>{
   clearTimeout(searchTimer);
   searchTimer=setTimeout(()=>{
     state.filter=e.target.value;
     state.page=0;
     loadInventory();
   },300);
 });

 // La v1.2.x usa paginación duplicada arriba y abajo: NO existen #prevPage/#nextPage.
 $$('.pager-prev').forEach(btn=>btn.addEventListener('click',()=>{
   if(state.page>0){state.page--;loadInventory()}
 }));
 $$('.pager-next').forEach(btn=>btn.addEventListener('click',()=>{
   const pages=Math.max(1,Math.ceil(state.total/state.size));
   if(state.page+1<pages){state.page++;loadInventory()}
 }));

 on('#inventoryBody','click',e=>{
   const b=e.target.closest('button');
   if(!b)return;
   const id=b.dataset.id;
   if(b.classList.contains('view-row'))viewRow(id);
   if(b.classList.contains('edit-row'))editRow(id);
   if(b.classList.contains('delete-row'))deleteIds([id]);
 });
 on('#inventoryBody','change',e=>{
   if(!e.target.classList.contains('row-check'))return;
   const id=e.target.dataset.id;
   e.target.checked?state.selected.add(id):state.selected.delete(id);
   syncSelectionUI();
 });

 change('#selectPage',e=>{
   state.rows.forEach(r=>e.target.checked?state.selected.add(r.id):state.selected.delete(r.id));
   renderInventory();
 });
 click('#clearSelectionBtn',()=>{state.selected.clear();renderInventory()});
 click('#deleteSelectedBtn',()=>deleteIds([...state.selected]));

 $('#sourceSheetTabs')?.addEventListener('click',e=>{const b=e.target.closest('.source-sheet-tab');if(b)changeSourceView(b.dataset.sourceSheet)});
 change('#exportScope',e=>{state.exportScope=e.target.value||'current'});
 change('#importMode',()=>{if(state.importSheet)renderImportCandidate(state.importSheet)});
 click('#exportCsvBtn',exportCSV);
 click('#exportPdfBtn',exportPDF);
 click('#addAdminBtn',addAdmin);
 click('#saveBrandingBtn',saveBranding);

 click('#attachPatchBtn',()=>$('#patchInput')?.click());
 change('#patchInput',e=>{const f=e.target.files?.[0];if(f)selectPatch(f)});
 click('#installPatchBtn',installPatch);
 click('#checkUpdatesBtn',checkUpdates);

 click('#toggleSmartFiltersBtn',()=>$('#smartFilters')?.classList.toggle('is-collapsed'));
 const smartMap={filterOffice:'office',filterStatus:'status',filterLicense:'license',filterRam:'ram',filterTag:'tag',groupBy:'group'};
 Object.entries(smartMap).forEach(([id,key])=>{
   change('#'+id,e=>{state.filters[key]=e.target.value;state.page=0;loadInventory()});
 });
 click('#clearFiltersBtn',()=>{
   state.filter='';
   if($('#inventoryFilter'))$('#inventoryFilter').value='';
   state.filters={office:'',status:'',license:'',ram:'',tag:'',group:''};
   Object.keys(smartMap).forEach(id=>{const el=$('#'+id);if(el)el.value=''});
   state.page=0;
   loadInventory();
 });

 click('#createTagBtn',createTag);
 click('#assignTagBtn',assignTag);

 change('#importFile',e=>{
   const f=e.target.files?.[0];
   if(f)parseImportFile(f).catch(err=>msg('error','No se pudo leer la planilla',err.message));
 });
 change('#importSheetSelect',e=>{
   const c=state.importCandidates?.[Number(e.target.value)];
   if(c){
     $('#importOfficeFallback').value=c.meta?.office_name||'';
     renderImportCandidate(c);
   }
 });
 $('#importOfficeFallback')?.addEventListener('input',()=>{
   if(state.importSheet)renderImportCandidate(state.importSheet);
 });
 click('#runImportBtn',runImport);

 click('#refreshOfficesBtn',loadOfficesAdmin);
 on('#officesAdminBody','click',e=>{
   const b=e.target.closest('.edit-office');
   if(b)editOffice(b.dataset.id);
 });

 // Estado inicial de acciones sensibles según rol.
 syncSelectionUI();
}

async function init(){
 try{bind()}catch(e){console.error('RM bind error',e)}
 try{setConnection()}catch(e){console.warn('RM connection badge',e)}
 if($('#versionBadge'))$('#versionBadge').textContent='v'+APP_VERSION;
 if($('#installedVersion'))$('#installedVersion').textContent='v'+APP_VERSION;

 // Catálogos públicos son críticos: se cargan aunque falle un módulo opcional.
 try{await loadCatalogs()}catch(e){
   console.error('RM loadCatalogs error',e);
   const badge=$('#connectionBadge');
   if(badge){badge.textContent='• Error cargando catálogos';badge.classList.add('bad')}
 }
 try{await loadSettings()}catch(e){console.warn('RM loadSettings',e)}
 try{const f=await idbGet();if(f)await selectPatch(f)}catch(e){console.warn('RM patch cache',e)}
 if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
}
document.addEventListener('DOMContentLoaded',init);
})();