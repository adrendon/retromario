# PR 05 — Indicador de conexión y sincronización

## Objetivo

Mostrar a pilotos y admin si la página está conectada en vivo por SSE, reconectando o sincronizando por polling.

## Alcance

- Agregar un indicador visual pequeño de estado de conexión.
- Actualizarlo desde `EventSource.onopen`, `EventSource.onerror` y el polling de `/api/state`.
- No bloquear la dinámica si SSE falla, porque el polling ya mantiene el estado actualizado.

## Estados sugeridos

- `Conectado en vivo`: SSE abierto.
- `Reconectando`: SSE falló y el navegador está intentando reconectar.
- `Sincronizando`: último polling de `/api/state` fue exitoso.
- `Sin conexión`: SSE falla y el polling también falla.

## Criterios de aceptación

- El usuario entiende que no necesita recargar si aparece `Reconectando` o `Sincronizando`.
- El indicador no tapa controles importantes.
- Si vuelve SSE, el estado cambia a `Conectado en vivo`.
- Si polling recupera estado, tablero y cronómetro se actualizan sin recargar.

## Riesgos

- Mensajes demasiado alarmantes pueden confundir a los pilotos.
- Debe ser discreto y orientado a tranquilidad: la app sigue intentando sincronizar.
