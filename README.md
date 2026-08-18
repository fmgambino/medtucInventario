# MEDTUC Inventario v0.3.1

MVP refactorizado para centralizar inventario de PCs de oficina en Supabase desde un portal estático publicado en GitHub Pages.

## Novedades v0.3.0

- Recopilador simplificado en **un solo `.BAT`** descargable desde la web.
- El usuario solo elige/crea **Oficina** y **Nombre del equipo**.
- El BAT se ejecuta con doble clic y reconstruye temporalmente el recopilador PowerShell.
- Detección mediante WMI para máxima compatibilidad práctica con Windows 7, 10 y 11.
- Datos de hardware y sistema ampliados: marca, modelo, CPU, núcleos, RAM, tipo RAM, discos, GPU, placa madre, hostname, nombre completo, dominio/workgroup, tipo de sistema, Windows edición/arquitectura, versión, build, fecha de instalación, UUID del dispositivo, Product ID, BIOS serial y versión.
- Confirmación automática de impacto mediante RPC mínimo, sin exponer la lectura anónima de toda la tabla de inventario.
- Administración con filtros, paginación 5/10/25/50/100/500/1000, CSV y PDF.
- PDF con identidad MEDTUC, título, fecha/hora y usuario que solicita la exportación.
- Roles `admin` y `superadmin`.
- **Configuraciones > Actualizaciones** visible únicamente para `superadmin`.
- Sistema de actualización por patch preparado para GitHub Pages mediante Supabase Edge Function + GitHub Contents API.
- Historial de actualizaciones.
- PWA básica con Manifest + Service Worker y estrategia de actualización network-first para archivos críticos.

## Actualizar desde v0.1.0

1. Hacer backup del repositorio y de Supabase.
2. Ejecutar `supabase/migrations/001_v0.3.0.sql` en Supabase SQL Editor.
3. Convertir tu usuario administrador en `superadmin` usando el ejemplo SQL incluido al final de la migración.
4. Reemplazar en GitHub los archivos incluidos en `updates/MEDTUC_patch_0.1.0_to_0.2.0.zip`.
5. Conservar tu `assets/js/config.example.js` actual con la URL y Anon Key reales. El patch no lo sobrescribe.
6. Para habilitar instalación automática de futuros patches, desplegar `supabase/functions/medtuc-updater/index.ts` y configurar los Secrets indicados en `docs/ACTUALIZACIONES.md`.

## Instalación limpia

1. Ejecutar `supabase/schema.sql`.
2. Opcional: ejecutar `supabase/seed.sql`.
3. Crear el usuario desde Supabase Authentication.
4. Insertarlo en `public.admin_users` con rol `superadmin`.
5. Editar `assets/js/config.example.js` con tu `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `PROJECT_URL`.
6. Subir el proyecto a `fmgambino/medtucInventario` y habilitar GitHub Pages.
7. Desplegar la Edge Function si querés instalar futuros patches desde el propio panel.

## Windows 7

El recopilador evita APIs modernas como `Get-CimInstance` e `Invoke-RestMethod`; usa WMI, `WebClient` y serialización .NET para funcionar en sistemas antiguos. Para comunicarse por HTTPS con Supabase, un Windows 7 debe contar con soporte TLS 1.2 habilitado y actualizaciones de sistema/.NET compatibles. En Windows 10 y 11 esto normalmente ya está disponible.

## Seguridad

- La Anon Key de Supabase puede estar en el frontend, pero RLS limita las operaciones permitidas.
- No se permiten `UPDATE` ni `DELETE` públicos para oficinas, nombres de equipo ni inventarios.
- El token de GitHub **nunca** se guarda en JavaScript: se configura como Secret de Supabase Edge Functions.
- La Edge Function valida sesión y rol `superadmin` antes de modificar el repositorio.
- El updater bloquea rutas peligrosas y no permite sobrescribir el archivo de configuración local.


## Cambios principales v0.3.0

- Supabase es la única fuente de datos del inventario; no se usa Google Sheets ni Excel como backend.
- Identidad institucional con logo oficial del Ministerio de Educación de Tucumán.
- Exportación PDF con logo, título, fecha/hora, usuario que exportó y cantidad de registros.
- Nuevo módulo **Administradores**, visible únicamente para `superadmin`.
- Solo el SuperAdmin puede crear administradores, mediante la Edge Function `medtuc-admins`.
- Los administradores comunes pueden consultar inventario y generar reportes, pero no pueden crear otras cuentas ni acceder a Actualizaciones.
- El recopilador sigue siendo un único `.BAT` compatible con Windows 7/10/11 y registra directamente en Supabase.

### Actualizar desde v0.2.0

1. Ejecutar `supabase/migrations/002_v0.3.0.sql`.
2. Desplegar `supabase/functions/medtuc-admins`.
3. Publicar/aplicar el patch `updates/MEDTUC_patch_0.2.0_to_0.3.0.zip`.
4. No reemplazar `assets/js/config.js` si ya contiene la configuración real del proyecto.

## v0.3.1

- Corregido recopilador en equipos OEM (`To Be Filled By O.E.M.`).
- Máximo de 3 ejecuciones por equipo sin duplicar la fila principal.
- `fernando.m.gambino@gmail.com` queda configurado como SuperAdmin mediante `003_v0.3.1.sql`.
- Footer institucional/autoría en PWA, BAT y PDF.
- Columna `Ejecuciones` visible en Administración y exportaciones.
