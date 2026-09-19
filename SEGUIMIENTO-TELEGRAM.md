# Telegram · RSI + Momentum Híbrido v9

Versión del 19/09/2026. El Pine elegido está preservado exactamente en `tradingview/hybrid-v9.pine`. Los archivos `alertbot.pine` y `alertbot.txt` anteriores corresponden a v8; no reemplazar el v9 del gráfico por ellos. No hace falta cambiar el Pine que ya pegaste.

## BUY y SELL

- BUY: RSI de 14 períodos pasa de un valor menor o igual a 30 a uno mayor que 30.
- SELL: RSI pasa de un valor mayor o igual a 70 a uno menor que 70.
- Se evalúan velas cerradas. No se exige EMA200, giro de momentum, divergencia ni ruptura de precio.
- No hay cooldown adicional entre cruces: cada cruce válido puede avisar una vez. Permanecer por encima/debajo de una banda no repite el aviso.

Temporalidades habilitadas: **4h, 1d y 1w**. Se desactivan 15m y 1h, incluidas las notificaciones de seguimientos antiguos. No se trasladan automáticamente a otro marco.

El scanner general emite exclusivamente BUY/SELL del RSI v9; deja de emitir los setups y preavisos momentum de v8. Las divergencias siguen visibles en el Pine. Sus alertas agrupadas de TradingView son una configuración separada: este bot no recibe el alert() de TradingView, recalcula los cruces con sus datos.

Activos: BTCUSD, ETHUSD, SOLUSD, BNBUSD, AAPL, MSFT, NVDA, MELI, GOOGL, AMZN y META. Acciones requieren TWELVEDATA_API_KEY. Comparar el mismo activo, fuente, tipo de vela normal, parámetros RSI y sesión regular. La equivalencia es de reglas; no se garantiza identidad de todas las señales si cambian datos, ajustes o profundidad de historial entre proveedores y TradingView.

## Semanal

Crypto: lunes 00:00 UTC a lunes 00:00 UTC (cierre domingo 21:00 ART). Kraken devuelve semanas nativas alineadas al jueves; por eso se construyen semanas lunes-domingo con días UTC completos. El endpoint devuelve hasta 720 velas: hay aproximadamente 102 semanas reconstruidas, menos si el activo tiene poco historial. El arranque de RSI puede diferir del historial más largo de TradingView, especialmente cerca de 30/70. No se utiliza ni la primera semana incompleta ni la actual; los huecos intermedios producen un error para no calcular con semanas incompletas.

Acciones: interval=1week de Twelve Data, apertura en la primera sesión de la semana y cierre en la última sesión real. Se respetan feriados, horario de verano y cierres reducidos del calendario XNYS. El historial semanal se pide desde 2020-01-06, dentro del calendario 2020–2030 disponible. No se considera confirmada una vela semanal un miércoles ni un jueves si aún queda una sesión el viernes.

Los datos deben tener al menos 16 cierres para evaluar un cruce de RSI14. La EMA200 no limita el historial mínimo ni los BUY/SELL.

Fuentes técnicas: [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data), [Twelve Data](https://twelvedata.com/docs). La alineación al jueves se comprobó directamente en el endpoint público de Kraken.

## Demoras y duplicados

Se mantiene MAX_ALERT_DELAY_MINUTES=240: hasta cuatro horas para cubrir ejecuciones espaciadas tres horas. Desde 15 minutos de demora se muestra AVISO RECUPERADO; precio y RSI corresponden al cierre original. Si la interrupción supera cuatro horas, todavía puede haber señales que no se recuperen. La frecuencia de Actions no se modifica.

El estado v9 usa claves separadas para que los filtros/cooldowns viejos no oculten nuevos cruces. En la primera ejecución puede recuperar cruces de las últimas cuatro horas; no envía todo el historial. Se guarda el cruce después de un envío exitoso y se reintenta lo pendiente tras errores. No se garantiza entrega exactamente una vez si Telegram acepta el mensaje pero se pierde su respuesta.

## Seguimientos opcionales

```text
/seguir BTCUSD 4h long
/seguir NVDA 1d short
/seguir BTCUSD 1w long
/posiciones
/dejar BTCUSD 4h
```

Los seguimientos no operan ni conocen tu entrada, TP o SL. Mantienen las advertencias previas de debilitamiento y pérdida de estructura, con sus reglas propias, separadas de BUY/SELL v9. Durante un seguimiento también llegan los cruces BUY/SELL del mismo activo y marco.

El monitor avisa por dos marcas contrarias en tres cierres, divergencia contraria reciente, o debilitamiento de momentum acompañado de RSI. Escala si hay ruptura contraria de estructura con evidencia. Agrupa el intervalo pendiente en un aviso por seguimiento, prioriza el más fuerte e informa el estado del último cierre; requiere recuperación durante dos cierres para rearmar un episodio. Esas advertencias no equivalen a carteles BUY/SELL del Pine v9.

Los seguimientos de 15m/1h quedan inactivos y no aparecen en /posiciones; se pueden borrar con /dejar BTCUSD 15m o /dejar BTCUSD 1h. Un seguimiento nuevo comienza al procesarse el comando, no retroactivamente. Los comandos caducan después de cuatro horas y se indica si hubo demora. En privado solo se aceptan comandos del propietario; en grupos se requiere TELEGRAM_ALLOWED_USER_ID.

## Activación y comprobación

Subir los cambios de código a main y comprobar la siguiente ejecución de Actions. No requiere contratar un servidor ni modificar BotFather. El modo continuo sigue siendo opcional: [guía](SERVIDOR-CONTINUO.md).

`npm test` cubre cruces sin filtros v8, deduplicación, recuperación, exclusión de 1h, seguimiento, cierres semanales y feriados. Se comprobaron semanas reales de BTC, ETH, SOL y BNB sin enviar Telegram: 102 semanas para los tres primeros y 72 para BNB al revisar esta versión. Twelve Data se verificó con respuestas simuladas; no se ha comparado su resultado con el gráfico del usuario ni ejecutado un envío real desde este entorno.
