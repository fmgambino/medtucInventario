# RELEVAMIENTO MANAGER v1.2.1 — REPARACIÓN CRÍTICA

## Causa del fallo
La v1.2.0 cambió la paginación de IDs únicos (`#prevPage`, `#nextPage`) a botones por clase
(`.pager-prev`, `.pager-next`) para mostrar paginación arriba y abajo. Sin embargo, `bind()`
seguía intentando ejecutar `.onclick` sobre los IDs eliminados.

Ese `TypeError` detenía la inicialización antes de `loadCatalogs()`, por eso:
- no se cargaban Oficinas;
- no se cargaban Nombres de Equipo;
- quedaban inactivos prácticamente todos los botones del Administrador.

## Correcciones
- `bind()` reconstruido con listeners null-safe.
- Paginación superior e inferior enlazada por clases.
- Inicialización resiliente: los catálogos críticos se intentan cargar aunque falle un módulo opcional.
- Restaurada carga de `offices` y `equipment_names`.
- Restaurados botones de Inventario, Administradores, Configuraciones, Importador, Oficinas y Actualizaciones.
- Corregido cache-busting: index.html ya no solicita app.js/styles.css con versión 1.1.0.
- Service Worker actualizado a v1.2.1.
- Eliminados warnings de `start_url/scope` del manifest dinámico.
- Sin cambios destructivos sobre Supabase.
