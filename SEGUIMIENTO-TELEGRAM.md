# Telegram: oportunidades y seguimiento manual

El Pine v8 se conserva. El bot incorpora seguimiento direccional y amplía avisos de oportunidades, sin ejecutar operaciones.

Para resolver demoras del cron, se incluye un modo continuo preparado para servidor: [puesta en marcha](SERVIDOR-CONTINUO.md). Sigue inactivo hasta desplegarlo.

## Uso

Después de subir los cambios a GitHub, escribir al mismo bot:

```text
/seguir BTCUSD 1h long
/seguir NVDA 1h short
/posiciones
/dejar BTCUSD 1h
```

`/seguir` registra desde ese momento qué movimiento vigilar. No abre una orden, no conoce el precio de entrada ni consulta un broker. `/dejar` detiene el seguimiento; no cierra la operación. `/posiciones` lista seguimientos declarados, no posiciones reales. También están disponibles `/seguimientos`, `/ayuda` y `/start`. No hace falta configurar un menú en BotFather para que funcionen.

Marcos admitidos: 1h, 4h y 1d. Activos: BTCUSD, ETHUSD, SOLUSD, BNBUSD, AAPL, MSFT, NVDA, MELI, GOOGL, AMZN y META. El precio crypto es Kraken USD, no un futuro USDT. Acciones: Twelve Data, sesión regular. Un seguimiento por activo/marco, máximo ocho simultáneos. Cambiar long por short reinicia su estado. Repetir el mismo comando no lo reinicia; para una operación nueva en idéntica dirección usar /dejar y /seguir. Continúa hasta que lo quites.

El bot responde en su próxima ejecución. En chat privado solo acepta comandos del propietario de TELEGRAM_CHAT_ID. En grupos requiere configurar el secret TELEGRAM_ALLOWED_USER_ID con el ID del usuario autorizado. No acepta órdenes de otros chats, bots ni miembros no autorizados. Los comandos esperan hasta cuatro horas (MAX_ALERT_DELAY_MINUTES, por defecto 240). Si se procesan con al menos 15 minutos de demora se indica en la respuesta. Un seguimiento nuevo comienza al procesarlo, no retroactivamente; comandos más antiguos se rechazan.

Si ya existe un webhook o hay otro proceso leyendo getUpdates, se registra el error sin eliminar ni cambiar esa integración. En este caso revisar qué proceso usa el bot antes de activar el lector nuevo.

## Avisos durante un seguimiento

| Aviso | Condición |
| --- | --- |
| 🟡 DEBILITAMIENTO · LONG/SHORT | Dos o más marcas contrarias en las últimas tres velas cerradas; o divergencia contraria reciente; o momentum debilitándose durante dos cierres junto con un evento RSI contrario reciente. |
| 🔴 ESTRUCTURA CEDIÓ · LONG/SHORT | Cierre rompe el extremo de las tres velas anteriores contra el movimiento seguido, acompañado por debilidad de momentum, RSI o divergencia. |

Para LONG se buscan cambios bajistas; para SHORT, alcistas. Eventos RSI: salida contraria de banda 30/70 o cruce contrario de 50. La vigencia de eventos/divergencias es de tres velas, con sus edades en el mensaje. Las divergencias pueden ser confirmadas o PRE; se informa cuál y las fechas de ambos extremos. El precio y RSI mostrados corresponden al cierre analizado.

El aviso por marcas cuenta círculos RSI, rombos de giro y cuadrados de salida de squeeze, sin las letras del gráfico. Para LONG se cuentan las rojas; para SHORT las verdes. Cada evento se cuenta una sola vez en su vela; dos tipos distintos en una misma vela pueden completar el umbral. La ventana son la vela actual cerrada y las dos anteriores. El mensaje detalla tipos y antigüedad. Dos marcas son una advertencia visual, no dos pruebas independientes de reversión. Una sola marca no activa esta regla, aunque pueden activarse las otras condiciones de debilitamiento. Una compresión o una salida de squeeze sola no significa que terminó el impulso y no genera un aviso de cierre.

