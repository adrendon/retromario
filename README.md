# 🏁 Retro Mario Kart

Retrospectiva ágil estilo Mario Kart, en tiempo real, sin dependencias externas.
Node.js puro (`http`, `fs`, `crypto`) + HTML/CSS/JS vanilla.

## Cómo correrlo

```bash
node server.js
```

Abre [http://localhost:3000](http://localhost:3000) para entrar como piloto,
o [http://localhost:3000/admin](http://localhost:3000/admin) para entrar como facilitador.

## Admin

- PIN por defecto: `sitioBanco` (cambiable con la variable de entorno `MARIO_ADMIN_PIN`).
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

## Diagnóstico y plan para múltiples usuarios en Render

### Diagnóstico rápido

La app ya está pensada para colaboración en tiempo real usando un único proceso Node.js con REST + SSE (`/api/stream`). En Render funciona bien si todos los usuarios llegan al mismo proceso, pero había dos riesgos importantes para sesiones con varios usuarios:

1. El identificador de cliente nacía en cada conexión SSE. Si Render, el proxy o el navegador cortaban y reabrían el stream, el servidor podía tratar al mismo navegador como otro usuario temporal y también podía soltar el rol de admin.
2. Algunas acciones admin dependían de enviar el `clientId` correcto; por ejemplo, limpiar el tablero no lo enviaba y podía fallar con `403`.

### Plan de trabajo recomendado

1. **Estabilizar identidad por pestaña**: mantener un `clientId` de sesión en el navegador y pasarlo a `/api/stream` para que reconectar SSE no duplique ni expulse usuarios.
2. **Hacer admin tolerante a reconexiones**: conservar el mismo `clientId` al reabrir el stream para no perder permisos por cortes normales de Render/proxy.
3. **Asegurar llamadas admin**: todas las llamadas protegidas deben enviar `clientId` en body/header.
4. **Render en una sola instancia**: mientras el estado siga en memoria, usar una sola instancia/proceso. Si se escala horizontalmente, mover estado y pub/sub a Redis/Postgres.
5. **Persistencia futura**: si la retro debe sobrevivir reinicios/suspensión de Render, guardar `cards`, `steps`, `actions`, `timer`, `sprint` y `objective` en almacenamiento externo.
6. **Observabilidad mínima**: agregar logs de conexión/reconexión y endpoints de health check antes de producción formal.

### Ajustes aplicados para sesiones admin y participantes

- El admin recibe una sesión temporal en memoria al ingresar el PIN. Si recarga la página en el mismo navegador/pestaña, la app intenta restaurar esa sesión y no debería pedir el PIN de nuevo mientras el servidor siga vivo.
- La lista de pilotos muestra los participantes registrados durante la sesión del servidor, aunque una conexión SSE se corte o el usuario recargue. Esto evita que desaparezcan usuarios que ya crearon su piloto.
- Importante: Render puede reiniciar o dormir servicios free. Como el estado actual vive en memoria, un reinicio del proceso borra admin, pilotos y tablero. Para conservarlos entre reinicios se necesita persistencia externa.
