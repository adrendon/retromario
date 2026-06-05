# PR 03 — Persistencia opcional en archivo del servidor

## Objetivo

Persistir el estado en el servidor **sin usar base de datos**, para que la retro pueda recuperarse si el proceso se reinicia y el despliegue conserva el archivo.

## Decisión importante

Esta persistencia será opcional. Por defecto, la app puede seguir funcionando solo en memoria. Si se configura una ruta de archivo persistente, el servidor leerá y guardará estado ahí.

## Alcance

- Implementar `loadData()` y `saveData()` reales usando `fs`.
- Controlar la ruta con variable de entorno, por ejemplo `MARIO_DATA_FILE`.
- Guardar de forma atómica: escribir a archivo temporal y luego renombrar.
- Persistir el estado funcional de la retro:
  - sprint
  - objective
  - steps
  - cards
  - actions
  - boardActive
  - timer
  - pilotos registrados
  - moods, si se mantienen como parte de la dinámica
- No persistir tokens admin por defecto, salvo decisión explícita posterior.
- No permitir múltiples instancias escribiendo el mismo archivo.

## Comportamiento propuesto

- Si `MARIO_DATA_FILE` no está definido: modo actual, estado en memoria.
- Si `MARIO_DATA_FILE` está definido y existe: cargar estado al iniciar.
- Si `MARIO_DATA_FILE` está definido y no existe: iniciar vacío y crear el archivo al primer cambio.
- Si el archivo está corrupto: iniciar vacío y loguear `state_load_failed`.

## Criterios de aceptación

- Con `MARIO_DATA_FILE=/tmp/retro.json`, el servidor guarda cambios al registrar pilotos, tarjetas, pasos, acciones, tablero y timer.
- Al reiniciar el servidor con la misma ruta, `/api/state` recupera el estado guardado.
- Sin `MARIO_DATA_FILE`, el comportamiento actual no cambia.
- `npm test` pasa.

## Limitaciones aceptadas

- No es una base de datos.
- No sirve para escalar horizontalmente.
- En despliegues donde el filesystem se borra al reiniciar, no habrá recuperación real.
- Para que sobreviva reinicios en producción, el proveedor debe montar almacenamiento persistente para esa ruta.
