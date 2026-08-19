(() => {
'use strict';
const APP_VERSION='1.0.0';
const C=window.MEDTUC_CONFIG||{};
const configured=Boolean(C.SUPABASE_URL&&C.SUPABASE_ANON_KEY);
const sb=configured?window.supabase.createClient(C.SUPABASE_URL.replace(/\/$/,''),C.SUPABASE_ANON_KEY):null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={page:0,size:10,filter:'',rows:[],total:0,user:null,role:null,selected:new Set(),poll:null,patch:null,settings:null};
const swal={background:'#101827',color:'#edf4ff',confirmButtonColor:'#6ca8ff',cancelButtonColor:'#65758a'};
const msg=(icon,title,text='')=>Swal.fire({...swal,icon,title,text,confirmButtonText:'Aceptar'});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=v=>String(v??'').trim().slice(0,120);
const fmt=v=>v?new Date(v).toLocaleString('es-AR'):'—';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function switchView(id){$$('.view').forEach(v=>v.classList.remove('active'));$(id).classList.add('active');scrollTo({top:0,behavior:'smooth'})}
function setConnection(){$('#connectionBadge').textContent=configured?'● Supabase configurado':'● Falta configurar Supabase';$('#connectionBadge').style.color=configured?'#69d6a5':'#ffd27d'}
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
   const m={name,short_name:shortName,start_url:'./',display:'standalone',background_color:'#08111f',theme_color:'#08111f',
     icons:[{src:icon,sizes:'192x192',purpose:'any'},{src:icon,sizes:'512x512',purpose:'any maskable'}]};
   const blob=new Blob([JSON.stringify(m)],{type:'application/manifest+json'});
   const url=URL.createObjectURL(blob); $('#manifestLink').href=url;
 }catch{}
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
function collectorPS(officeId,equipmentId,officeName,equipmentName){
 const endpoint=C.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/register_inventory';
 return `$ErrorActionPreference='Stop'\r\n`+
`$Endpoint='${psQuote(endpoint)}'\r\n$Anon='${psQuote(C.SUPABASE_ANON_KEY)}'\r\n$OfficeId='${psQuote(officeId)}'\r\n$EquipmentId='${psQuote(equipmentId)}'\r\n$OfficeName='${psQuote(officeName)}'\r\n$EquipmentName='${psQuote(equipmentName)}'\r\n`+
`function CVal{param([object]$V,[string]$F='No detectado');if($null -eq $V){return $F};$T=([string]$V).Trim();if([string]::IsNullOrEmpty($T)){return $F};return $T}\r\n`+
`try{\r\ntry{[Net.ServicePointManager]::SecurityProtocol=[Enum]::ToObject([Net.SecurityProtocolType],3072)}catch{}\r\n`+
`Write-Host '============================================================' -ForegroundColor DarkCyan\r\nWrite-Host ' RELEVAMIENTO MANAGER - RECOPILADOR v${APP_VERSION}' -ForegroundColor Cyan\r\nWrite-Host ' Direccion de Informatica - Ministerio de Educacion Tucuman' -ForegroundColor Gray\r\nWrite-Host '============================================================' -ForegroundColor DarkCyan\r\n`+
`$cs=Get-WmiObject Win32_ComputerSystem|Select-Object -First 1;$csp=Get-WmiObject Win32_ComputerSystemProduct|Select-Object -First 1;$cpu=Get-WmiObject Win32_Processor|Select-Object -First 1;$os=Get-WmiObject Win32_OperatingSystem|Select-Object -First 1;$board=Get-WmiObject Win32_BaseBoard|Select-Object -First 1;$bios=Get-WmiObject Win32_BIOS|Select-Object -First 1;$gpu=Get-WmiObject Win32_VideoController|Where-Object{$_.Name}|Select-Object -First 1;$disks=@(Get-WmiObject Win32_DiskDrive|Where-Object{[double]$_.Size -gt 0});$rams=@(Get-WmiObject Win32_PhysicalMemory)\r\n`+
`$rb=($rams|Measure-Object Capacity -Sum).Sum;if(-not $rb){$rb=$cs.TotalPhysicalMemory};$ramGB=[math]::Round(([double]$rb/1GB),0);$mm=@{20='DDR';21='DDR2';24='DDR3';26='DDR4';34='DDR5'};$rt=@();foreach($m in $rams){$tc=0;if($m.PSObject.Properties['SMBIOSMemoryType']){$tc=[int]$m.SMBIOSMemoryType};if($mm.ContainsKey($tc)){$rt+=$mm[$tc]}elseif($m.MemoryType -and $mm.ContainsKey([int]$m.MemoryType)){$rt+=$mm[[int]$m.MemoryType]}};$ramType=if($rt.Count){($rt|Select-Object -Unique)-join ', '}else{'No detectado'}\r\n`+
`$sp=@();foreach($d in $disks){$gb=[math]::Round(([double]$d.Size/1GB),0);$dm=CVal $d.Model;$kind='HDD';if(($d.MediaType -match 'SSD|Solid')-or($dm -match 'SSD|Solid')){$kind='SSD'}elseif($d.InterfaceType -match 'USB'){$kind='USB'};$sp+=("{0} GB ({1}) {2}"-f $gb,$kind,$dm)};$storage=if($sp.Count){$sp -join ' + '}else{'No detectado'}\r\n`+
`$cv='HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';$dv='';$pid='';try{$reg=Get-ItemProperty $cv;$dv=if($reg.DisplayVersion){$reg.DisplayVersion}elseif($reg.ReleaseId){$reg.ReleaseId}else{''};$pid=$reg.ProductId}catch{};$arch=CVal $os.OSArchitecture;if($arch -eq 'No detectado'){$arch=if([IntPtr]::Size -eq 8){'64 bits'}else{'32 bits'}};$inst='';try{$inst=[Management.ManagementDateTimeConverter]::ToDateTime($os.InstallDate).ToString('yyyy-MM-dd HH:mm:ss')}catch{}\r\n`+
`$ls='Desconocido';$lc='No detectado';$pk='';$ok='';try{$lic=Get-WmiObject SoftwareLicensingProduct|Where-Object{$_.PartialProductKey -and $_.Name -match 'Windows'}|Sort-Object LicenseStatus -Descending|Select-Object -First 1;if($lic){if([int]$lic.LicenseStatus -eq 1){$ls='Licenciado'}else{$ls='No licenciado'};$pk=CVal $lic.PartialProductKey '';$lc=CVal $lic.Description}}catch{};try{$svc=Get-WmiObject SoftwareLicensingService|Select-Object -First 1;if($svc.PSObject.Properties['OA3xOriginalProductKey']){$ok=CVal $svc.OA3xOriginalProductKey ''}}catch{}\r\n`+
`$bm=CVal $board.Manufacturer '';$bp=CVal $board.Product '';$mb=("$bm $bp").Trim();if(!$mb){$mb='No detectado'};$fn=$env:COMPUTERNAME;if($cs.Domain -and $cs.Domain -ne 'WORKGROUP' -and $cs.Domain -ne $env:COMPUTERNAME){$fn="$($env:COMPUTERNAME).$($cs.Domain)"}\r\n`+
`$p=@{office_id=$OfficeId;equipment_id=$EquipmentId;office_name=$OfficeName;equipment_name=$EquipmentName;brand=(CVal $cs.Manufacturer);model=(CVal $cs.Model);processor=(CVal $cpu.Name);cores=[int]$cpu.NumberOfCores;operating_system=("{0} ({1})"-f(CVal $os.Caption),$arch);motherboard=$mb;ram_gb=[int]$ramGB;ram_type=$ramType;storage=$storage;graphics=(CVal $gpu.Name);hostname=$env:COMPUTERNAME;full_device_name=$fn;domain_workgroup=(CVal $cs.Domain);system_type=(CVal $cs.SystemType);device_uuid=(CVal $csp.UUID);product_id=(CVal $pid);windows_version=(CVal $dv);windows_build=(CVal $os.BuildNumber);windows_install_date=(CVal $inst);bios_serial=(CVal $bios.SerialNumber);bios_version=(CVal (($bios.SMBIOSBIOSVersion -join ' ')));windows_license_status=$ls;windows_license_channel=$lc;windows_partial_product_key=$pk;windows_oem_key=$ok;collector_version='${APP_VERSION}'}\r\n`+
`Add-Type -AssemblyName System.Web.Extensions;$s=New-Object System.Web.Script.Serialization.JavaScriptSerializer;$j=$s.Serialize(@{p_payload=$p});$w=New-Object Net.WebClient;$w.Encoding=[Text.Encoding]::UTF8;$w.Headers.Add('apikey',$Anon);$w.Headers.Add('Authorization','Bearer '+$Anon);$w.Headers.Add('Content-Type','application/json');$r=$w.UploadString($Endpoint,'POST',$j)\r\n`+
`Write-Host '';Write-Host 'DATOS GUARDADOS CORRECTAMENTE.' -ForegroundColor Green;Write-Host $r -ForegroundColor Cyan\r\n`+
`Write-Host '';Write-Host 'RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina' -ForegroundColor DarkGray;Write-Host 'by Ing. Fernando Gambino - https://github.com/fmgambino - Todos los Derechos Registrados' -ForegroundColor DarkGray;Read-Host 'Presione ENTER para cerrar'\r\n`+
`}catch{Write-Host '';Write-Host ('ERROR: '+$_.Exception.Message) -ForegroundColor Red;Write-Host 'Verifique Internet e intente nuevamente.' -ForegroundColor Yellow;Write-Host '';Write-Host 'RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina' -ForegroundColor DarkGray;Write-Host 'by Ing. Fernando Gambino - https://github.com/fmgambino - Todos los Derechos Registrados' -ForegroundColor DarkGray;Read-Host 'Presione ENTER para cerrar';exit 1}\r\n`;
}
function utf16leBase64(s){let bin='';for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);bin+=String.fromCharCode(c&255,c>>8)}return btoa(bin)}
function buildBat(ps,name){const b64=utf16leBase64(ps);return `@echo off\r\nchcp 65001 >nul\r\ntitle RELEVAMIENTO MANAGER - Registro de equipo\r\necho RELEVAMIENTO MANAGER - Direccion de Informatica\r\necho Ministerio de Educacion Tucuman\r\necho Preparando recopilador para ${name.replace(/[&|<>^%]/g,'')}\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}\r\n`}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
async function downloadCollector(){
 const oid=$('#officeSelect').value,eid=$('#equipmentSelect').value;if(!oid||!eid)return msg('warning','Faltan datos','Seleccioná oficina y equipo.');
 const on=$('#officeSelect').selectedOptions[0].textContent,en=$('#equipmentSelect').selectedOptions[0].textContent;
 const {data:st}=await sb.rpc('inventory_submission_status',{p_equipment_id:eid});
 const row=Array.isArray(st)?st[0]:st;if(row?.completed)return msg('success','Relevamiento completado','Este equipo ya fue relevado correctamente 3 veces y está cargado al inventario principal.');
 const ps=collectorPS(oid,eid,on,en),bat=buildBat(ps,en),fn='MEDTUC_'+en.replace(/[^\w.-]+/g,'_')+'.bat';
 downloadBlob(new Blob([bat],{type:'application/x-bat'}),fn);
 $('#pollCard').classList.remove('hidden');$('#pollText').textContent=`Ejecutá ${fn}. Esta será la ejecución ${(row?.submission_count||0)+1} de 3.`;
 if(state.poll)clearInterval(state.poll);state.poll=setInterval(()=>pollInventory(eid),3000);
 msg('info','Recopilador descargado',`Abrí ${fn} con doble clic.`);
}
async function pollInventory(eid){
 const {data}=await sb.rpc('inventory_submission_status',{p_equipment_id:eid});const r=Array.isArray(data)?data[0]:data;
 if(r?.exists){clearInterval(state.poll);$('#pollTitle').textContent='Equipo registrado correctamente';$('#pollText').textContent=`Registro confirmado. Ejecución ${r.submission_count} de 3.`;msg('success','Registro confirmado',`El inventario fue impactado correctamente (${r.submission_count}/3).`)}
}

