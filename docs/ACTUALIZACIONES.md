# Configurar Actualizaciones por Patch

## 1. Base de datos

Si venís de v0.1.0, ejecutá `supabase/migrations/001_v0.2.0.sql` en Supabase SQL Editor.

Después marcá tu usuario como SuperAdmin usando el ejemplo SQL al final de la migración.

## 2. Edge Function

Desplegar `supabase/functions/medtuc-updater/index.ts` como función `medtuc-updater`.

## 3. Secrets de Supabase

Configurar en Edge Functions Secrets:

- `GITHUB_TOKEN`: fine-grained token con permiso Contents: Read and write sobre el repositorio.
- `GITHUB_OWNER=fmgambino`
- `GITHUB_REPO=medtucInventario`
- `GITHUB_BRANCH=main`

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` están disponibles en el entorno de Edge Functions del proyecto.

## 4. Formato de patch

Cada ZIP contiene:

- `patch.json`
- `files/<ruta-del-proyecto>`

Ejemplo de `patch.json`:

```json
{
  "from": "0.2.0",
  "to": "0.2.1",
  "files": ["index.html", "assets/js/app.js", "assets/css/styles.css", "update_manifest.json"]
}
```

El updater bloquea `config.js`, rutas `..`, `.git/` y `.github/workflows/`.
