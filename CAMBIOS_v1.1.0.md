# RELEVAMIENTO MANAGER v1.1.0

## Importador inteligente
- Importa XLSX, XLS y CSV.
- Detecta automáticamente las columnas de la planilla histórica.
- Crea oficinas y equipos faltantes.
- Fusiona con activos existentes sin degradar datos obtenidos por el recopilador.
- Evita duplicados y muestra progreso/resultado.

## Inventario inteligente
- Búsqueda libre + filtros por oficina, estado, licencia, RAM y etiqueta.
- Agrupación y conteo por oficina, marca, Windows, licencia, estado, RAM o etiqueta.
- Etiquetas personalizadas con color.
- Asignación masiva de etiquetas a equipos seleccionados.
- Exportaciones CSV/PDF respetan los filtros aplicados.

## Oficinas
- Nueva sección Configuraciones > Oficinas.
- SuperAdmin puede renombrar una oficina.
- El cambio se propaga a inventarios históricos.

## Base de datos
- tags / inventory_tags.
- import_source / imported_at.
- RPC superadmin_import_inventory_row().
- RPC superadmin_rename_office().
- Índices adicionales para filtros.