async function openAdmin(){switchView('#adminView');if(sb){const {data}=await sb.auth.getSession();if(data.session)await hydrateSession(data.session)}}
async function login(ev){ev.preventDefault();const email=$('#adminEmail').value.trim(),password=$('#adminPassword').value;const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)return msg('error','No se pudo ingresar',error.message);await hydrateSession(data.session)}
async function hydrateSession(session){
 state.user=session.user;
 const {data,error}=await sb.from('admin_users').select('role,display_name').eq('user_id',state.user.id).maybeSingle();
 if(error||!data){await sb.auth.signOut();return msg('error','Acceso denegado','Este usuario no tiene permisos administrativos.')}
 state.role=data.role;$('#loginCard').classList.add('hidden');$('#adminPanel').classList.remove('hidden');$('#logoutBtn').classList.remove('hidden');$('#roleChip').textContent=isSuper()?'SuperAdmin':'Administrador';
 $$('.super-only').forEach(x=>x.classList.toggle('hidden',!isSuper()));await loadInventory();if(isSuper()){await loadAdmins();await loadSettings();await loadHistory()}
}
async function logout(){await sb.auth.signOut();state.user=null;state.role=null;$('#adminPanel').classList.add('hidden');$('#loginCard').classList.remove('hidden');$('#logoutBtn').classList.add('hidden')}
function switchTab(name){$$('.admin-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.admin-section').forEach(s=>s.classList.toggle('active',s.dataset.section===name));if(name==='admins')loadAdmins();if(name==='settings'){loadSettings();loadHistory()}}
function switchSetting(name){$$('.settings-item').forEach(b=>b.classList.toggle('active',b.dataset.setting===name));$$('.settings-pane').forEach(p=>p.classList.toggle('active',p.dataset.pane===name))}

