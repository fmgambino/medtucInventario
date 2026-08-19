# RELEVAMIENTO MANAGER v1.2.0

## UI/UX
- Corrige definitivamente el solapamiento del módulo Oficinas.
- Elimina huecos causados por cierres HTML incorrectos.
- Configuraciones Mobile First: tabs horizontales en móvil y laterales sticky en escritorio.
- Tablas con glass/blur, encabezados sticky y scroll minimalista.
- Selectores modernos en filtros del Inventario.
- Paginación idéntica arriba y abajo de la tabla.

## Inventario
- Formulario Editar completo para todos los campos visibles del detalle:
  oficina, equipo, host, marca/modelo, CPU, RAM, discos, gráfica, Windows,
  licencia, motherboard, BIOS, UUID, dominio, tipo de sistema y contador 1/3–3/3.
- Las acciones Ver/Editar permanecen disponibles para Admin.
- Eliminar individual y múltiple solo aparece para SuperAdmin.

## Seguridad
- RLS fuerza que únicamente SuperAdmin elimine inventarios.
- Solo SuperAdmin puede eliminar usuarios administrativos.
- Admin puede consultar y editar inventario, pero no eliminar equipos ni usuarios.
