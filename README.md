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