async function loadInventory(){
 if(!state.user)return;state.size=Number($('#pageSize').value||10);
 let q=sb.from('inventories').select('*',{count:'exact'}).order('last_submitted_at',{ascending:false}).range(state.page*state.size,state.page*state.size+state.size-1);
 const f=state.filter.trim();if(f){const s=f.replace(/[%(),]/g,' ');q=q.or(`office_name.ilike.%${s}%,equipment_name.ilike.%${s}%,brand.ilike.%${s}%,processor.ilike.%${s}%,operating_system.ilike.%${s}%,hostname.ilike.%${s}%`)}
 const {data,error,count}=await q;if(error)return msg('error','No se pudo cargar inventario',error.message);state.rows=data||[];state.total=count||0;renderInventory();await loadStats();
}
async function loadStats(){
 const {data}=await sb.from('inventories').select('windows_license_status,submission_count');
 const rows=data||[];$('#statTotal').textContent=rows.length;$('#statLicensed').textContent=rows.filter(r=>/licenciado/i.test(r.windows_license_status||'')&&!/no licenciado/i.test(r.windows_license_status||'')).length;$('#statUnlicensed').textContent=rows.filter(r=>/no licenciado/i.test(r.windows_license_status||'')).length;$('#statComplete').textContent=rows.filter(r=>(r.submission_count||0)>=3).length;
}
const eyeSvg='<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>';
const editSvg='<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
const trashSvg='<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M7 6l1 14h8l1-14"/></svg>';
function licenseStatus(r){const s=(r.windows_license_status||'Desconocido').toLowerCase();if(s.includes('no licenciado'))return ['bad','No licenciado'];if(s.includes('licenciado'))return ['ok','Licenciado'];return ['warn','Desconocido']}
function renderInventory(){
 $('#inventoryBody').innerHTML=state.rows.map(r=>{const [lc,lt]=licenseStatus(r);const done=(r.submission_count||0)>=3;return `<tr>
 <td><input class="row-check" type="checkbox" data-id="${esc(r.id)}" ${state.selected.has(r.id)?'checked':''}></td>
 <td><span class="status ${done?'ok':'warn'}">${done?'Completo':'En proceso'}</span></td>
 <td>${esc(fmt(r.last_submitted_at))}</td><td>${esc(r.office_name)}</td><td>${esc(r.equipment_name)}</td><td>${esc((r.brand||'')+' '+(r.model||''))}</td><td>${esc(r.processor||'—')}</td><td>${esc(r.ram_gb||'—')} GB ${esc(r.ram_type||'')}</td><td>${esc(r.operating_system||'—')}</td><td><span class="status ${lc}">${lt}</span></td><td>${esc(r.submission_count||0)}/3</td>
 <td><div class="action-group"><button class="action-btn view-row" data-id="${r.id}" title="Ver">${eyeSvg}</button><button class="action-btn edit-row" data-id="${r.id}" title="Editar">${editSvg}</button><button class="action-btn delete-row" data-id="${r.id}" title="Eliminar">${trashSvg}</button></div></td></tr>`}).join('')||'<tr><td colspan="12">Sin registros.</td></tr>';
 const pages=Math.max(1,Math.ceil(state.total/state.size));$('#pagerInfo').textContent=`Página ${state.page+1} de ${pages} · ${state.total} registros`;$('#prevPage').disabled=state.page===0;$('#nextPage').disabled=state.page+1>=pages;syncSelectionUI();
}
function syncSelectionUI(){$('#selectedCount').textContent=`${state.selected.size} seleccionados`;$('#deleteSelectedBtn').disabled=!state.selected.size;$('#selectPage').checked=state.rows.length>0&&state.rows.every(r=>state.selected.has(r.id))}
function detailsHtml(r){const fields=[['Oficina',r.office_name],['Equipo',r.equipment_name],['Host',r.hostname],['Marca',r.brand],['Modelo',r.model],['Procesador',r.processor],['Núcleos',r.cores],['RAM',`${r.ram_gb||'—'} GB ${r.ram_type||''}`],['Almacenamiento',r.storage],['Gráfica',r.graphics],['Windows',r.operating_system],['Versión',r.windows_version],['Build',r.windows_build],['Product ID',r.product_id],['Licencia',r.windows_license_status],['Canal',r.windows_license_channel],['Clave parcial',r.windows_partial_product_key],['OEM Key',r.windows_oem_key],['Placa madre',r.motherboard],['BIOS Serial',r.bios_serial],['BIOS',r.bios_version],['UUID',r.device_uuid],['Dominio/Grupo',r.domain_workgroup],['Sistema',r.system_type],['Relevamientos',`${r.submission_count}/3`]];return `<div class="details-grid">${fields.map(([a,b])=>`<div><b>${esc(a)}</b>${esc(b||'—')}</div>`).join('')}</div>`}
async function viewRow(id){const r=state.rows.find(x=>x.id===id);if(r)Swal.fire({...swal,title:esc(r.equipment_name),html:detailsHtml(r),width:850,confirmButtonText:'Cerrar'})}
async function editRow(id){
 const r=state.rows.find(x=>x.id===id);if(!r)return;
 const {value:v}=await Swal.fire({...swal,title:'Editar inventario',html:`<input id="eOffice" class="swal2-input" value="${esc(r.office_name)}" placeholder="Oficina"><input id="eEquip" class="swal2-input" value="${esc(r.equipment_name)}" placeholder="Equipo"><input id="eBrand" class="swal2-input" value="${esc(r.brand||'')}" placeholder="Marca"><input id="eModel" class="swal2-input" value="${esc(r.model||'')}" placeholder="Modelo">`,showCancelButton:true,confirmButtonText:'Guardar',cancelButtonText:'Cancelar',preConfirm:()=>({office_name:clean($('#eOffice').value),equipment_name:clean($('#eEquip').value),brand:clean($('#eBrand').value),model:clean($('#eModel').value)})});
 if(!v)return;const {error}=await sb.from('inventories').update(v).eq('id',id);if(error)return msg('error','No se pudo editar',error.message);await loadInventory();msg('success','Registro actualizado');
}
async function deleteIds(ids){
 if(!ids.length)return;const ok=await Swal.fire({...swal,icon:'warning',title:`Eliminar ${ids.length} registro(s)`,text:'Esta acción no se puede deshacer.',showCancelButton:true,confirmButtonText:'Eliminar',cancelButtonText:'Cancelar',confirmButtonColor:'#d65f69'});if(!ok.isConfirmed)return;
 const {error}=await sb.from('inventories').delete().in('id',ids);if(error)return msg('error','No se pudo eliminar',error.message);ids.forEach(id=>state.selected.delete(id));await loadInventory();msg('success','Eliminación completada');
}
function csvEscape(v){const s=String(v??'');return `"${s.replace(/"/g,'""')}"`}
async function allInventory(){const {data,error}=await sb.from('inventories').select('*').order('last_submitted_at',{ascending:false});if(error)throw error;return data||[]}
async function exportCSV(){try{const rows=await allInventory(),cols=['last_submitted_at','office_name','equipment_name','brand','model','processor','cores','ram_gb','ram_type','storage','graphics','operating_system','windows_version','windows_build','windows_license_status','windows_license_channel','windows_partial_product_key','hostname','motherboard','bios_serial','device_uuid','submission_count'];const csv=[cols.join(','),...rows.map(r=>cols.map(c=>csvEscape(r[c])).join(','))].join('\r\n');downloadBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`inventario_${Date.now()}.csv`)}catch(e){msg('error','No se pudo exportar',e.message)}}
async function exportPDF(){try{const rows=await allInventory();const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape'});let logo=null;try{const res=await fetch($('#brandLogo').src);const blob=await res.blob();logo=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(blob)})}catch{};if(logo)doc.addImage(logo,'PNG',12,8,34,15);doc.setFontSize(15);doc.text('RELEVAMIENTO MANAGER - Inventario de Equipos',52,15);doc.setFontSize(9);doc.text(`Fecha: ${new Date().toLocaleString('es-AR')} · Usuario: ${state.user.email}`,52,21);doc.autoTable({startY:28,head:[['Oficina','Equipo','Marca/Modelo','CPU','RAM','Windows','Licencia','3x']],body:rows.map(r=>[r.office_name,r.equipment_name,`${r.brand||''} ${r.model||''}`,r.processor,`${r.ram_gb||''} GB ${r.ram_type||''}`,r.operating_system,r.windows_license_status,`${r.submission_count}/3`]),styles:{fontSize:7},headStyles:{fillColor:[30,50,78]}});const y=doc.internal.pageSize.height-8;doc.setFontSize(7);doc.text('RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina · by Ing. Fernando Gambino · Todos los Derechos Registrados',12,y);doc.save(`inventario_${Date.now()}.pdf`)}catch(e){msg('error','No se pudo generar PDF',e.message)}}

async function invokeFn(name,body){
 const {data,error}=await sb.functions.invoke(name,{body});if(error){let detail=error.message;try{if(error.context){const j=await error.context.json();detail=j.error||j.message||detail}}catch{}throw new Error(detail)}return data;
}
async function loadAdmins(){if(!isSuper())return;try{const d=await invokeFn('medtuc-admins',{action:'list'});$('#adminsBody').innerHTML=(d.users||[]).map(u=>`<tr><td>${esc(u.display_name||'—')}</td><td>${esc(u.email||'—')}</td><td><span class="status ${u.role==='superadmin'?'ok':'warn'}">${esc(u.role)}</span></td><td>${esc(fmt(u.created_at))}</td></tr>`).join('')||'<tr><td colspan="4">Sin usuarios.</td></tr>'}catch(e){$('#adminsBody').innerHTML='<tr><td colspan="4">No se pudo cargar el listado.</td></tr>';msg('error','Administradores',e.message)}}
async function addAdmin(){
 const {value:v}=await Swal.fire({...swal,title:'Nuevo usuario administrativo',html:`<input id="aName" class="swal2-input" placeholder="Nombre y apellido"><input id="aEmail" type="email" class="swal2-input" placeholder="Email"><input id="aPass" type="password" class="swal2-input" placeholder="Contraseña (mín. 8)"><select id="aRole" class="swal2-select"><option value="admin">Administrador</option><option value="superadmin">SuperAdmin</option></select>`,showCancelButton:true,confirmButtonText:'Crear usuario',cancelButtonText:'Cancelar',preConfirm:()=>({display_name:clean($('#aName').value),email:clean($('#aEmail').value).toLowerCase(),password:$('#aPass').value,role:$('#aRole').value})});
 if(!v)return;try{await invokeFn('medtuc-admins',{action:'create',...v});await loadAdmins();msg('success','Usuario creado',`Se creó como ${v.role}.`)}catch(e){msg('error','No se pudo crear',e.message)}
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
 $('#homeBtn').onclick=()=>switchView('#publicView');$('#backBtn').onclick=()=>switchView('#publicView');$('#adminOpenBtn').onclick=openAdmin;$('#loginForm').onsubmit=login;$('#logoutBtn').onclick=logout;
 $('#officeSelect').onchange=renderEquipment;$('#newOfficeBtn').onclick=()=>createCatalog('office');$('#newEquipmentBtn').onclick=()=>createCatalog('equipment');$('#downloadCollectorBtn').onclick=downloadCollector;
 $$('.admin-tab').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));$$('.settings-item').forEach(b=>b.onclick=()=>switchSetting(b.dataset.setting));
 $('#pageSize').onchange=()=>{state.page=0;loadInventory()};let t;$('#inventoryFilter').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{state.filter=e.target.value;state.page=0;loadInventory()},300)};
 $('#prevPage').onclick=()=>{if(state.page>0){state.page--;loadInventory()}};$('#nextPage').onclick=()=>{state.page++;loadInventory()};
 $('#inventoryBody').onclick=e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.id;if(b.classList.contains('view-row'))viewRow(id);if(b.classList.contains('edit-row'))editRow(id);if(b.classList.contains('delete-row'))deleteIds([id])};
 $('#inventoryBody').onchange=e=>{if(!e.target.classList.contains('row-check'))return;const id=e.target.dataset.id;e.target.checked?state.selected.add(id):state.selected.delete(id);syncSelectionUI()};
 $('#selectPage').onchange=e=>{state.rows.forEach(r=>e.target.checked?state.selected.add(r.id):state.selected.delete(r.id));renderInventory()};$('#clearSelectionBtn').onclick=()=>{state.selected.clear();renderInventory()};$('#deleteSelectedBtn').onclick=()=>deleteIds([...state.selected]);
 $('#exportCsvBtn').onclick=exportCSV;$('#exportPdfBtn').onclick=exportPDF;$('#addAdminBtn').onclick=addAdmin;$('#saveBrandingBtn').onclick=saveBranding;
 $('#attachPatchBtn').onclick=()=>$('#patchInput').click();$('#patchInput').onchange=e=>selectPatch(e.target.files[0]);$('#installPatchBtn').onclick=installPatch;$('#checkUpdatesBtn').onclick=checkUpdates;
}
async function init(){bind();setConnection();$('#versionBadge').textContent='v'+APP_VERSION;$('#installedVersion').textContent='v'+APP_VERSION;await loadCatalogs();await loadSettings();try{const f=await idbGet();if(f)await selectPatch(f)}catch{}if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{})}
document.addEventListener('DOMContentLoaded',init);
})();