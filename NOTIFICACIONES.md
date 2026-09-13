# Telegram: selección por prioridad

El bot usa la confluencia del Pine final aportado, con sus valores por defecto: RSI14 30/70; SQZMOM20; pivots5; rango5–60; ventana de coincidencia8; mínimo2; EMA200 activa; cooldown Pine8 (se permite otra señal cuando pasaron MÁS de8 barras).

## Qué llega

| Temporalidad | Requisito |
| --- | --- |
| 1h | BUY/SELL por confluencia del Pine, score mínimo3/4, incluyendo divergencia RSI o momentum confirmada en las últimas8 velas. |
| 4h | BUY/SELL por confluencia del Pine, score mínimo2/4, incluyendo divergencia confirmada en las últimas8 velas. |
| Diario | BUY/SELL por confluencia del Pine, o una divergencia RSI/momentum recién confirmada. |

No se mandan RSI, giros SQZ ni PRE individuales. Los switches visuales del Pine no modifican esta política del bot. Para cada símbolo, temporalidad y dirección, las coincidencias en una vela se agrupan. Se añade una pausa de8 velas entre notificaciones del mismo tipo; tras un aviso en la barra0, otro de igual dirección se admite desde la barra9. La dirección opuesta no queda bloqueada.

Esta pausa es adicional al cooldown del Pine: puede omitir intencionalmente alguna señal que sí ves en el gráfico. Una divergencia diaria aislada puede ir contra EMA200; el mensaje lo indica y no la presenta como BUY/SELL por confluencia.

## Qué significa el score

Son cuatro familias: salida de banda RSI, evento SQZMOM (giro o salida del squeeze), divergencia RSI, divergencia momentum. Cada familia suma a lo sumo un punto, aunque se repita dentro de la ventana. Las condiciones pueden tener hasta8 velas de antigüedad; el aviso muestra esa edad. Debe haber un evento nuevo para que el Pine genere BUY/SELL.

3/4 no significa75% de probabilidad de éxito. Son condiciones correlacionadas y esta combinación nueva no fue validada por el estudio anterior. La selección busca reducir interrupciones, no garantiza mejores operaciones.

Las divergencias de este Pine se confirman cinco velas después del extremo. El bot respeta esa demora: ya no ejecuta el detector PRE de la versión anterior. Las fórmulas se reprodujeron y se probaron causalmente, pero no se ejecutó una comparación automática contra el motor de TradingView. Feed, historial o inputs distintos pueden producir diferencias. Se piden700 velas para reducir el error de inicialización de EMA200; no elimina toda diferencia en casos límite.

## Muestra de volumen BTC/USD Kraken

La comparación reconstruye avisos del código anterior (RSI+PRE) y del nuevo con la pausa de notificación, sin enviar mensajes. Los períodos difieren entre temporalidades por el límite de historia del proveedor; no comparar estos totales como tasas diarias.

| TF | Ventana UTC | Antes | Ahora |
| --- | --- | ---: | ---: |
| 1h | 25/08/2026 19:00 a13/09/2026 13:00 |18|0|
| 4h | 30/06/2026 12:00 a13/09/2026 12:00 |23|6|
| Diario | 20/06/2025 a13/09/2026 |18|9|

En 1h el filtro es deliberadamente estricto. El detalle está en `priority-audit.json`; `audit-priority.mjs` permite repetir la comparación con velas nuevas. No mide aciertos, ganancias, latencia ni mensajes efectivamente enviados.

## Avisos de inactividad

El workflow watchdog dejó de tener cron y solo se puede ejecutar manualmente. `watchdog.mjs` no importa Telegram, no necesita token y solo escribe el diagnóstico en logs. El scanner mantiene heartbeat y errores en GitHub Actions. Esto no cambia las preferencias de notificaciones propias de tu cuenta de GitHub.

## Activación

Los cambios están preparados en la carpeta local del repositorio. Se activan con commit y push a main. No modificar el bot, chat_id o token de Telegram. No hace falta cambiar el Pine que acabás de elegir: se conservó tal cual en `tradingview/selected-confluence.pine` y en los archivos para copiar.

Si cambiaste los inputs respecto de sus valores por defecto, ajustar `INDICATOR` en config.mjs para que coincidan. `ALERT_POLICY` permite regular qué llega por cada temporalidad; `NOTIFICATION_COOLDOWN_BARS` controla la pausa de mensajes.

Conservar state.json. Las nuevas claves important_bull/important_bear se inicializan silenciosamente en el primer arranque, sin enviar historial. No se borran las claves anteriores. Las notificaciones y la pausa se guardan solo después de una respuesta exitosa de Telegram. Se mantiene la limitación de posibles duplicados ante respuesta perdida o fallo posterior de persistencia remota.
