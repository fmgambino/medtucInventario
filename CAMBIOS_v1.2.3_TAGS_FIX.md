# RELEVAMIENTO MANAGER v1.2.3 — Etiquetas

- Corrige alta de etiquetas duplicadas: compara por nombre normalizado antes del INSERT.
- Si una etiqueta ya existe, muestra un mensaje claro en lugar del error SQL `tags_name_lower_uidx`.
- El formulario Editar Inventario incorpora un selector visual Mobile First de etiquetas existentes.
- Permite seleccionar una o varias etiquetas.
- Al guardar, sincroniza `inventory_tags` con la selección actual.
- Refuerza RLS: Admin/SuperAdmin pueden crear, editar y asignar etiquetas; borrar la definición de una etiqueta queda reservado a SuperAdmin.
