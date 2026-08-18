# MEDTUC Inventario v0.2.0 — Arquitectura

## Registro de una PC

Usuario → GitHub Pages → selecciona/crea Oficina + Equipo → genera `.BAT` personalizado → BAT reconstruye un PowerShell temporal → WMI compatible con Windows 7/10/11 → Supabase REST → PostgreSQL → RPC mínimo de confirmación → SweetAlert OK.

El `.BAT` usa `Get-WmiObject`, `System.Net.WebClient` y `System.Web.Script.Serialization.JavaScriptSerializer` para mantener compatibilidad con equipos antiguos y evitar depender de `Get-CimInstance`/`Invoke-RestMethod`.

## Administración

Supabase Auth → `admin_users` → roles `admin` / `superadmin` → inventario paginado y filtrado → reportes CSV/PDF.

Supabase PostgreSQL es la fuente única del inventario. No existe dependencia de Google Sheets.

`superadmin` → Edge Function `medtuc-admins` → Supabase Auth/Admin API → alta de administradores comunes.

Solo `superadmin` ve `Configuraciones > Actualizaciones`.

## Actualizaciones por patch

`update_manifest.json` → SuperAdmin comprueba versión → Edge Function `medtuc-updater` valida JWT + rol → descarga patch ZIP → valida `patch.json` y opcional SHA-256 → usa GitHub Contents API para actualizar archivos → GitHub Pages publica la nueva versión → `update_history` registra resultado.

El `GITHUB_TOKEN` vive exclusivamente en Supabase Secrets. Nunca debe colocarse en `config.js`.
