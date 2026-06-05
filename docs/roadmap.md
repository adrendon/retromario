# Roadmap de estabilización sin base de datos

Este roadmap convierte las mejoras pendientes en PRs pequeños y revisables. La decisión de arquitectura es explícita: **no se usará base de datos**. El servidor Node será la fuente de verdad mientras la retro esté corriendo.

## Decisión base

- La app debe operar con **una sola instancia/proceso** porque el estado vive en memoria del servidor.
- El `clientId` de cada pestaña identifica a pilotos y admin durante reconexiones normales.
- El admin se restaura con token de sesión mientras el proceso Node siga vivo.
- El tablero, pasos, tarjetas, acciones, cronómetro, sprint y objetivo pertenecen al estado del servidor.
- Si el proceso se reinicia, el estado en memoria se pierde. Esto es aceptado mientras no se implemente persistencia en archivo del servidor.

## Lo que ya está implementado

- Identidad por pestaña con `clientId` en `sessionStorage`.
- Envío de `clientId` a `/api/stream` para evitar duplicados por reconexión SSE.
- Sesión admin temporal con `adminToken` en `sessionStorage` y restauración con `/api/admin/restore`.
- Llamadas admin protegidas enviando `clientId` y `adminToken` en header/body.
- Tablero oculto hasta que el admin active el paso 5.
- Sincronización completa por SSE y polling de `/api/state` cada pocos segundos para evitar que los usuarios tengan que recargar.

## Qué vamos a ejecutar en PRs separados

1. [PR 01 — Health check y logs](./pr-01-health-logs.md)
2. [PR 02 — Tests automatizados](./pr-02-tests.md)
3. [PR 03 — Persistencia opcional en archivo del servidor](./pr-03-server-file-persistence.md)
4. [PR 04 — Configuración y guía de Render sin base de datos](./pr-04-render-single-instance.md)
5. [PR 05 — Indicador de conexión y sincronización](./pr-05-connection-status.md)

## Orden recomendado

1. Primero observabilidad: saber si el server, SSE, admin y pilotos están sanos.
2. Luego tests: proteger lo que ya funciona antes de tocar persistencia.
3. Después persistencia en archivo: opcional y solo si el despliegue ofrece almacenamiento persistente.
4. Finalmente UX de conexión: mostrar claramente si se está conectado, reconectando o sincronizando por polling.

## Qué no se hará por ahora

- No se agregará Postgres, Redis, MongoDB ni otra base de datos.
- No se habilitarán múltiples instancias mientras el estado siga en memoria o archivo local.
- No se implementará pub/sub distribuido.
