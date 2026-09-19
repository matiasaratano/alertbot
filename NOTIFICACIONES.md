> **Vigente: Híbrido v9, 19/09/2026.** Telegram envía cruces RSI BUY/SELL en 4h, diario y semanal. Ver [guía actual](SEGUIMIENTO-TELEGRAM.md). El contenido que sigue documenta versiones anteriores.

> Bot con seguimiento manual: ver [SEGUIMIENTO-TELEGRAM.md](SEGUIMIENTO-TELEGRAM.md). Esa guía reemplaza las reglas de notificación anteriores; el Pine v8 se conserva.

# Indicador v8: oportunidades, divergencias y contexto

Versión del 15/09/2026. Archivo para pegar: `tradingview/alertbot.txt`. Usa Pine v6, con título v8. Se guarda la versión previa en `tradingview/previous-v7.pine` y el original elegido en `selected-confluence.pine`.

## Qué significa BUY / SELL

BUY y SELL son oportunidades para analizar, no órdenes de entrada o salida ni probabilidades. La EMA200 ya no bloquea los carteles. Un BUY puede ser un rebote debajo de EMA200; un SELL puede señalar una corrección encima. El tooltip y Telegram describen ese contexto.

El antiguo puntaje 2/4 en ocho velas se reemplazó por tres requisitos:

1. Un setup observado en la vela actual o las tres anteriores: salida RSI de 30/70, divergencia RSI confirmada, divergencia momentum confirmada o preaviso momentum de una vela.
2. Momentum moviéndose ahora en la dirección del cartel.
3. Cierre por encima del máximo de la vela anterior (BUY) o debajo de su mínimo (SELL).

Se usa cada evento de setup a lo sumo una vez para un cartel. Se permite otro de la misma dirección cuando transcurrieron más de cuatro velas, si existe un setup no consumido y aún vigente. La dirección opuesta no queda bloqueada. El cierre que satisface las tres condiciones puede ser el del setup o uno posterior dentro de la ventana; no es obligatorio esperar tres velas.

Un giro del momentum y una divergencia de momentum no se cuentan como dos pruebas independientes. El sistema pide evidencia actual del precio. No usa cruces de medias como disparadores y no activa BUY/SELL solo por una salida de squeeze. Los mismos parámetros operan en todos los marcos; no se optimizaron por activo o temporalidad.

Configurar ventana y pausa en `SETUP` de `setups.mjs` para Telegram y en los inputs del Pine para el gráfico. Los valores RSI/SQZ/pivotes/EMA permanecen en `INDICATOR` de `config.mjs`. Los campos confluenceWindow/minimumScore/signalCooldown/useEmaFilter de INDICATOR y ALERT_POLICY se conservan para comparar la antigua v7; ya no gobiernan los carteles o selección del scanner v8.

## Lectura visual sin añadir indicadores

- Círculo verde/rojo: RSI sale de sobreventa/sobrecompra.
- Rombo verde/rojo: primer giro alcista/bajista de momentum.
- Cuadrado verde/rojo: salida de squeeze en dirección alcista/bajista.
- BUY/SELL: los tres requisitos anteriores juntos al cierre. Al pasar el cursor se muestran los motivos.
- Líneas de divergencia momentum: comparan pivotes consecutivos, ambos negativos para alcista o positivos para bajista. RSI mantiene sus líneas en precio.
- Etiqueta RSI+/RSI−: muestra en el tooltip los dos valores RSI y los dos precios. La marca aparece en la confirmación; el extremo de la línea está cinco velas antes.
- Línea amarilla EN FORMACIÓN: candidata visual de la última vela; puede cambiar o desaparecer intravela. PRE queda en la vela del primer giro cerrado y todavía puede fallar.

Las marcas pequeñas conservan su sistema y ya no usan las letras R/S/SQ. Varias marcas de SQZ describen aspectos del mismo indicador; su cantidad no equivale a votos independientes ni a una probabilidad.

EMA50 y EMA200 se muestran por defecto; EMA20 es opcional para reducir superposición. Se pueden apagar individualmente. Si el gráfico ya tiene estas medias de otro indicador, desactivar uno de los dos juegos.

