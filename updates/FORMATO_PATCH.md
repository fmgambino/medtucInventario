# Formato obligatorio de patch

Un patch futuro es un ZIP con `patch.json` en la raíz.

Ejemplo:

```json
{
  "from": ["1.0.0"],
  "to": "1.0.1",
  "title": "Correcciones",
  "migrations": [
    "supabase/migrations/001_v1.0.1.sql"
  ],
  "files": [
    "index.html",
    "assets/js/app.js",
    "assets/css/styles.css",
    "sw.js",
    "update_manifest.json"
  ]
}
```

Las rutas declaradas deben existir dentro del ZIP.

El updater ejecuta primero todas las migraciones SQL, en orden, usando Supabase Management API. Si una migración falla, no continúa actualizando archivos.

Después actualiza GitHub secuencialmente y registra `update_history`.
