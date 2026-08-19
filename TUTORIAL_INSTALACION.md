# TUTORIAL DE INSTALACIÓN LIMPIA — v1.0.1

Esta versión reemplaza la cadena de patches 0.3.x por una base limpia y consistente.

## 1. Crear / verificar usuario SuperAdmin

En Supabase → Authentication → Users debe existir:

`fernando.m.gambino@gmail.com`

Si no existe, crearlo con **Add user** y asignar contraseña. El SQL v1.0.1 lo promociona automáticamente a `superadmin`. También instala un trigger para conservar esta regla si el usuario se crea después.

## 2. Instalar / reparar la base

Abrir Supabase → SQL Editor → New query.

Copiar **todo** el contenido de:

`supabase/INSTALL_OR_REPAIR_v1.0.1.sql`

y ejecutar una sola vez.

Este archivo elimina primero las firmas de funciones incompatibles antes de recrearlas. Por eso corrige el error:

`cannot change return type of existing function`

No ejecutar los SQL históricos de 0.3.x.

## 3. Desplegar Edge Function medtuc-admins

Supabase → Edge Functions → crear/desplegar:

`supabase/functions/medtuc-admins/index.ts`

Mantener **Verify JWT with legacy secret = ON**.

Esta función crea Administradores y SuperAdmin usando `service_role` solo en servidor.

## 4. Desplegar Edge Function medtuc-updater

Desplegar:

`supabase/functions/medtuc-updater/index.ts`

Mantener **Verify JWT with legacy secret = ON**.

La función ya responde a `OPTIONS`, por lo que funciona desde GitHub Pages sin el error CORS visto en versiones anteriores.

## 5. Crear Secrets del updater

Supabase → Edge Functions → Secrets.

Agregar:

- `GITHUB_TOKEN` = Fine-grained token/PAT con permiso **Contents: Read and write** sobre `fmgambino/medtucInventario`.
- `GITHUB_OWNER` = `fmgambino`
- `GITHUB_REPO` = `medtucInventario`
- `GITHUB_BRANCH` = rama desde la que publica GitHub Pages. En el backup actual se venía usando `dev`.
- `SUPABASE_ACCESS_TOKEN` = Personal Access Token de tu cuenta Supabase con acceso al proyecto.
- `SUPABASE_PROJECT_REF` = `hmpcfqxcadxcwjgvtqog`

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` son variables disponibles automáticamente dentro de Edge Functions alojadas.

## 6. Probar las dos funciones

Entrar a Administración como SuperAdmin.

- En Administradores, crear un usuario de prueba con rol `admin`.
- Crear otro con rol `superadmin` si se desea verificar la jerarquía.

Si falla, revisar Supabase → Edge Functions → función → Logs.

## 7. Publicar la PWA

Subir **el contenido de la carpeta del proyecto**, no el ZIP contenedor, a la raíz del repositorio que publica GitHub Pages.

Revisar:

`assets/js/config.js`

Luego esperar a GitHub Pages y abrir:

`https://fmgambino.github.io/medtucInventario/`

Hacer una recarga fuerte / borrar la PWA anterior si el navegador conserva Service Worker 0.3.x.

## 8. Probar relevamiento

1. Elegir oficina.
2. Elegir o crear equipo.
3. Descargar `.BAT`.
4. Ejecutar con doble clic.
5. Esperar confirmación de la PWA.
6. Verificar Inventario en el administrador.

La cuarta ejecución queda bloqueada porque `register_inventory()` devuelve el registro ya completado.

## 9. Identidad PWA

SuperAdmin → Configuraciones → Identidad PWA.

Permite subir:
- favicon;
- icono de instalación PWA;
- nombre;
- nombre corto.

Los archivos se almacenan en el bucket público `branding`; solo SuperAdmin puede escribir allí.

## 10. Futuras actualizaciones

A partir de v1.0.1:

1. Adjuntar patch `.ZIP`.
2. La PWA valida `patch.json`.
3. Pulsar **Instalar actualización**.
4. `medtuc-updater` ejecuta automáticamente los SQL del patch.
5. Actualiza los archivos en GitHub.
6. Registra el historial.
7. GitHub Pages publica la nueva versión.

**No hay que entrar al SQL Editor para cada patch.**