Cada episodio puede avisar una vez por debilitamiento y otra al escalar a pérdida de estructura. Puede comenzar directamente en el nivel rojo. La escalada no espera el cooldown de entradas. Para rearmar otro episodio se requieren dos cierres sin condición de debilidad con recuperación direccional: momentum del lado del movimiento, fortaleciéndose, RSI del lado correspondiente de 50 y precio avanzando. Las velas simplemente tranquilas de un lateral no rearman los avisos.

Si el scanner acumuló varias velas, recupera advertencias de las últimas cuatro horas. Envía como máximo un aviso por seguimiento y ejecución, priorizando la pérdida de estructura sobre la debilidad y el evento más reciente si empatan. Si la advertencia ya no aparece en el último cierre, se comunica como histórica junto con el estado de ese último cierre. La ausencia de debilidad no garantiza recuperación. Los episodios y el cursor se guardan después del envío exitoso. Una respuesta perdida de Telegram o un fallo de persistencia remota aún puede ocasionar un duplicado; no existe garantía de entrega exactamente una vez.

Durante el seguimiento se silencian oportunidades/PRE generales del mismo activo y marco para no recibir a la vez una advertencia de gestión y una entrada. Las oportunidades de otros activos/marcos continúan.

## Oportunidades nuevas

- Las oportunidades y seguimientos de Telegram se habilitan desde 1h. No se envían avisos de 15m.
- Se conservan los activos habituales en 1h, 4h y diario.
- Se elimina el veto adicional que en 1h exigía divergencia: un setup RSI que satisfaga precio y momentum del Pine v8 también puede avisar.
- Mensaje: POSIBLE LONG / POSIBLE SHORT. No significa que se estimó una probabilidad.
- La pausa adicional de oportunidades baja de ocho a cuatro velas; otro aviso de igual dirección se admite desde la quinta. Se conserva el cooldown propio de v8 y la deduplicación.
- Los PRE aislados generales siguen en 4h y diario. No se envían todas las marcas R/S/SQ.
- En un seguimiento activo se consultan también 15m de otros activos admitidos. No se añaden todas las acciones a 15m por defecto para controlar ruido y consumo de API.

Los avisos caducan al superar el menor de MAX_ALERT_DELAY_MINUTES y una vela del marco: evita presentar como nueva una oportunidad de 15m que tiene una hora. El monitor usa el mismo criterio de frescura para su último cierre.

## Fuentes y decisiones de diseño

[Fidelity: RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI) explica que RSI mide momentum, que puede permanecer extremo en tendencias fuertes y que sus zonas dependen del régimen. Por eso un punto rojo o verde aislado no prueba que acabó el movimiento.

