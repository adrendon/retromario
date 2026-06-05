# PR 02 — Tests automatizados sin dependencias

## Objetivo

Agregar una suite básica para evitar regresiones en multiusuario, admin, SSE, tablero y cronómetro.

## Alcance

- Usar `node:test` y módulos nativos de Node.
- Agregar script `npm test`.
- Crear pruebas de integración que levanten el servidor en un puerto temporal.
- No agregar Jest, Vitest, Playwright ni dependencias externas en este PR.

## Casos mínimos

- `GET /api/state` inicia con `boardActive: false`.
- `GET /api/stream?clientId=...` devuelve evento `hello` con el mismo `clientId` normalizado.
- `POST /api/pilots` registra dos pilotos y ambos aparecen en `/api/state`.
- `POST /api/admin/claim` devuelve admin activo y `adminToken`.
- `POST /api/admin/restore` restaura admin con `clientId` + `adminToken` válidos.
- Endpoint admin con credenciales inválidas devuelve `403`.
- Admin válido puede activar tablero con `/api/board`.
- Admin válido puede iniciar, pausar y resetear cronómetro con `/api/timer`.
- `/api/state` refleja los cambios de tablero y cronómetro.

## Criterios de aceptación

- `npm test` pasa localmente.
- `node --check server.js` y `node --check app.js` pasan.
- Las pruebas no dependen de orden global ni de un puerto fijo.
- Las pruebas limpian el proceso servidor al terminar.

## Riesgos

- SSE en tests puede quedarse abierto si no se aborta bien la conexión.
- El estado global del servidor requiere arrancar un proceso nuevo por suite o limpiar estado entre casos.