El resumen del panel muestra RSI actual y lado de EMA200. En ajustes, `Panel inferior` permite alternar Momentum/RSI sin consumir otro indicador; las divergencias RSI también se dibujan en el panel cuando se elige RSI. No se mezclan las escalas de ambos osciladores. Las confirmaciones M DIV+/− adicionales quedan ocultas por defecto, conservando las líneas.

## Telegram

| Marco | Avisos |
| --- | --- |
| 1h | BUY/SELL v8 que incluyan una divergencia RSI/momentum o PRE reciente; no se exige lado EMA200. Sin PRE aislados. |
| 4h y diario | BUY/SELL v8 y preavisos momentum aislados. |
| Semanal | El Pine funciona en el gráfico; el bot no escanea semanal. |

El setup interno puede usar PRE en cualquier temporalidad del gráfico. Las etiquetas/alertas PRE aisladas siguen restringidas a 4h y diario. El hecho de ocultar una marca no elimina la condición del cálculo.

Telegram conserva su pausa adicional de ocho velas por tipo/dirección y un PRE por referencia; por eso puede omitir carteles del gráfico. PRE + BUY/SELL de la misma vela y dirección se agrupan. Un BUY/SELL posterior al PRE puede avisar porque aporta ruptura de precio; una confirmación de momentum ya preavisada, sin otra condición nueva en esa vela, no vuelve a notificar por sí sola. Las divergencias confirmadas aisladas no se mandan. Watchdog continúa sin Telegram.

Cada mensaje identifica la fuente, extremos comparados, cierre, edad de condiciones y contexto EMA200. Las claves setup_bull/setup_bear se inicializan silenciosamente: la primera ejecución no manda el historial. El estado avanza solo después de enviar con éxito; no borrar state.json.

## Verificación y límites

Pruebas automatizadas de causalidad, signos, fechas, ventanas, cooldown, entrega y filtros. No se compiló este Pine con el motor de TradingView; una comparación del cálculo JS con Pine requiere datos y configuración idénticos.

La auditoría `audit-v8/INFORME.md` compara v7 y v8 en BTC/ETH 4h, diario y semanal con datos públicos de Kraken. Los resultados son mixtos y no establecen que v8 gane más. Por ejemplo, BTC 4h SELL pasa de 5 a 17 señales: el retorno medio neto a seis velas pasa de aproximadamente +0,07% a −0,30%. BTC diario BUY pasa de 3 a 10 señales: la tasa positiva baja de 100% a 50%, aunque la media neta sube de +1,59% a +2,00%. Son muestras pequeñas, no estimaciones fiables de rendimiento futuro.

La tasa de acierto por sí sola no mide si se gana dinero. El estudio usa salidas fijas y un coste supuesto; no modela tu gestión de posiciones ni valida acciones como NVDA. Se conservaron parámetros predefinidos, sin buscar combinaciones ganadoras sobre esta muestra.

TradingView documenta que exigir cierre reduce diferencias intravela, pero los pivotes dibujados hacia atrás y las revisiones del feed requieren cuidado: https://www.tradingview.com/pine-script-docs/concepts/repainting/ . Las líneas de pivotes siguen retrospectivas; las marcas de señal se dibujan en su detección, no en el extremo.

## Activación y diagnóstico pendiente

1. Commit y push de los archivos del bot.
2. Reemplazar el script del gráfico con `tradingview/alertbot.txt` y aplicar sus valores por defecto. Si se usan alertas propias de TradingView, recrearlas con el script nuevo. El bot Telegram no depende de esas alertas y no necesita cambiar token ni chat_id.
3. Ejecutar en GitHub Actions **Diagnóstico de señales (sin Telegram)** para reconstruir NVDA con el secreto Twelve Data. Su artefacto guarda velas, RSI, pivotes y oportunidades v8 sin enviar mensajes ni modificar el estado.

La discrepancia entre la captura RSI DIV− del 03/09 y el aviso del 14/09 sigue pendiente de contrastar: no se dispuso de la clave ni del artefacto del proveedor en esta sesión. Cambiar las señales no demuestra que esa discrepancia esté resuelta. Los logs nuevos SIGNAL_AUDIT registran parámetros y evento para futuras comparaciones.
