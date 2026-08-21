# RELEVAMIENTO MANAGER v1.3.0 — Importador Inteligente DGIDD

## Corrección principal
El importador anterior suponía encabezados en la primera fila y requería obligatoriamente
columnas `Oficina` y `NombreEquipo`. Las planillas DGIDD reales no cumplen esa estructura.

## Nuevo motor
- Escanea las primeras 45 filas de cada hoja para encontrar automáticamente los encabezados.
- Detecta hojas candidatas y permite elegir qué hoja importar.
- Prioriza automáticamente `Inventario Actual`.
- Lee `Nombre de la Repartición` desde el bloque superior de metadatos.
- Permite corregir/completar manualmente la Repartición antes de importar.
- Reconoce: Item N°, Tipo2, Marca, Cantidad, Modelo, Año, Cant. de Procesadores,
  Modelo de Procesador, Cores, RAM, Capacidad y Unidad medida.
- Soporta además el formato histórico anterior con Oficina/NombreEquipo.
- `Cantidad > 1` se expande en equipos individuales.
- Genera nombres estables como `PC #7-01`, `PC #7-02`.
- Reimportar el mismo archivo/hoja/ítem no duplica: actualiza la misma unidad importada.
- Guarda hoja, ítem, fila, cantidad, tipo de equipo, año y cantidad de procesadores.
- Vista previa antes de confirmar.
