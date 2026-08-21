# RELEVAMIENTO MANAGER v1.4.0 — Exportación Excel exacta DGIDD

## Exportación
- Selector de formato: CSV o Excel (.xlsx).
- El Excel NO se reconstruye con estilos aproximados.
- Se usa como base binaria la plantilla DGIDD original adjuntada.
- Se preservan:
  - logos e imágenes;
  - colores;
  - fuentes y estilos;
  - bordes;
  - tamaños de columnas y filas;
  - celdas combinadas;
  - tablas;
  - configuración de impresión;
  - hoja oculta `config`;
  - estructura de las 3 hojas.
- Únicamente se reemplazan los datos de las filas.

## Hojas
- Inventario Actual.
- Inventario a solicitar.
- Equipos a Actualizar.

## Alcance
- Pestaña actual.
- Todas las hojas.

## Semántica de la plantilla
Los registros importados que fueron expandidos por `Cantidad` vuelven a consolidarse
al exportar para respetar la regla original: una fila = un tipo/modelo y `Cantidad`
representa las unidades iguales.

Los equipos provenientes del recopilador .BAT se exportan dentro de `Inventario Actual`.
