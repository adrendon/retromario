# 🏁 Retro Mario Kart

Retrospectiva ágil estilo Mario Kart, en tiempo real, sin dependencias externas.
Node.js puro (`http`, `fs`, `crypto`) + HTML/CSS/JS vanilla.

## Cómo correrlo

```bash
node server.js
```

Abre [http://localhost:3000](http://localhost:3000) para entrar como piloto,
o [http://localhost:3000/admin](http://localhost:3000/admin) para entrar como facilitador.

Variables de entorno opcionales:

- `PORT` — puerto HTTP (por defecto `3000`, en Render lo asigna la plataforma).
- `HOST` — interfaz de escucha (por defecto `0.0.0.0`).
- `MARIO_ADMIN_PIN` — PIN del facilitador. **Cámbialo siempre antes de desplegar.** El valor por defecto (`sitioBanco`) solo sirve para desarrollo local.

## Admin

- Entra por `/admin` y escribe el PIN. La sesión admin se guarda en `sessionStorage` con un token y dura mientras el servidor siga vivo (máx. 12 h), así que recargar la página no obliga a poner el PIN otra vez.
- Solo el admin puede:
  - Cambiar el número de sprint.
  - Marcar los 12 pasos de la dinámica.
  - Activar el tablero (al marcar el paso 5) y arrancar el cronómetro (3/5/10 min).
  - Añadir/borrar acciones del próximo sprint.
  - Descargar el Excel y limpiar el tablero.

## Jugadores

- Eligen personaje y nombre.
- Ven los pasos y, cuando el admin activa el paso 5, el tablero de tarjetas con cronómetro.
- Pueden compartir su ánimo (paso 3) y votar acciones (paso 11).

## Arquitectura en una línea

Una sola instancia Node.js con REST + SSE (`/api/stream`). El servidor es la fuente de verdad y el estado vive en memoria; cada pestaña tiene un `clientId` estable en `sessionStorage` para que reconectar SSE no duplique pilotos ni expulse al admin. La UI también pollea `/api/state` cada pocos segundos como respaldo si SSE se cae detrás de un proxy.

## Plan de trabajo

El plan de estabilización está documentado en [`docs/roadmap.md`](docs/roadmap.md). La estrategia acordada es avanzar en PRs pequeños y **sin agregar base de datos**: el servidor sigue siendo la fuente de verdad y cualquier persistencia futura será opcional por archivo del servidor.

## Despliegue en Render (o similar)

Lo que ya está resuelto en el código:

- Identidad estable por pestaña: el `clientId` se reusa al reconectar SSE, así que un corte breve del proxy no duplica usuarios ni hace que el admin pierda el rol.
- Sesión admin con token (`/api/admin/restore`) para que recargar la página no obligue a re-ingresar el PIN.
- Endpoints admin protegidos: todas las llamadas envían `clientId` y `adminToken` por header/body.
- Polling de `/api/state` cada pocos segundos como red de seguridad si SSE pierde eventos.

Lo que sigue siendo responsabilidad del despliegue:

- **Una sola instancia/proceso** mientras el estado viva en memoria. Si se escala horizontalmente sin Redis/Postgres, cada réplica tendría su propio tablero.
- **El estado se pierde al reiniciar el proceso.** Esto es aceptado por diseño. Si se necesita sobrevivir reinicios, el [PR 03](docs/pr-03-server-file-persistence.md) propone una persistencia opcional por archivo (no base de datos).
- **Configurar `MARIO_ADMIN_PIN`** antes de abrir la app al equipo.

## Próximos pasos sugeridos

Los detalles están en [`docs/`](docs/), todos sin agregar base de datos:

1. [PR 01 — Health check y logs](docs/pr-01-health-logs.md)
2. [PR 02 — Tests automatizados con `node:test`](docs/pr-02-tests.md)
3. [PR 03 — Persistencia opcional por archivo](docs/pr-03-server-file-persistence.md)
4. [PR 04 — Guía de despliegue en Render single-instance](docs/pr-04-render-single-instance.md)
5. [PR 05 — Indicador de conexión y sincronización](docs/pr-05-connection-status.md)
