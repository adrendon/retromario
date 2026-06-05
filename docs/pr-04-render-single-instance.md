# PR 04 — Render en una sola instancia sin base de datos

## Objetivo

Documentar y dejar lista la configuración esperada para ejecutar la app en Render usando el servidor como fuente de verdad, sin base de datos.

## Alcance

- Documentar variables de entorno necesarias.
- Documentar que debe usarse una sola instancia/proceso.
- Documentar límites de estado en memoria y de persistencia opcional por archivo.
- Opcional: agregar `render.yaml` si se decide versionar infraestructura.

## Variables de entorno recomendadas

- `PORT`: asignado por la plataforma.
- `HOST=0.0.0.0`.
- `MARIO_ADMIN_PIN`: PIN real de facilitador.
- `MARIO_DATA_FILE`: opcional, solo si se monta almacenamiento persistente.

## Reglas operativas

- Mantener una sola instancia mientras no haya base de datos ni pub/sub.
- No usar múltiples procesos Node para el mismo servicio.
- Si se usa persistencia por archivo, no compartir el archivo entre varias instancias.
- Entender que reinicios sin archivo persistente borran la retro.

## Criterios de aceptación

- `README.md` explica cómo desplegar y qué limitaciones existen.
- La configuración recomendada no promete multi-instancia.
- Queda claro qué se pierde si Render reinicia el proceso sin archivo persistente.

## Riesgos

- Escalar a más de una instancia duplicaría estado y streams.
- Usar archivo local sin almacenamiento persistente puede dar falsa sensación de recuperación.
