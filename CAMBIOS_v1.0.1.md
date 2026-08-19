# RELEVAMIENTO MANAGER v1.0.1

- Recopilador .BAT restaurado al mecanismo estable: genera un PS1 temporal desde Base64 y lo elimina al finalizar.
- Corregido PowerShell: se elimina el uso de `$pid`, variable reservada de PowerShell; se usa `$windowsProductId`.
- Conserva compatibilidad Windows 7 / 10 / 11 mediante WMI y WebClient.
- Recupera detección de licencia Windows, canal, clave parcial y OEM cuando está disponible.
- Home: tras descargar el recopilador queda un SweetAlert con indicador de carga esperando una nueva ejecución; al confirmarse en Supabase informa éxito y número de ejecución (1/3, 2/3, 3/3).
- La espera compara el contador previo y no confirma falsamente un registro antiguo.
- Administradores: listado mediante RPC `superadmin_list_admins()`.
- Alta de Administradores/SuperAdmin: primero intenta `medtuc-admins`; si la Edge Function no está disponible, usa Auth + RPC segura `superadmin_assign_role_by_email()`.
- Solo SuperAdmin puede asignar roles administrativos o crear otro SuperAdmin.
- Manifest dinámico corregido con URLs absolutas para evitar advertencias de start_url/icon.
- Se mantiene Inventario con selección múltiple, Ver/Editar/Eliminar, licencia y estados por colores.
