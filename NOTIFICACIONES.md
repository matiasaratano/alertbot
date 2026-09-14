# Avisos de Telegram y preaviso de momentum

Actualización del 14/09/2026. El Pine para pegar es `tradingview/alertbot.txt` (Pine v6, título v7). `selected-confluence.pine` conserva el original anterior.

## Qué llega

| Marco | Notificaciones |
| --- | --- |
| 1h | Confluencia BUY/SELL con al menos 3/4 familias, incluyendo divergencia confirmada reciente. Sin preavisos. |
| 4h | Preaviso de momentum al primer giro cerrado; también confluencia BUY/SELL con 2/4 y divergencia confirmada reciente. |
| Diario | Preaviso de momentum al primer giro cerrado; también confluencia BUY/SELL con 2/4. |

Se eliminaron las divergencias confirmadas aisladas de Telegram. No se envían salidas RSI ni giros SQZ aislados. Watchdog sigue sin enviar Telegram.

## Regla del preaviso

Se compara un extremo candidato del histograma con su último pivote confirmado conocido antes del cierre actual. El candidato debe ser un extremo respecto de las cinco velas anteriores, estar separado 5–60 velas de la referencia y tener el mismo signo: máximos positivos para bajista, mínimos negativos para alcista. En bajista, el high del precio en el candidato supera al de la referencia, mientras el momentum es menor. En alcista, el low es menor y el momentum menos negativo. La siguiente vela debe cerrar con giro estricto del momentum.

No reduce los cinco lados del pivote confirmado ni modifica el score o EMA200 de las confluencias. El preaviso no exige filtro EMA; es una candidata, no BUY/SELL. Puede fallar y un movimiento rápido puede haber avanzado incluso antes de este aviso.

Una alerta como máximo por extremo de referencia y dirección, con persistencia tras envío exitoso. Hay además una pausa de ocho velas por símbolo, marco y tipo/dirección de aviso: el siguiente se admite desde la novena. Por eso Telegram puede omitir un PRE visible en el gráfico. Si hay PRE y confluencia en la misma vela y dirección se agrupan como confluencia. Una confirmación de momentum ya preavisada se silencia si no hay otra familia nueva en esa vela; una confluencia con evidencia nueva puede avisar posteriormente.

En TradingView, la línea amarilla discontinua EN FORMACIÓN sigue al candidato en la última vela y puede desaparecer, incluso intravela. No dispara Telegram. PRE queda en la vela cerrada que detectó el primer giro. Su línea une los extremos anteriores. Confirmaciones a cinco velas siguen visibles. Los preavisos visuales y sus alertas se habilitan por defecto solamente en 4h y diario; las alertas individuales de confirmación quedan desactivadas por defecto.

## Discrepancia NVDA pendiente de contraste

La captura muestra una confirmación alrededor del 03/09, mientras Telegram notificó una el 14/09. No se ha establecido la causa. No se dispone localmente del secreto Twelve Data ni de una exportación OHLC de TradingView para comparar los dos cálculos. No asumir que cambiar a preavisos corrige esa diferencia.

Después de subir los cambios, ejecutar en GitHub Actions **Diagnóstico de señales (sin Telegram)**. Descargar el artefacto `nvda-signal-diagnostic`: contiene `signal-diagnostic.json` con las 700 velas de Twelve Data, parámetros, RSI y fechas/precios de los extremos. No envía mensajes ni modifica state.json. Una exportación del gráfico de TradingView con idéntico símbolo, marco, sesión y ajustes permite comparar los datos. Un diagnóstico posterior usa el historial que el proveedor entregue entonces; no recupera una instantánea antigua si fue revisada.

Cada aviso nuevo muestra fechas ART de ambos extremos, fuente y cierre de detección. El scanner registra `SIGNAL_AUDIT` en los logs de Actions con los parámetros y el evento, sin credenciales. Las fuentes pueden diferir y las condiciones de confluencia pueden tener hasta ocho velas: la edad se muestra explícitamente. El score no es una probabilidad de acierto.

## Activación

1. Commit y push de los cambios del repositorio.
2. Pegar `tradingview/alertbot.txt` en el editor Pine, guardar y aplicar. Comprobar inputs por defecto: pivote5, rango5–60, RSI14 30/70, SQZMOM20, ventana8, mínimo2, EMA200 y cooldown8. El bot usa `config.mjs`; cambiar inputs del gráfico no lo reconfigura.
3. Si se usan alertas propias de TradingView, recrearlas con el script actualizado. Telegram continúa siendo enviado por el scanner de GitHub: no necesita cambiar token ni chat_id.
4. Ejecutar el diagnóstico manual de NVDA y revisar el artefacto.

Conservar state.json. En el primer arranque las nuevas claves early_bull/early_bear se inicializan sin enviar historial. Persisten las limitaciones de duplicados si Telegram recibió el mensaje pero se perdió su respuesta o no se consiguió persistir remotamente el estado.

Las pruebas automatizadas cubren lógica causal, deduplicación, errores de entrega, filtros y mensajes. No se compiló el Pine en el motor de TradingView ni se midió rentabilidad de esta nueva selección. `priority-audit.json` pertenece a la política anterior y no valida los preavisos actuales.
