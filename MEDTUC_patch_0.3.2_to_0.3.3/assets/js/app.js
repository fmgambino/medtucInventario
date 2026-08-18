(() => {
  'use strict';
  const APP_VERSION = '0.3.3';
  const C = window.MEDTUC_CONFIG || {};
  const configured = Boolean(C.SUPABASE_URL && /^https:\/\/.+\.supabase\.co\/?$/i.test(C.SUPABASE_URL) && C.SUPABASE_ANON_KEY && C.SUPABASE_ANON_KEY.length > 20 && !/xxxx|TU_ANON/i.test(C.SUPABASE_ANON_KEY));
  const sb = configured ? window.supabase.createClient(C.SUPABASE_URL.replace(/\/$/,''), C.SUPABASE_ANON_KEY) : null;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const state = { page:0,size:10,filter:'',rows:[],total:0,user:null,role:null,poll:null,availablePatch:null,localPatchFile:null,selected:new Set() };

  const swalBase = {background:'#101827',color:'#edf4ff',confirmButtonColor:'#6ca8ff'};
  const toast = (icon,title,text='') => Swal.fire({...swalBase,icon,title,text,confirmButtonText:'Aceptar'});
  const safeText = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeName = v => String(v||'').trim().replace(/[<>]/g,'').slice(0,80);
  const fmtDate = v => v ? new Date(v).toLocaleString('es-AR') : '—';
  const baseUrl = () => (C.PROJECT_URL || location.href).replace(/[^/]*$/,'').replace(/\/$/,'') + '/';

  function setBadge(){
    const el=$('#connectionBadge');
    if(configured){el.textContent='● Supabase configurado';el.style.color='#69d6a5'}
    else{el.textContent='● Falta configurar Supabase';el.style.color='#ffd27d'}
  }
  async function loadCatalogs(){
    if(!sb) return;
    const [{data:offices,error:oe},{data:equipment,error:ee}] = await Promise.all([
      sb.from('offices').select('id,name').order('name'), sb.from('equipment_names').select('id,name,office_id').order('name')
    ]);
    if(oe||ee) return toast('error','No se pudo cargar el catálogo',(oe||ee).message);
    const o=$('#officeSelect');o.innerHTML='<option value="">Seleccionar…</option>'+(offices||[]).map(x=>`<option value="${safeText(x.id)}">${safeText(x.name)}</option>`).join('');
    o.dataset.items=JSON.stringify(offices||[]);$('#equipmentSelect').dataset.items=JSON.stringify(equipment||[]);renderEquipment();
  }
  function renderEquipment(){
    const oid=$('#officeSelect').value;let items=[];try{items=JSON.parse($('#equipmentSelect').dataset.items||'[]')}catch{}
    items=items.filter(x=>!oid||x.office_id===oid);$('#equipmentSelect').innerHTML='<option value="">Seleccionar…</option>'+items.map(x=>`<option value="${safeText(x.id)}">${safeText(x.name)}</option>`).join('');
  }
  async function createCatalog(type){
    if(!sb) return toast('info','Supabase no configurado','Completá assets/js/config.js.');
    const officeId=$('#officeSelect').value;if(type==='equipment'&&!officeId) return toast('warning','Primero seleccioná una oficina');
    const {value:name}=await Swal.fire({...swalBase,title:type==='office'?'Nueva oficina':'Nuevo equipo',input:'text',inputLabel:type==='office'?'Nombre de la oficina':'Nombre del equipo',showCancelButton:true,confirmButtonText:'Crear',cancelButtonText:'Cancelar',inputValidator:v=>!safeName(v)?'Ingresá un nombre válido':undefined});
    if(!name) return;const payload=type==='office'?{name:safeName(name)}:{name:safeName(name),office_id:officeId};const table=type==='office'?'offices':'equipment_names';
    const {error}=await sb.from(table).insert(payload);if(error) return toast('error','No se pudo crear',error.message);await loadCatalogs();toast('success','Creado correctamente','Este dato no puede editarse ni borrarse desde el portal.');
  }

  function psQuote(s){return String(s??'').replace(/'/g,"''")}
  function collectorPowerShell(officeId,equipmentId,officeName,equipmentName){
    const endpoint=(C.SUPABASE_URL||'').replace(/\/$/,'')+'/rest/v1/rpc/register_inventory';
    return `$ErrorActionPreference = 'Stop'\r\n`+
`$SupabaseEndpoint='${psQuote(endpoint)}'\r\n$AnonKey='${psQuote(C.SUPABASE_ANON_KEY)}'\r\n$OfficeId='${psQuote(officeId)}'\r\n$EquipmentId='${psQuote(equipmentId)}'\r\n$OfficeName='${psQuote(officeName)}'\r\n$EquipmentName='${psQuote(equipmentName)}'\r\n`+
`function CleanValue { param([object]$Value,[string]$Fallback='No detectado'); if($null -eq $Value){return $Fallback}; $Text=([string]$Value).Trim(); if([string]::IsNullOrEmpty($Text)){return $Fallback}; return $Text }\r\n`+
`try {\r\n  try {[Net.ServicePointManager]::SecurityProtocol = [Enum]::ToObject([Net.SecurityProtocolType],3072)} catch {}\r\n  Write-Host ''\r\n  Write-Host '============================================================' -ForegroundColor DarkCyan\r\n  Write-Host ' RELEVAMIENTO MANAGER - RECOPILADOR v0.3.3' -ForegroundColor Cyan\r\n  Write-Host ' Direccion de Informatica - Ministerio de Educacion Tucuman' -ForegroundColor Gray\r\n  Write-Host '============================================================' -ForegroundColor DarkCyan\r\n  Write-Host 'Recopilando datos del equipo...' -ForegroundColor White\r\n  $cs=Get-WmiObject -Class Win32_ComputerSystem | Select-Object -First 1\r\n  $csp=Get-WmiObject -Class Win32_ComputerSystemProduct | Select-Object -First 1\r\n  $cpu=Get-WmiObject -Class Win32_Processor | Select-Object -First 1\r\n  $os=Get-WmiObject -Class Win32_OperatingSystem | Select-Object -First 1\r\n  $board=Get-WmiObject -Class Win32_BaseBoard | Select-Object -First 1\r\n  $bios=Get-WmiObject -Class Win32_BIOS | Select-Object -First 1\r\n  $gpu=Get-WmiObject -Class Win32_VideoController | Where-Object {$_.Name} | Select-Object -First 1\r\n  $disks=@(Get-WmiObject -Class Win32_DiskDrive | Where-Object {[double]$_.Size -gt 0})\r\n  $rams=@(Get-WmiObject -Class Win32_PhysicalMemory)\r\n  $ramBytes=($rams | Measure-Object -Property Capacity -Sum).Sum\r\n  if(-not $ramBytes){$ramBytes=$cs.TotalPhysicalMemory}\r\n  $ramGB=[math]::Round(([double]$ramBytes/1GB),0)\r\n  $memMap=@{20='DDR';21='DDR2';22='DDR2 FB-DIMM';24='DDR3';26='DDR4';34='DDR5'}\r\n  $ramTypes=@()\r\n  foreach($mem in $rams){$typeCode=0; if($mem.PSObject.Properties['SMBIOSMemoryType']){$typeCode=[int]$mem.SMBIOSMemoryType}; if($memMap.ContainsKey($typeCode)){$ramTypes+=$memMap[$typeCode]} elseif($mem.MemoryType -and $memMap.ContainsKey([int]$mem.MemoryType)){$ramTypes+=$memMap[[int]$mem.MemoryType]}}\r\n  $ramType=if($ramTypes.Count -gt 0){($ramTypes | Select-Object -Unique) -join ', '}else{'No detectado'}\r\n  $storageParts=@(); foreach($disk in $disks){$gb=[math]::Round(([double]$disk.Size/1GB),0);$diskModel=CleanValue -Value $disk.Model;$kind='HDD';if(($disk.MediaType -match 'SSD|Solid') -or ($diskModel -match 'SSD|Solid')){$kind='SSD'}elseif($disk.InterfaceType -match 'USB'){$kind='USB'};$storageParts+=("{0} GB ({1}) {2}" -f $gb,$kind,$diskModel)}\r\n  $storage=if($storageParts.Count -gt 0){$storageParts -join ' + '}else{'No detectado'}\r\n  $fullName=$env:COMPUTERNAME; if($cs.Domain -and $cs.Domain -ne 'WORKGROUP' -and $cs.Domain -ne $env:COMPUTERNAME){$fullName="$($env:COMPUTERNAME).$($cs.Domain)"}\r\n  $installDate=''; try{$installDate=[Management.ManagementDateTimeConverter]::ToDateTime($os.InstallDate).ToString('yyyy-MM-dd HH:mm:ss')}catch{}\r\n  $cv='HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';$displayVersion='';$productId='';try{$reg=Get-ItemProperty -Path $cv;$displayVersion=if($reg.DisplayVersion){$reg.DisplayVersion}elseif($reg.ReleaseId){$reg.ReleaseId}else{''};$productId=$reg.ProductId}catch{}\r\n  $arch=CleanValue -Value $os.OSArchitecture; if($arch -eq 'No detectado'){if([IntPtr]::Size -eq 8){$arch='64 bits'}else{$arch='32 bits'}}\r\n  $licenseStatus='Desconocido';$licenseChannel='No detectado';$partialKey='';$oemKey=''
  try {
    $lic=Get-WmiObject -Class SoftwareLicensingProduct | Where-Object {$_.PartialProductKey -and $_.Name -match 'Windows'} | Sort-Object LicenseStatus -Descending | Select-Object -First 1
    if($lic){if([int]$lic.LicenseStatus -eq 1){$licenseStatus='Licenciado'}else{$licenseStatus='No licenciado'};$partialKey=CleanValue -Value $lic.PartialProductKey -Fallback '';$licenseChannel=CleanValue -Value $lic.Description}
  } catch {}
  try {$svc=Get-WmiObject -Class SoftwareLicensingService | Select-Object -First 1; if($svc -and $svc.PSObject.Properties['OA3xOriginalProductKey']){$oemKey=CleanValue -Value $svc.OA3xOriginalProductKey -Fallback ''}} catch {}
  $boardManufacturer=CleanValue -Value $board.Manufacturer -Fallback ''\r\n  $boardProduct=CleanValue -Value $board.Product -Fallback ''\r\n  $motherboard=("{0} {1}" -f $boardManufacturer,$boardProduct).Trim(); if([string]::IsNullOrEmpty($motherboard)){$motherboard='No detectado'}\r\n  $payload=@{\r\n    office_id=$OfficeId; equipment_id=$EquipmentId; office_name=$OfficeName; equipment_name=$EquipmentName;\r\n    brand=(CleanValue -Value $cs.Manufacturer); model=(CleanValue -Value $cs.Model); processor=(CleanValue -Value $cpu.Name); cores=[int]$cpu.NumberOfCores;\r\n    operating_system=("{0} ({1})" -f (CleanValue -Value $os.Caption),$arch); windows_version=(CleanValue -Value $displayVersion); windows_build=(CleanValue -Value $os.BuildNumber); windows_install_date=(CleanValue -Value $installDate);\r\n    motherboard=$motherboard; ram_gb=[int]$ramGB; ram_type=$ramType; storage=$storage; graphics=(CleanValue -Value $gpu.Name);\r\n    hostname=$env:COMPUTERNAME; full_device_name=$fullName; domain_workgroup=(CleanValue -Value $cs.Domain); system_type=(CleanValue -Value $cs.SystemType);\r\n    device_uuid=(CleanValue -Value $csp.UUID); product_id=(CleanValue -Value $productId); bios_serial=(CleanValue -Value $bios.SerialNumber); bios_version=(CleanValue -Value (($bios.SMBIOSBIOSVersion -join ' '))); windows_license_status=$licenseStatus; windows_license_channel=$licenseChannel; windows_partial_product_key=$partialKey; windows_oem_key=$oemKey; collector_version='0.3.3'\r\n  }\r\n  Add-Type -AssemblyName System.Web.Extensions\r\n  $serializer=New-Object System.Web.Script.Serialization.JavaScriptSerializer\r\n  $request=@{p_payload=$payload}\r\n  $json=$serializer.Serialize($request)\r\n  $wc=New-Object System.Net.WebClient\r\n  $wc.Encoding=[Text.Encoding]::UTF8\r\n  $wc.Headers.Add('apikey',$AnonKey)\r\n  $wc.Headers.Add('Authorization',('Bearer '+$AnonKey))\r\n  $wc.Headers.Add('Content-Type','application/json')\r\n  $result=$wc.UploadString($SupabaseEndpoint,'POST',$json)\r\n  Write-Host ''\r\n  if($result -match 'already_registered'){\r\n    Write-Host 'INVENTARIO YA COMPLETADO.' -ForegroundColor Green\r\n    Write-Host 'Este equipo ya fue relevado correctamente 3 veces y ya se encuentra cargado al inventario principal de la Direccion de Informatica - Ministerio de Educacion Tucuman.' -ForegroundColor Yellow\r\n  } else {\r\n    $attempt=''; if($result -match '"attempt_count"\\s*:\\s*(\\d+)'){$attempt=$matches[1]}\r\n    Write-Host 'OK - Datos guardados correctamente.' -ForegroundColor Green\r\n    if($attempt){Write-Host ('Ejecucion registrada: '+$attempt+' de 3.') -ForegroundColor Cyan}\r\n    Write-Host ('Equipo: '+$EquipmentName+' | Oficina: '+$OfficeName) -ForegroundColor Gray\r\n  }\r\n  Write-Host ''\r\n  Write-Host 'RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina' -ForegroundColor DarkGray\r\n  Write-Host 'by Ing. Fernando Gambino - https://github.com/fmgambino - Todos los Derechos Registrados' -ForegroundColor DarkGray\r\n  Read-Host 'Presione ENTER para cerrar'\r\n  exit 0\r\n} catch {\r\n  Write-Host ''\r\n  Write-Host ('ERROR: '+$_.Exception.Message) -ForegroundColor Red\r\n  Write-Host 'Verifique la conexion a Internet e intente nuevamente.' -ForegroundColor Yellow\r\n  Write-Host ''\r\n  Write-Host 'RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina' -ForegroundColor DarkGray\r\n  Write-Host 'by Ing. Fernando Gambino - https://github.com/fmgambino - Todos los Derechos Registrados' -ForegroundColor DarkGray\r\n  Read-Host 'Presione ENTER para cerrar'\r\n  exit 1\r\n}\r\n`;
  }
  function utf8Base64(text){const bytes=new TextEncoder().encode('\uFEFF'+text);let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin)}
  function buildBat(psScript,equipmentName){
    const b64=utf8Base64(psScript),chunks=b64.match(/.{1,700}/g)||[];
    const safeEquipment=equipmentName.replace(/[&|<>^%]/g,'');
    const lines=['@echo off','setlocal EnableExtensions','chcp 65001 >nul','title RELEVAMIENTO MANAGER - Registro de equipo','echo.','echo ============================================================','echo  RELEVAMIENTO MANAGER - Direccion de Informatica','echo  Ministerio de Educacion Tucuman','echo ============================================================','echo  Preparando recopilador para '+safeEquipment,'echo.','set "B64=%TEMP%\\medtuc_collector_%RANDOM%.b64"','set "PS1=%TEMP%\\medtuc_collector_%RANDOM%.ps1"','break>"%B64%"'];
    chunks.forEach(c=>lines.push(`>>"%B64%" echo ${c}`));
    lines.push('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$b=[IO.File]::ReadAllText($env:B64).Replace([Environment]::NewLine,\'\').Replace(\' \',\'\');[IO.File]::WriteAllBytes($env:PS1,[Convert]::FromBase64String($b)); & $env:PS1; exit $LASTEXITCODE"','set "RC=%ERRORLEVEL%"','del /q "%B64%" "%PS1%" >nul 2>&1','echo.','echo RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina','echo by Ing. Fernando Gambino - https://github.com/fmgambino - Todos los Derechos Registrados','if not "%RC%"=="0" (echo. & echo El recopilador finalizo con errores. & pause)','exit /b %RC%');
    return lines.join('\r\n');
  }
  function downloadBlob(content,name,type){const b=new Blob([content],{type});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500)}
  async function getSubmissionStatus(equipmentId){
    const {data,error}=await sb.rpc('inventory_submission_status',{p_equipment_id:equipmentId});
    if(error) throw error;
    return Array.isArray(data)?(data[0]||{}):(data||{});
  }
  async function generateCollector(){
    const officeId=$('#officeSelect').value,equipmentId=$('#equipmentSelect').value;
    if(!officeId||!equipmentId)return toast('warning','Faltan datos','Seleccioná la oficina y el nombre del equipo.');
    if(!sb)return toast('info','Supabase no configurado','Completá assets/js/config.js.');
    const officeName=$('#officeSelect').selectedOptions[0].textContent,equipmentName=$('#equipmentSelect').selectedOptions[0].textContent;
    try{
      const status=await getSubmissionStatus(equipmentId);
      const count=Number(status.attempt_count||0);
      if(count>=3){
        return Swal.fire({...swalBase,icon:'success',title:'Relevamiento completado',html:`<b>${safeText(equipmentName)}</b> ya fue relevado correctamente <b>3 veces</b> y ya se encuentra cargado al inventario principal de la <b>Dirección de Informática - Ministerio de Educación Tucumán</b>.`,confirmButtonText:'Entendido'});
      }
      const bat=buildBat(collectorPowerShell(officeId,equipmentId,officeName,equipmentName),equipmentName);
      const filename=`MEDTUC_${equipmentName.replace(/[^a-z0-9_-]/gi,'_')}.bat`;
      downloadBlob(bat,filename,'application/x-bat;charset=utf-8');
      $('#syncPanel').classList.remove('hidden');
      $('#syncText').textContent=`Ejecutá ${filename} con doble clic. Esta será la ejecución ${count+1} de un máximo de 3.`;
      startPolling(equipmentId,count);
      Swal.fire({...swalBase,icon:'info',title:'Recopilador descargado',html:`Abrí <b>${safeText(filename)}</b> con doble clic.<br><br>Ejecución permitida: <b>${count+1} de 3</b>. Windows puede mostrar una advertencia por tratarse de un archivo descargado.`,confirmButtonText:'Entendido'});
    }catch(e){
      console.warn('No se pudo consultar inventory_submission_status; se generará el recopilador igualmente.',e);
      const bat=buildBat(collectorPowerShell(officeId,equipmentId,officeName,equipmentName),equipmentName);
      const filename=`MEDTUC_${equipmentName.replace(/[^a-z0-9_-]/gi,'_')}.bat`;
      downloadBlob(bat,filename,'application/x-bat;charset=utf-8');
      $('#syncPanel').classList.remove('hidden');
      $('#syncText').textContent=`Ejecutá ${filename} con doble clic. El servidor validará y registrará el equipo.`;
      startPolling(equipmentId,0);
      Swal.fire({...swalBase,icon:'warning',title:'Recopilador descargado',html:`Abrí <b>${safeText(filename)}</b> con doble clic.<br><br>No se pudo consultar el contador previo, pero el recopilador fue generado. El servidor aplicará el límite de 3 ejecuciones.`,confirmButtonText:'Entendido'});
    }
  }
  function startPolling(equipmentId,previousCount=0){
    clearInterval(state.poll);let tries=0;const started=new Date(Date.now()-90000).toISOString();
    state.poll=setInterval(async()=>{
      tries++;
      const {data,error}=await sb.rpc('check_recent_inventory',{p_equipment_id:equipmentId,p_since:started});
      const row=Array.isArray(data)?data[0]:data;
      if(!error&&row?.id&&Number(row.submission_count||0)>previousCount){
        clearInterval(state.poll);$('#syncPanel').classList.add('hidden');const n=Number(row.submission_count||1);
        const msg=n>=3?`${row.equipment_name} completó las 3 ejecuciones y ya quedó cargado al inventario principal de la Dirección de Informática - Ministerio de Educación Tucumán.`:`${row.equipment_name} fue guardado correctamente. Ejecución ${n} de 3.`;
        toast('success',n>=3?'Relevamiento completado':'Equipo registrado',msg);
      }else if(tries>80){clearInterval(state.poll);$('#syncText').textContent='Todavía no detectamos el registro. Podés volver a ejecutar el recopilador si no alcanzó el máximo de 3 ejecuciones.'}
    },3000)
  }

  async function login(){if(!sb)return toast('info','Supabase no configurado');const email=$('#adminEmail').value.trim(),password=$('#adminPassword').value;const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)return toast('error','Acceso rechazado',error.message);state.user=data.user;await showDashboard()}
  async function showDashboard(){
    const {data:role,error}=await sb.from('admin_users').select('user_id,role,display_name').eq('user_id',state.user.id).maybeSingle();if(error||!role){await sb.auth.signOut();state.user=null;return toast('error','Sin permisos','La cuenta no está habilitada como administrador.')}
    state.role=role.role||'admin';$('#roleChip').textContent=state.role==='superadmin'?'SuperAdmin':(role.display_name||'Administrador');$('#settingsTabBtn').classList.toggle('hidden',state.role!=='superadmin');$('#usersTabBtn').classList.toggle('hidden',state.role!=='superadmin');$('#loginCard').classList.add('hidden');$('#dashboard').classList.remove('hidden');$('#btnLogout').classList.remove('hidden');await Promise.all([refreshStats(),loadInventory()]);if(state.role==='superadmin')await loadUpdateHistory();
  }
  async function refreshStats(){const [{count:total},{count:offices},{data:last}]=await Promise.all([sb.from('inventories').select('*',{count:'exact',head:true}),sb.from('offices').select('*',{count:'exact',head:true}),sb.from('inventories').select('created_at').order('created_at',{ascending:false}).limit(1)]);$('#statTotal').textContent=total||0;$('#statOffices').textContent=offices||0;$('#statLast').textContent=last?.[0]?fmtDate(last[0].created_at):'—'}
  const filterOr=()=>{const f=state.filter.replace(/[,%()]/g,' ').trim();return `office_name.ilike.%${f}%,equipment_name.ilike.%${f}%,brand.ilike.%${f}%,model.ilike.%${f}%,processor.ilike.%${f}%,operating_system.ilike.%${f}%,windows_version.ilike.%${f}%,hostname.ilike.%${f}%,windows_license_status.ilike.%${f}%,windows_license_channel.ilike.%${f}%`}
  const licenseClass = r => {
    const s=String(r.windows_license_status||'').toLowerCase();
    if(s.includes('licenciado') && !s.includes('no licenciado')) return 'ok';
    if(s.includes('no licenciado')) return 'danger';
    return 'warn';
  };
  const licenseLabel = r => {
    const s=String(r.windows_license_status||'').trim();
    return s || 'Desconocido';
  };
  const inventoryState = r => Number(r.submission_count||1)>=3 ? {cls:'ok',text:'Completo'} : {cls:'info',text:`Pendiente ${Number(r.submission_count||1)}/3`};
  const actionIcon = (type) => ({
    view:'<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>',
    edit:'<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4Zm9-13 4 4"/></svg>',
    delete:'<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>'
  }[type]||'');

  function syncSelectionUI(){
    $$('.row-check').forEach(cb=>{cb.checked=state.selected.has(cb.value)});
    const all = state.rows.length>0 && state.rows.every(r=>state.selected.has(r.id));
    const head=$('#selectAllRows'); if(head){head.checked=all;head.indeterminate=!all&&state.rows.some(r=>state.selected.has(r.id))}
    const n=state.selected.size; $('#selectedCount').textContent=`${n} seleccionado${n===1?'':'s'}`; $('#deleteSelected').disabled=n===0;
  }

  async function loadInventory(){
    const from=state.page*state.size,to=from+state.size-1;
    let q=sb.from('inventories').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(from,to);
    if(state.filter)q=q.or(filterOr());
    const {data,error,count}=await q;
    if(error)return toast('error','Error al consultar',error.message);
    state.rows=data||[];state.total=count||0;
    $('#inventoryBody').innerHTML=state.rows.map(r=>{
      const st=inventoryState(r), lc=licenseClass(r);
      return `<tr data-id="${safeText(r.id)}">
        <td class="select-cell"><input class="row-check" type="checkbox" value="${safeText(r.id)}" aria-label="Seleccionar ${safeText(r.equipment_name)}"></td>
        <td><span class="status-badge ${st.cls}">${safeText(st.text)}</span></td>
        <td>${safeText(fmtDate(r.created_at))}</td>
        <td>${safeText(r.office_name)}</td>
        <td>${safeText([r.brand,r.model].filter(Boolean).join(' · '))}</td>
        <td>${safeText(r.equipment_name)}</td>
        <td>${safeText((r.submission_count||1)+' / 3')}</td>
        <td>${safeText(r.full_device_name||r.hostname)}</td>
        <td>${safeText(r.processor)}</td>
        <td>${safeText(r.cores)}</td>
        <td>${safeText(r.operating_system)}</td>
        <td>${safeText(r.windows_version)}</td>
        <td>${safeText(r.windows_build)}</td>
        <td>${safeText(r.system_type)}</td>
        <td>${safeText(r.motherboard)}</td>
        <td>${safeText(r.ram_gb==null?'':r.ram_gb+' GB')}</td>
        <td>${safeText(r.ram_type)}</td>
        <td>${safeText(r.storage)}</td>
        <td>${safeText(r.graphics)}</td>
        <td>${safeText(r.device_uuid)}</td>
        <td>${safeText(r.product_id)}</td>
        <td><span class="status-badge ${lc}">${safeText(licenseLabel(r))}</span>${r.windows_partial_product_key?`<small class="cell-sub">•••••-${safeText(r.windows_partial_product_key)}</small>`:''}</td>
        <td class="actions-cell">
          <button class="action-btn view" data-action="view" data-id="${safeText(r.id)}" title="Ver">${actionIcon('view')}</button>
          <button class="action-btn edit" data-action="edit" data-id="${safeText(r.id)}" title="Editar">${actionIcon('edit')}</button>
          <button class="action-btn delete" data-action="delete" data-id="${safeText(r.id)}" title="Eliminar">${actionIcon('delete')}</button>
        </td>
      </tr>`;
    }).join('')||'<tr><td colspan="22">Sin resultados</td></tr>';
    const pages=Math.max(1,Math.ceil(state.total/state.size));
    $('#pageInfo').textContent=`${state.total} registros · Página ${state.page+1} de ${pages}`;
    $('#prevPage').disabled=state.page===0;$('#nextPage').disabled=state.page+1>=pages;
    $$('.row-check').forEach(cb=>cb.onchange=()=>{cb.checked?state.selected.add(cb.value):state.selected.delete(cb.value);syncSelectionUI()});
    $$('[data-action]').forEach(btn=>btn.onclick=()=>inventoryAction(btn.dataset.action,btn.dataset.id));
    syncSelectionUI();
  }

  async function inventoryAction(action,id){
    const row=state.rows.find(r=>r.id===id) || (await sb.from('inventories').select('*').eq('id',id).maybeSingle()).data;
    if(!row)return toast('error','Registro no encontrado');
    if(action==='view') return showInventory(row);
    if(action==='edit') return editInventory(row);
    if(action==='delete') return deleteInventory([id], row.equipment_name);
  }

  function detailPair(label,value,cls=''){
    return `<div class="detail-item ${cls}"><span>${safeText(label)}</span><b>${safeText(value||'—')}</b></div>`;
  }
  async function showInventory(r){
    const lc=licenseClass(r);
    const html=`<div class="inventory-detail-grid">
      ${detailPair('Oficina',r.office_name)}${detailPair('Equipo',r.equipment_name)}
      ${detailPair('Marca / Modelo',[r.brand,r.model].filter(Boolean).join(' · '))}
      ${detailPair('Procesador',r.processor)}${detailPair('Núcleos',r.cores)}
      ${detailPair('RAM',r.ram_gb?`${r.ram_gb} GB · ${r.ram_type||''}`:r.ram_type)}
      ${detailPair('Almacenamiento',r.storage)}${detailPair('Gráfica',r.graphics)}
      ${detailPair('Sistema Operativo',r.operating_system)}${detailPair('Versión / Build',[r.windows_version,r.windows_build].filter(Boolean).join(' · '))}
      ${detailPair('Placa Madre',r.motherboard)}${detailPair('UUID',r.device_uuid)}
      ${detailPair('Product ID',r.product_id)}${detailPair('BIOS',[r.bios_serial,r.bios_version].filter(Boolean).join(' · '))}
      <div class="detail-item span-2"><span>Licencia de Windows</span><b><span class="status-badge ${lc}">${safeText(licenseLabel(r))}</span></b></div>
      ${detailPair('Canal de licencia',r.windows_license_channel)}
      ${detailPair('Clave parcial',r.windows_partial_product_key?`•••••-${r.windows_partial_product_key}`:'No detectada')}
      ${detailPair('Clave OEM',r.windows_oem_key||'No detectada','span-2')}
    </div>`;
    await Swal.fire({...swalBase,title:`${safeText(r.equipment_name||'Equipo')}`,html,width:900,confirmButtonText:'Cerrar'});
  }

  async function editInventory(r){
    const {value:v}=await Swal.fire({...swalBase,title:`Editar ${safeText(r.equipment_name)}`,width:760,html:`<div class="swal-form two-cols">
      <input id="edOffice" class="swal2-input" placeholder="Oficina" value="${safeText(r.office_name||'')}">
      <input id="edEquipment" class="swal2-input" placeholder="Equipo" value="${safeText(r.equipment_name||'')}">
      <input id="edBrand" class="swal2-input" placeholder="Marca" value="${safeText(r.brand||'')}">
      <input id="edModel" class="swal2-input" placeholder="Modelo" value="${safeText(r.model||'')}">
      <input id="edLicense" class="swal2-input" placeholder="Estado licencia" value="${safeText(r.windows_license_status||'')}">
      <input id="edChannel" class="swal2-input" placeholder="Canal licencia" value="${safeText(r.windows_license_channel||'')}">
    </div>`,showCancelButton:true,confirmButtonText:'Guardar cambios',cancelButtonText:'Cancelar',focusConfirm:false,
      preConfirm:()=>({office_name:safeName($('#edOffice').value),equipment_name:safeName($('#edEquipment').value),brand:safeName($('#edBrand').value),model:safeName($('#edModel').value),windows_license_status:safeName($('#edLicense').value),windows_license_channel:safeName($('#edChannel').value)})});
    if(!v)return;
    const {error}=await sb.from('inventories').update(v).eq('id',r.id);
    if(error)return toast('error','No se pudo editar',error.message);
    await loadInventory();await refreshStats();toast('success','Registro actualizado');
  }

  async function deleteInventory(ids,label='los registros seleccionados'){
    if(!ids.length)return;
    const c=await Swal.fire({...swalBase,icon:'warning',title:'Eliminar del inventario',html:`Se eliminará <b>${safeText(label)}</b> del inventario principal.<br><br>Esta acción no se puede deshacer.`,showCancelButton:true,confirmButtonText:'Sí, eliminar',cancelButtonText:'Cancelar',confirmButtonColor:'#d65d67'});
    if(!c.isConfirmed)return;
    const {error}=await sb.from('inventories').delete().in('id',ids);
    if(error)return toast('error','No se pudo eliminar',error.message);
    ids.forEach(id=>state.selected.delete(id));
    if(state.rows.length===ids.length && state.page>0)state.page--;
    await Promise.all([loadInventory(),refreshStats()]);
    toast('success','Eliminado correctamente');
  }

  async function fetchAllFiltered(){let q=sb.from('inventories').select('*').order('created_at',{ascending:false});if(state.filter)q=q.or(filterOr());const {data,error}=await q.limit(10000);if(error)throw error;return data||[]}
  const csvCell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const exportFields=r=>[fmtDate(r.created_at),r.office_name,r.brand,r.model,r.equipment_name,`${r.submission_count||1}/3`,r.full_device_name,r.processor,r.cores,r.operating_system,r.windows_version,r.windows_build,r.system_type,r.motherboard,r.ram_gb,r.ram_type,r.storage,r.graphics,r.device_uuid,r.product_id,r.windows_license_status,r.windows_license_channel,r.windows_partial_product_key,r.windows_oem_key,r.bios_serial,r.bios_version,r.domain_workgroup];
  async function exportCSV(){try{const rows=await fetchAllFiltered();const headers=['Fecha','Oficina','Marca','Modelo','NombreEquipo','Ejecuciones','NombreCompleto','Procesador','Nucleos','SistemaOperativo','VersionWindows','Build','TipoSistema','PlacaMadre','RAM_GB','RAM_Tipo','Almacenamiento','TarjetaGrafica','UUID','ProductId','EstadoLicenciaWindows','CanalLicencia','ClaveParcial','ClaveOEM','BIOS_Serial','BIOS_Version','Dominio_Workgroup'];const lines=[headers.map(csvCell).join(';'),...rows.map(r=>exportFields(r).map(csvCell).join(';'))];downloadBlob('\uFEFF'+lines.join('\n'),`MEDTUC_Inventario_${stamp()}.csv`,'text/csv;charset=utf-8')}catch(e){toast('error','No se pudo exportar',e.message)}}
  async function imageDataUrl(url){const res=await fetch(url);if(!res.ok)throw new Error('No se pudo cargar el logo institucional.');const blob=await res.blob();return await new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=fail;r.readAsDataURL(blob)})}
  async function exportPDF(){try{const rows=await fetchAllFiltered();const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a3'});let logo=null;try{logo=await imageDataUrl('assets/img/ministerio-educacion-tucuman.png')}catch{};if(logo)doc.addImage(logo,'PNG',12,8,48,14,undefined,'FAST');doc.setTextColor(20,30,45);doc.setFontSize(18);doc.text('MEDTUC · Inventario Centralizado de Equipos',66,15);doc.setFontSize(8);doc.text(`Reporte generado: ${new Date().toLocaleString('es-AR')}  |  Usuario: ${state.user?.email||'Administrador'}  |  Registros: ${rows.length}`,66,21);doc.autoTable({startY:29,margin:{left:10,right:10},styles:{fontSize:4.5,cellPadding:1.05,overflow:'linebreak'},headStyles:{fillColor:[20,58,91]},head:[['Fecha','Oficina','Marca/Modelo','Equipo','Estado','Ejec.','Procesador','SO','Versión','RAM','Almacenamiento','Gráfica','Licencia','Canal','Clave parcial']],body:rows.map(r=>[fmtDate(r.created_at),r.office_name,[r.brand,r.model].filter(Boolean).join(' · '),r.equipment_name,inventoryState(r).text,`${r.submission_count||1}/3`,r.processor,r.operating_system,r.windows_version,`${r.ram_gb??''} GB`,r.storage,r.graphics,licenseLabel(r),r.windows_license_channel||'',r.windows_partial_product_key?`•••••-${r.windows_partial_product_key}`:'']),didDrawPage:()=>{doc.setFontSize(6);doc.setTextColor(100);doc.text(`RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina · v${APP_VERSION} · by Ing. Fernando Gambino`,12,doc.internal.pageSize.height-6)}});doc.save(`MEDTUC_Inventario_${stamp()}.pdf`)}catch(e){toast('error','No se pudo exportar',e.message)}}
  function stamp(){const d=new Date();return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`}

  function compareVersions(a,b){const A=String(a).split('.').map(Number),B=String(b).split('.').map(Number);for(let i=0;i<Math.max(A.length,B.length);i++){const x=A[i]||0,y=B[i]||0;if(x>y)return 1;if(x<y)return -1}return 0}
  function setUpdateStatus(kind,title,text){$('#updateStatus').innerHTML=`<div class="status-dot ${kind}"></div><div><b>${safeText(title)}</b><span>${safeText(text)}</span></div>`}
  async function checkUpdates(){
    if(state.role!=='superadmin')return toast('error','Acceso restringido','Solo SuperAdmin puede gestionar actualizaciones.');setUpdateStatus('neutral','Comprobando…','Consultando manifiesto de versiones.');
    try{const url=baseUrl()+'update_manifest.json?ts='+Date.now();const res=await fetch(url,{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);const manifest=await res.json();const latest=manifest.latest_version||APP_VERSION;
      if(compareVersions(latest,APP_VERSION)<=0){state.availablePatch=null;setUpdateStatus('ok','Sistema actualizado',`La versión ${APP_VERSION} es la más reciente.`);$('#updateDetails').classList.add('hidden');$('#downloadPatchBtn').classList.add('hidden');$('#applyPatchBtn').classList.add('hidden');return}
      const patch=(manifest.patches||[]).find(p=>p.from===APP_VERSION&&p.to===latest);if(!patch)throw new Error(`Existe v${latest}, pero no hay patch directo desde v${APP_VERSION}.`);state.availablePatch={...patch,latest};setUpdateStatus('warn',`Actualización disponible · v${latest}`,patch.title||'Hay un nuevo patch disponible.');$('#updateDetails').innerHTML=`<h3>v${safeText(latest)}</h3><div class="muted">Publicado: ${safeText(manifest.published_at||'—')} · Tamaño: ${safeText(patch.size_human||'—')}</div><ul>${(patch.changelog||[]).map(x=>`<li>${safeText(x)}</li>`).join('')}</ul>`;$('#updateDetails').classList.remove('hidden');$('#downloadPatchBtn').classList.remove('hidden');$('#applyPatchBtn').classList.remove('hidden');
    }catch(e){setUpdateStatus('error','No se pudo comprobar',e.message);toast('error','Error de actualización',e.message)}
  }
  function patchUrl(){if(!state.availablePatch)return null;const f=state.availablePatch.file;if(/^https?:\/\//i.test(f))return f;return baseUrl()+String(f).replace(/^\//,'')}
  function downloadPatch(){const u=patchUrl();if(!u)return;window.open(u,'_blank','noopener')}
  function handlePatchFile(file){
    if(!file)return;
    if(!/\.zip$/i.test(file.name))return toast('error','Patch inválido','Seleccioná un archivo .ZIP.');
    state.localPatchFile=file;
    state.availablePatch={from:APP_VERSION,to:'local',file:file.name,title:'Patch local adjuntado'};
    setUpdateStatus('warn','Patch local adjuntado',`${file.name} · ${(file.size/1024).toFixed(1)} KB`);
    $('#updateDetails').innerHTML=`<h3>${safeText(file.name)}</h3><div class="muted">Patch seleccionado desde este equipo. Revisá las instrucciones incluidas en el ZIP antes de aplicarlo.</div>`;
    $('#updateDetails').classList.remove('hidden');
    $('#applyPatchBtn').classList.remove('hidden');
  }
  async function applyLocalPatch(){
    if(!state.localPatchFile)return false;
    await Swal.fire({...swalBase,icon:'info',title:'Patch validado',html:location.hostname==='127.0.0.1'||location.hostname==='localhost'?'<b>Modo local:</b> el navegador no puede sobrescribir los archivos de VS Code/Live Server.<br><br>Extraé el ZIP sobre la carpeta raíz del proyecto, aceptá reemplazar los archivos y luego hacé <b>Ctrl + F5</b>.':'El patch fue adjuntado correctamente. Para actualizar GitHub Pages automáticamente se requiere el updater del servidor; de lo contrario, extraé el ZIP en el repositorio y publicá los cambios.',confirmButtonText:'Entendido'});
    return true;
  }
  async function applyPatch(){
    if(state.role!=='superadmin')return;
    if(state.localPatchFile && await applyLocalPatch())return;
    if(!state.availablePatch)return toast('warning','Sin patch','Adjuntá un patch .ZIP o buscá actualizaciones.');const confirm=await Swal.fire({...swalBase,icon:'warning',title:`Aplicar v${state.availablePatch.to}`,html:'Se enviará el patch a la <b>Supabase Edge Function</b>, que actualizará el repositorio GitHub. Se recomienda conservar un backup del repositorio.',showCancelButton:true,confirmButtonText:'Aplicar actualización',cancelButtonText:'Cancelar'});if(!confirm.isConfirmed)return;
    try{const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('Sesión expirada.');Swal.fire({...swalBase,title:'Actualizando…',text:'No cierres esta ventana.',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});const res=await fetch(C.SUPABASE_URL.replace(/\/$/,'')+'/functions/v1/medtuc-updater',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':C.SUPABASE_ANON_KEY},body:JSON.stringify({action:'apply',patch_url:patchUrl(),from_version:APP_VERSION,to_version:state.availablePatch.to,sha256:state.availablePatch.sha256||null})});const body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.error||`HTTP ${res.status}`);await Swal.fire({...swalBase,icon:'success',title:'Patch aplicado',html:`Versión <b>${safeText(state.availablePatch.to)}</b> enviada al repositorio.<br>GitHub Pages puede tardar unos instantes en publicar los cambios.`,confirmButtonText:'Recargar'});location.reload(true)}catch(e){Swal.close();toast('error','No se pudo aplicar el patch',e.message)}
  }
  async function loadUpdateHistory(){if(!sb||state.role!=='superadmin')return;const {data}=await sb.from('update_history').select('from_version,to_version,status,created_at,applied_by_email').order('created_at',{ascending:false}).limit(20);$('#updateHistory').innerHTML=(data||[]).map(x=>`<div class="history-item"><div><b>v${safeText(x.from_version)} → v${safeText(x.to_version)}</b><small>${safeText(x.applied_by_email||'SuperAdmin')}</small></div><div><b>${safeText(x.status)}</b><small>${safeText(fmtDate(x.created_at))}</small></div></div>`).join('')||'<span class="muted">Sin registros.</span>'}

  async function loadAdmins(){
    if(state.role!=='superadmin')return;
    const body=$('#adminUsersBody');body.innerHTML='<tr><td colspan="4">Cargando…</td></tr>';
    try{
      const {data,error}=await sb.rpc('superadmin_list_admins');
      if(error)throw error;
      body.innerHTML=(data||[]).map(u=>`<tr><td>${safeText(u.display_name||'—')}</td><td>${safeText(u.email||'—')}</td><td><span class="role-badge ${u.role==='superadmin'?'super':''}">${safeText(u.role==='superadmin'?'SuperAdmin':'Administrador')}</span></td><td>${safeText(fmtDate(u.created_at))}</td></tr>`).join('')||'<tr><td colspan="4">Sin administradores.</td></tr>';
    }catch(e){body.innerHTML='<tr><td colspan="4">No se pudo cargar el listado.</td></tr>';toast('error','Administradores',e.message)}
  }

  async function addAdmin(){
    if(state.role!=='superadmin')return toast('error','Acceso restringido','Solo SuperAdmin puede agregar administradores.');
    const {value:v}=await Swal.fire({...swalBase,title:'Agregar administrador',html:'<div class="swal-form"><input id="saName" class="swal2-input" placeholder="Nombre y apellido"><input id="saEmail" class="swal2-input" type="email" placeholder="Email"><input id="saPass" class="swal2-input" type="password" placeholder="Contraseña inicial (mín. 8)"></div>',showCancelButton:true,confirmButtonText:'Crear administrador',cancelButtonText:'Cancelar',focusConfirm:false,preConfirm:()=>{const display_name=safeName(document.getElementById('saName').value),email=document.getElementById('saEmail').value.trim().toLowerCase(),password=document.getElementById('saPass').value;if(!display_name)return Swal.showValidationMessage('Ingresá el nombre.');if(!/^\S+@\S+\.\S+$/.test(email))return Swal.showValidationMessage('Ingresá un email válido.');if(password.length<8)return Swal.showValidationMessage('La contraseña debe tener al menos 8 caracteres.');return{display_name,email,password}}});
    if(!v)return;
    try{
      Swal.fire({...swalBase,title:'Creando administrador…',text:'Creando la cuenta y asignando el rol Administrador.',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});
      const isolated=window.supabase.createClient(C.SUPABASE_URL.replace(/\/$/,''),C.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const {data:sign,error:signError}=await isolated.auth.signUp({email:v.email,password:v.password,options:{data:{display_name:v.display_name}}});
      if(signError) throw signError;
      const newUserId=sign?.user?.id;
      if(!newUserId) throw new Error('Supabase Auth no devolvió el ID del nuevo usuario. Verificá que el registro de usuarios esté habilitado.');
      const {error:promoteError}=await sb.rpc('superadmin_promote_admin',{p_user_id:newUserId,p_display_name:v.display_name});
      if(promoteError) throw promoteError;
      Swal.close();await loadAdmins();
      const needsConfirmation=!sign?.session;
      toast('success','Administrador creado',needsConfirmation?`${v.email} fue creado como Administrador. Si la confirmación de correo está activa, deberá confirmar su email antes de iniciar sesión.`:`${v.email} ya puede iniciar sesión.`);
    }catch(e){Swal.close();toast('error','No se pudo crear',e.message)}
  }

  function switchAdminTab(name){if((name==='settings'||name==='users')&&state.role!=='superadmin')return;$$('.admin-tab').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===name));$$('.admin-panel').forEach(p=>p.classList.toggle('active',p.dataset.adminPanel===name));if(name==='settings')loadUpdateHistory();if(name==='users')loadAdmins()}
  function showAdmin(){clearInterval(state.poll);$('#userView').classList.remove('active');$('#adminView').classList.add('active');if(state.user)showDashboard()}
  function showUser(){$('#adminView').classList.remove('active');$('#userView').classList.add('active')}

  $('#officeSelect').addEventListener('change',renderEquipment);$('#addOffice').onclick=()=>createCatalog('office');$('#addEquipment').onclick=()=>createCatalog('equipment');$('#generateCollector').onclick=generateCollector;$('#btnAdmin').onclick=showAdmin;$('#brandHome').onclick=showUser;$('#btnBack').onclick=showUser;$('#loginBtn').onclick=login;$('#adminPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('#btnLogout').onclick=async()=>{await sb?.auth.signOut();location.reload()};
  $('#pageSize').onchange=e=>{state.size=+e.target.value;state.page=0;loadInventory()};
  $('#selectAllRows').onchange=e=>{state.rows.forEach(r=>e.target.checked?state.selected.add(r.id):state.selected.delete(r.id));syncSelectionUI()};
  $('#selectVisible').onclick=()=>{state.rows.forEach(r=>state.selected.add(r.id));syncSelectionUI()};
  $('#deselectAll').onclick=()=>{state.selected.clear();syncSelectionUI()};
  $('#deleteSelected').onclick=()=>deleteInventory([...state.selected],`${state.selected.size} registro${state.selected.size===1?'':'s'} seleccionados`);
  let filterTimer;$('#filterInput').oninput=e=>{clearTimeout(filterTimer);filterTimer=setTimeout(()=>{state.filter=e.target.value.trim();state.page=0;loadInventory()},300)};$('#prevPage').onclick=()=>{if(state.page>0){state.page--;loadInventory()}};$('#nextPage').onclick=()=>{const max=Math.max(1,Math.ceil(state.total/state.size));if(state.page+1<max){state.page++;loadInventory()}};$('#exportCsv').onclick=exportCSV;$('#exportPdf').onclick=exportPDF;$$('.admin-tab').forEach(b=>b.onclick=()=>switchAdminTab(b.dataset.adminTab));$('#checkUpdatesBtn').onclick=checkUpdates;$('#attachPatchBtn').onclick=()=>$('#patchFileInput').click();$('#patchFileInput').onchange=e=>handlePatchFile(e.target.files?.[0]);$('#downloadPatchBtn').onclick=downloadPatch;$('#applyPatchBtn').onclick=applyPatch;$('#addAdminBtn').onclick=addAdmin;

  setBadge();$('#appVersion').textContent=APP_VERSION;$('#installedVersion').textContent=APP_VERSION;loadCatalogs();if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});if(sb)sb.auth.getSession().then(({data})=>{if(data.session)state.user=data.session.user});
})();
