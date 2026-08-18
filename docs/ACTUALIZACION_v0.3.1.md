# Actualización v0.3.1

## Orden de actualización

1. Ejecutar `supabase/migrations/003_v0.3.1.sql` completo en Supabase SQL Editor.
2. Verificar que la consulta final muestre `fernando.m.gambino@gmail.com` con rol `superadmin`.
3. Reemplazar los archivos del frontend por el patch v0.3.1.
4. Recargar la PWA con `Ctrl+F5` una vez para forzar la actualización del Service Worker.

## Qué corrige

El recopilador v0.3.0 podía fallar en algunos equipos OEM cuando WMI devolvía cadenas como `To Be Filled By O.E.M.`. La v0.3.1 elimina la construcción problemática y usa una Hashtable simple, funciones nombradas y llamadas explícitas compatibles con Windows PowerShell tradicional.

## Límite de relevamientos

Cada `equipment_id` admite hasta 3 ejecuciones exitosas. La primera crea el registro principal. La segunda y tercera actualizan esa misma fila y aumentan `submission_count`. A partir de la cuarta solicitud, la PWA no vuelve a generar el recopilador y el RPC tampoco acepta nuevas cargas.