[Charles Schwab: divergencias](https://www.schwab.com/learn/story/using-chart-divergences-to-make-trading-decisions) presenta las divergencias como advertencias potenciales y describe buscar confirmación en el precio. El bot distingue advertencia de ruptura reciente; no llama reversión confirmada a perder tres velas de estructura.

[LazyBear: descripción original de Squeeze Momentum](https://www.tradingview.com/script/nqQ1DT5a-Squeeze-Momentum-Indicator-LazyBear/) distingue compresión de volatilidad y dirección del momentum. La salida de un squeeze puede impulsar el movimiento en cualquier dirección, no necesariamente revertir el anterior.

Los umbrales de dos cierres, tres velas y rearme son decisiones explícitas de implementación. Estas fuentes no validan esa combinación ni aseguran que mejore la tasa de acierto. La secuencia impulso–lateral–reversión es una posibilidad; también puede haber continuación o una reversión sin lateral claro.

La auditoría [audit-monitor/INFORME.md](audit-monitor/INFORME.md) usa BTC/ETH reales para revisar frecuencia y repetición. Simula mantener un seguimiento fijo durante todo el período, no tus trades. Se usó para revisar ruido; no mide beneficio ni es una validación fuera de muestra. Para evaluar utilidad real conviene registrar si el aviso llegó antes del deterioro que te importaba, cuánto recorrido favorable quedaba y qué ocurría tras descartarlo, además de aciertos y pérdidas.

## Demora y ejecución

[GitHub documenta](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) posibles retrasos de las ejecuciones programadas. El cron actual consulta cada cinco minutos y el proveedor tiene margen de publicación. Se priorizan seguimientos activos y marcos cortos para disminuir demora interna, pero esto no garantiza avisos inmediatos ni reemplaza un stop del broker.

Para seguimiento de 15m con latencia predecible, el próximo cambio de infraestructura sería ejecutar el scanner de forma continua en un servidor. Esta actualización no migra hosting ni contrata servicios. Los mensajes muestran la demora desde el cierre; el bot no emite avisos de inactividad por Telegram.

## Persistencia y despliegue

Los seguimientos y el offset de comandos se cifran con AES-256-GCM en watch-state.enc, usando una clave derivada del TELEGRAM_TOKEN. El workflow persiste ese archivo junto con el estado general; las direcciones declaradas no se guardan en texto plano en state.json. El estado general puede seguir mostrando qué activo/marco se consultó. No se registra el token ni el texto de comandos en logs.

Conservar state.json y watch-state.enc. Si se rota TELEGRAM_TOKEN, el archivo previo no podrá descifrarse con el token nuevo: hay que migrarlo con la clave anterior o reiniciar conscientemente los seguimientos. Un archivo corrupto no se resetea silenciosamente. La lectura de comandos usa [getUpdates de Telegram](https://core.telegram.org/bots/api#getupdates) y guarda el offset para evitar repetirlos.

Para activar: commit y push de los cambios, esperar una ejecución exitosa de Actions y escribir /ayuda al bot. No volver a pegar el Pine: sus archivos no cambiaron en esta actualización. En privado se usan los mismos token y chat_id. Se verificó con pruebas y envíos simulados; no se enviaron mensajes reales desde esta sesión. El diagnóstico antiguo de NVDA sigue pendiente del artefacto de Twelve Data.

Actualización de marcas: la auditoría de volumen anterior en audit-monitor corresponde a la versión sin esta regla adicional de agrupación; no valida su frecuencia actual. El Pine no cambia. La implementación de este aviso está en monitor.mjs (marksMinimum=2, marksWindow=3).

## Ejecuciones cada tres horas

La vigencia de notificaciones es de cuatro horas para todos los marcos (1h, 4h y diario), configurada en MAX_ALERT_DELAY_MINUTES=240 tanto por defecto como en el workflow. Se elimina el límite adicional de una sola vela que descartaba avisos de marcos cortos. La frecuencia del cron no cambia; este ajuste tolera los huecos observados, no garantiza puntualidad.

Las oportunidades que pasan los filtros existentes se recuperan en orden de cierre; los cooldowns, referencias de divergencias ya avisadas y controles de duplicados permanecen activos. Pueden llegar oportunidades de sentidos opuestos si ocurrieron en cierres diferentes; hay que leer sus horarios. A partir de 15 minutos de demora se añade AVISO RECUPERADO, aclarando que precio y RSI corresponden al cierre histórico y que el movimiento puede haberse invalidado. Los seguimientos agrupan el intervalo en un solo aviso.

No se recuperan señales anteriores al alta inicial del scanner ni avisos ya consumidos por sus cursores. Tampoco se garantiza recuperar todo si la pausa supera cuatro horas, faltan datos del proveedor o fallan los envíos. No se han cambiado los filtros del Pine ni se presentan las señales históricas como oportunidades vigentes.

## Retiro de 15m

Los seguimientos antiguos de 15m quedan inactivos automáticamente: no se consultan ni aparecen en /posiciones. No se convierten en seguimientos de 1h. Podés borrar su registro con /dejar BTCUSD 15m y registrar uno nuevo con /seguir BTCUSD 1h long. El Pine no cambia.
