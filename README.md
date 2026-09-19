> **Vigente: Híbrido v9, 19/09/2026.** Telegram envía cruces RSI BUY/SELL en 4h, diario y semanal. Ver [guía actual](SEGUIMIENTO-TELEGRAM.md). El contenido que sigue documenta versiones anteriores.

> Bot con seguimiento manual: ver [SEGUIMIENTO-TELEGRAM.md](SEGUIMIENTO-TELEGRAM.md). Esa guía reemplaza las reglas de notificación anteriores; el Pine v8 se conserva.

> Versión vigente v8, 15/09/2026: consultar [NOTIFICACIONES.md](NOTIFICACIONES.md) y [comparación histórica](audit-v8/INFORME.md). Las revisiones siguientes describen versiones anteriores.

> Actualización 14/09/2026: la política vigente, el nuevo Pine y la activación están en [NOTIFICACIONES.md](NOTIFICACIONES.md). Las descripciones de la revisión anterior que siguen no incluyen los nuevos preavisos; su auditoría de volumen no valida esta versión.

# Alertbot — Telegram por prioridad y confluencia

Scanner de BTCUSD, ETHUSD, SOLUSD y BNBUSD (Kraken), y acciones estadounidenses (Twelve Data). Temporalidades:1h,4h y diario. Reproduce las condiciones principales del Pine final `SQZMOM + RSI + Divergencias + Confluencia v6` y aplica una selección adicional de mensajes.

Ver **NOTIFICACIONES.md** para la política exacta, el contraste de volumen sobre datos reales y la activación.

- 1h: confluencia3/4 con divergencia confirmada.
- 4h: confluencia2/4 con divergencia confirmada.
- Diario: confluencia o divergencia recién confirmada.
- Sin RSI/SQZ/PRE individuales. Un mensaje agrupado por dirección y vela, con pausa de8 velas por símbolo/temporalidad/dirección.
- Sin avisos de inactividad por Telegram. Diagnóstico manual en Actions.

## Uso

Node.js22 o posterior. No se necesitan dependencias npm para escanear.

```sh
npm test
npm run dry-run
```

La simulación consulta precios y no envía Telegram ni escribe estado. En una instalación nueva no muestra historial: inicializa la referencia de señales en memoria.

Para ejecución real, configurar TELEGRAM_TOKEN, TELEGRAM_CHAT_ID y opcionalmente TWELVEDATA_API_KEY como variables de entorno o secrets de GitHub. Localmente se puede copiar `.env.example` a `.env`, completarlo y usar:

```sh
node --env-file=.env scan.mjs
```

No subir `.env` ni credenciales. Conservar el state.json de producción. El scanner usa un lock local y el workflow serializa sus ejecuciones. Si un corte abrupto deja scan.lock, comprobar que no hay un scanner activo antes de quitarlo.

## Archivos relevantes

- config.mjs: parámetros del Pine, símbolos, temporalidades y política Telegram.
- confluence.mjs: RSI/SQZ, divergencias del precio/oscillador, ventana de coincidencia y EMA.
- scan.mjs: selección, agrupación, pausa de notificaciones, envío y persistencia.
- telegram.mjs: validación de respuestas, control de frecuencia y timeout.
- market-calendar.mjs y us-sessions.json: sesión regular estadounidense, DST, feriados y cierres anticipados. Calendario XNYS generado para2020–2030; actualizar ante cambios extraordinarios o fin de cobertura.
- tradingview/selected-confluence.pine: script aportado sin modificaciones.

## Límites

El cron solicita ejecución cada5 minutos; GitHub puede demorarla. Las velas se consideran publicables un minuto después de su cierre. Solo se consulta un cierre pendiente por símbolo/temporalidad. Eventos con más de120 minutos desde el cierre se omiten; MAX_ALERT_DELAY_MINUTES permite cambiarlo.

El bot y TradingView calculan por separado: usar los mismos inputs, feed y sesión. Se usan700 barras para inicializar indicadores, pero no se promete igualdad exacta de EMA/RSI con un gráfico de historial diferente. Los puntajes no son probabilidades; el estudio previo de PRE no valida esta nueva confluencia ni sus filtros.

Si Telegram acepta un mensaje pero se pierde su respuesta, o si falla el push del estado después del envío, podría repetirse al recuperar. La persistencia después de cada respuesta exitosa reduce el problema, sin garantizar exactamente una entrega.

40 pruebas aprobadas: ventanas y cooldowns, pivots de precio para RSI, EMA, selección por temporalidad, fechas reales de cierre, ausencia de dependencia futura, persistencia tras envío parcial, errores de API y watchdog sin Telegram. Prueba pública de volumen en BTC completada sin envíos ni cambios de estado.
