# Versión actual: preaviso con giro de una vela cerrada

Se reemplazó la candidata intrabar por el punto intermedio acordado. Para una señal alcista, el momentum debe formar un mínimo local más alto que el pivot anterior, con un mínimo de precio más bajo; la siguiente vela debe CERRAR con momentum mayor que el del candidato. Para una bajista se invierten las condiciones. La referencia anterior sigue siendo un pivot confirmado con cinco barras a derecha. El candidato debe ser extremo respecto de cinco barras a izquierda.

El aviso llega al cierre de la primera vela posterior al candidato, no durante ella. Si momentum sigue en la misma dirección o permanece plano, no hay aviso. Cada candidato se evalúa una sola vez; un extremo posterior distinto puede producir otro preaviso. La distancia de 5–60 barras se mide entre extremos, sin sumar la barra que confirma el giro.

La línea discontinua termina en el extremo candidato; la etiqueta PRE aparece en la barra donde se conoce el giro, para no confundir una marca retrospectiva con una señal disponible antes. PRE sigue siendo un preaviso y puede fallar; no se ha demostrado estadísticamente una mejora de precisión.

Para pegar, crear un indicador nuevo y copiar TODO `tradingview/alertbot.txt`, desde la primera línea `//@version=6`. Guardar y recrear la alerta con “Any alert() function call”. Las confirmadas de cinco velas están desactivadas por defecto y se pueden activar por separado. Se mantiene la versión anterior confirmada en `tradingview/confirmed.pine`.

El bot usa la misma regla sobre velas cerradas. Su aviso agrega la demora del proveedor y la siguiente ejecución del cron. Esta actualización es local: no se publicó en el repositorio ni en TradingView, ni se enviaron mensajes reales. La compilación del Pine en TradingView sigue pendiente.

# Alertbot corregido — RSI + SQZMOM + Telegram

Escanea BTCUSD, ETHUSD, SOLUSD y BNBUSD en Kraken; AAPL, MSFT, NVDA, MELI, GOOGL, AMZN y META en Twelve Data. Temporalidades: 1h, 4h y 1d. Los parámetros están en `config.mjs` y deben coincidir con los inputs de TradingView.

Incluye `tradingview/alertbot.pine`, versión corregida del indicador aportado. `tradingview/original.pine` conserva la referencia. Se conserva el modo confirmado original y se agrega un modo de giro de una vela por defecto. En el modo confirmado: BUY al cruzar hacia arriba de 30, SELL al cruzar hacia abajo de 70 y divergencias entre pivots consecutivos de momentum.

## Qué cambia

- El Pine muestra PRE Bull / PRE Bear al cierre de una vela que confirme el giro de momentum. El extremo candidato esta en la vela anterior; se compara contra el ultimo pivot establecido con cinco barras a derecha. No avisa intrabar. El modo confirmado opcional conserva las marcas CONF.
- El scanner usa DIVERGENCE_MODE=turn por defecto: espera una barra cerrada a derecha del extremo candidato. La alternativa confirmed espera cinco barras; both muestra ambas clases. RSI no cambia.
- Cada envío se guarda solo después de recibir `ok: true` de Telegram. Si otro envío falla, no se descarta su señal ni se repiten intencionalmente los envíos ya confirmados.
- Se inicializan todas las señales al iniciar, incluso fuera del horario de acciones. No se reenvía historial de antes del primer arranque.
- Los cierres de acciones respetan la sesión regular estadounidense, DST, feriados y cierres anticipados. El diario cierra al terminar la sesión, no 24 horas después de una fecha interpretada como UTC.
- Se consulta por cierre pendiente. Un proveedor atrasado se reintenta en la siguiente ejecución. Se espera un minuto después del cierre para dar margen a la publicación.
- Los avisos de más de 120 minutos desde su confirmación se omiten deliberadamente. `MAX_ALERT_DELAY_MINUTES` permite cambiar esa ventana de recuperación. No es una cola histórica ilimitada.
- Se valida OHLC, timestamps, duplicados y alineación bursátil. Los errores salen en Actions y heartbeat, en vez de producir señales con datos inválidos.
- Se limitan consultas Twelve Data a una cada 8,1 segundos y los envíos al mismo chat. Solo se reintenta inmediatamente Telegram si respondió explícitamente 429 con una espera de hasta 30 segundos; los fallos ambiguos quedan para la siguiente corrida.

## Ponerlo en uso

