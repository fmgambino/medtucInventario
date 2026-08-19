# RELEVAMIENTO MANAGER v1.0.1

PWA para relevamiento centralizado de PCs de la Dirección de Informática - Ministerio de Educación Tucumán.

## Stack

HTML5 + CSS3 + JavaScript + SweetAlert2 + SVG + GitHub Pages + Supabase (PostgreSQL/Auth/Storage/Edge Functions).

## Qué incluye

- Portal público para Oficina → Equipo → descarga de recopilador `.BAT`.
- Recopilador compatible con Windows 7 / 10 / 11 mediante WMI.
- CPU, núcleos, SO, Windows versión/build, placa madre, RAM, discos, GPU, hostname, UUID, BIOS, Product ID y licencia de Windows.
- Máximo 3 relevamientos por equipo; el mismo registro se actualiza.
- Administración con roles `admin` y `superadmin`.
- Solo SuperAdmin crea nuevos `admin` o `superadmin`.
- Inventario con filtros, 5/10/25/50/100/500/1000, paginación, checkbox individual/página, eliminación múltiple y acciones Ver/Editar/Eliminar.
- Estados visuales y licencia: verde Licenciado, rojo No licenciado, amarillo Desconocido.
- Exportación CSV y PDF con identidad institucional, fecha/hora y usuario.
- Configuración de nombre, favicon e icono de instalación PWA desde el panel SuperAdmin.
- Actualizador por ZIP: futuras versiones ejecutan migraciones SQL y actualizan GitHub automáticamente.
- Footer permanente: RELEVAMIENTO MANAGER © 2026 Tucumán - Argentina / by Ing. Fernando Gambino.

## Instalación limpia

Seguir `TUTORIAL_INSTALACION.md`.

## Configuración pública

`assets/js/config.js` contiene únicamente URL de Supabase + Publishable/Anon Key. Es correcto que esos datos estén en el frontend. **Nunca** colocar `service_role`, GitHub Token ni Supabase Personal Access Token en el navegador.

## Formato de futuros patches

Cada ZIP debe contener un `patch.json` en la raíz:

```json
{
  "from": ["1.0.1"],
  "to": "1.0.1",
  "title": "Correcciones v1.0.1",
  "migrations": ["supabase/migrations/001_v1.0.1.sql"],
  "files": ["index.html","assets/js/app.js","assets/css/styles.css","sw.js","update_manifest.json"]
}
```

El Edge Function `medtuc-updater`:
1. valida sesión;
2. valida rol `superadmin`;
3. lee el ZIP;
4. ejecuta las migraciones SQL con la Management API;
5. actualiza los archivos del repositorio GitHub;
6. registra el resultado en `update_history`.


## v1.1.0 — Inventario inteligente

La versión 1.1.0 incorpora Importador Inteligente para XLSX/XLS/CSV, filtros combinables,
agrupación y conteo, etiquetas por color y edición de oficinas desde Configuraciones.

Para actualizar desde v1.0.3 se recomienda usar:
`RELEVAMIENTO_MANAGER_patch_1.0.3_to_1.1.0.zip`

El patch incluye su migración SQL y está preparado para el actualizador automático.
