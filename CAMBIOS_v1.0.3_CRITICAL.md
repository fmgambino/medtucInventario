# RELEVAMIENTO MANAGER v1.0.3 — CORRECCIÓN CRÍTICA

## Error corregido
Las versiones anteriores identificaban el registro por `equipment_id`, que es un dato de catálogo.
Eso provocaba que dos PCs físicas distintas que usaran el mismo nombre de equipo sobrescribieran
la misma fila.

## Nueva identidad
Cada PC se identifica por una huella física estable:
1. UUID SMBIOS, si es válido.
2. BIOS Serial + Hostname.
3. Hostname + Placa madre como fallback.

`office_id` y `equipment_id` pasan a ser metadatos del inventario y NO su identidad física.

## Registro
- PC física nueva => INSERT, nueva fila.
- Misma PC física, ejecución 2 => UPDATE de su propia fila, 2/3.
- Misma PC física, ejecución 3 => UPDATE de su propia fila, 3/3.
- Ejecución 4+ => no incrementa y responde 'already_completed'.
- Otra PC aunque tenga el mismo nombre 'PC' => NUEVA FILA.

## Confirmación del Home
La espera ya no consulta por `equipment_id`.
Cada descarga genera un `submission_token` único y la PWA confirma exclusivamente esa ejecución.
