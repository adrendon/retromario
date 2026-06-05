# PR 01 — Health check y logs del servidor

## Objetivo

Agregar observabilidad mínima para entender qué pasa en producción sin abrir el navegador de cada usuario.

## Alcance

- Crear `GET /api/health`.
- Agregar logs estructurados con `console.log(JSON.stringify(...))` para eventos clave.
- No cambiar la lógica funcional de tablero, tarjetas, pasos ni admin.
- No agregar dependencias externas.

## Endpoint propuesto

`GET /api/health` debe responder algo similar a:

```json
{
  "ok": true,
  "uptimeSec": 123,
  "serverNow": 1710000000000,
  "clientsConnected": 5,
  "pilotsRegistered": 5,
  "livePilots": 4,
  "adminTaken": true,
  "boardActive": true,
  "timerRunning": true,
  "cards": 12,
  "actions": 3
}
```

## Logs mínimos

Registrar sin exponer PIN ni tokens:

- `server_started`
- `sse_connected`
- `sse_replaced`
- `sse_disconnected`
- `pilot_registered`
- `admin_claimed`
- `admin_restored`
- `admin_released`
- `board_updated`
- `timer_updated`
- `state_cleared`

## Criterios de aceptación

- `/api/health` responde `200` con JSON liviano.
- El endpoint no expone tarjetas completas, nombres sensibles innecesarios, PIN ni tokens.
- Los logs permiten contar conexiones, reconexiones, admin activo y cambios del cronómetro.
- `node --check server.js` pasa.
- Smoke test con `curl /api/health` pasa.

## Riesgos

- Loguear demasiado puede ensuciar Render logs. Mantener eventos puntuales.
- No usar logs para datos sensibles.