1. Reemplazar los archivos de código del repositorio por los de este paquete, incluyendo `.github`, `config.mjs`, `market-calendar.mjs` y `us-sessions.json`. Conservar los secrets y el `state.json` operativo. El paquete no incluye credenciales ni un estado de producción.
2. Usar Node.js 22 o posterior y ejecutar `npm test`. No se necesitan paquetes npm ni Python para escanear.
3. En GitHub, mantener los secrets `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` y, para acciones, `TWELVEDATA_API_KEY`. Ejecutar el workflow manualmente y revisar el resultado.
4. En TradingView, pegar `tradingview/alertbot.pine` en Pine Editor, guardar y agregar al gráfico. Usar velas estándar, los mismos parámetros y la misma fuente: `KRAKEN:BTCUSD`, etc.; para acciones, sesión regular y ajuste por splits. No comparar contra Binance/USDT, Heikin Ashi o sesiones extendidas esperando igualdad.
5. Recrear las alertas de TradingView después del cambio: las existentes conservan una copia del script y sus inputs. Para avisos agrupados, elegir “Any alert() function call”. Para una condición individual, elegir PRE Bull giro 1 vela o PRE Bear giro 1 vela y frecuencia “Once Per Bar Close”; usar la misma frecuencia para RSI o confirmadas. Evitar activar ambas variantes si no se quieren avisos duplicados del mismo evento.

El scanner de Telegram continúa siendo independiente de las alertas de TradingView: este paquete no crea un webhook ni conecta automáticamente las dos rutas.

En el primer arranque de esta versión, las nuevas claves de estado toman la hora de inicio como referencia y omiten señales anteriores. Conservar el archivo permite mantener las claves existentes, pero los nuevos símbolos USD crean su propia referencia; no transformar a mano los timestamps antiguos de pivots en timestamps de confirmación.

## Ejecutar localmente

Desde la carpeta del bot:

```sh
npm test
npm run dry-run
```

La simulación consulta precios públicos de crypto, no envía Telegram y no escribe estado ni heartbeat. Solo muestra alertas si hay eventos nuevos respecto del estado leído; con una carpeta nueva inicializa una referencia en memoria y no muestra historia. Para acciones necesita la variable de Twelve Data.

Para configurar ejecución real, copiar `.env.example` a `.env`, completar los valores y ejecutar:

```sh
node --env-file=.env scan.mjs
```

No ejecutar dos copias contra el mismo chat y estado. `scan.lock` protege la ejecución local concurrente. Si un proceso termina abruptamente y deja ese archivo, verificar que ya no corre antes de quitarlo. El workflow de GitHub ya serializa sus ejecuciones.

## Frecuencia y límites

El workflow solicita una corrida cada cinco minutos, desplazada del minuto cero. Solo consulta proveedores si hay un cierre nuevo pendiente. Aumentar la frecuencia de Actions consume más ejecuciones/minutos que el cron anterior de 15 minutos; revisar la cuota del repositorio.

GitHub puede retrasar ejecuciones programadas: no se garantiza entrega inmediata. Un heartbeat cada corrida y un watchdog cada 30 minutos ayudan a detectar problemas, pero ambos dependen de GitHub. Si se necesita una garantía de latencia distinta, hace falta cambiar el servicio de ejecución.

Twelve Data y TradingView son feeds independientes. Incluso con fórmulas e inputs iguales pueden diferir precios, ajustes, profundidad del historial o disponibilidad según el plan. Se usan 500 velas para reducir el error de inicialización del RSI. Si una vela de Twelve Data no está alineada a la sesión regular, el bot falla explícitamente para ese instrumento.

La persistencia por git reduce duplicados, pero no garantiza entrega exactamente una vez: si Telegram acepta un mensaje y se pierde su respuesta, o si después falla el push del estado, podría repetirse al recuperar. No borrar el estado como solución habitual.

## Calendario

`us-sessions.json` cubre 2020–2030 y se generó con `exchange_calendars 4.13.2`, calendario XNYS, usado para la sesión regular de las acciones estadounidenses configuradas. No es un feed de cierres extraordinarios: mantenerlo actualizado si se anuncian cambios. Fuera de cobertura se produce un error explícito.

Para regenerarlo (solo mantenimiento):

```sh
python3 -m venv .calendar-venv
.calendar-venv/bin/pip install -r scripts/requirements-calendar.txt
.calendar-venv/bin/python scripts/generate-calendar.py
```

Cambiar las fechas del generador cuando se amplíe la cobertura; para incorporar reglas nuevas, actualizar y verificar la versión de la biblioteca.

## Validación y fuentes

30 pruebas automatizadas aprobadas. Las nuevas pruebas comprueban el giro de una vela, rechazan continuación y momentum plano, prueban simetría alcista/bajista, ausencia de dependencia futura y formato del archivo para pegar; no compilan Pine. Simulación real de cuatro chequeos crypto sin envíos ni estado. Consulta pública de BNBUSD: par disponible. Muestra pública de AAPL 1h: alineación UTC compatible con apertura NY. Pine comparado a nivel de código; pendiente compilación y contraste visual en TradingView. No se enviaron mensajes reales ni se desplegó esta copia.

- [TradingView: alertas y copias del script](https://www.tradingview.com/pine-script-docs/concepts/alerts/)
- [Kraken: último registro OHLC sin confirmar](https://docs.kraken.com/api-reference/market-data/get-ohlc-data)
- [Twelve Data: API y zona horaria](https://twelvedata.com/docs)
- [Calendarios bursátiles](https://github.com/gerrymanoim/exchange_calendars)
- [Telegram: límites de mensajes](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)
- [GitHub: demoras en workflows](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows)
