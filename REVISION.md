# Revisión vigente: giro de una vela

Se reemplazó el detector intrabar demasiado anticipado por un extremo con cinco barras a izquierda y una a derecha, comparado contra el último pivot ya confirmado con cinco barras a derecha. Se conserva la separación 5–60 entre extremos y la comparación de high/low del precio en esos extremos.

La barra a derecha debe cerrar con giro estricto de momentum; una continuación o igualdad no dispara un preaviso. Cada extremo candidato tiene una sola barra de evaluación, por lo que no se repite ese candidato durante la continuación del giro. El detector solo utiliza la información conocida en ese cierre. No se agregaron filtros de RSI, tendencia o amplitud que cambien la estrategia acordada.

Pine y scanner usan la regla nueva. RSI y la confirmación opcional de cinco barras conservan su comportamiento. El mensaje identifica el giro de una vela y advierte que todavía es un preaviso. En el gráfico, la línea llega al candidato y la etiqueta se dibuja sobre la barra de detección.

30 pruebas pasan. Se probaron giro alcista, simetría bajista, continuación, momentum plano, condición de precio, referencias de cinco barras, no repetición del candidato, estabilidad al añadir datos futuros, fechas del mensaje y formato del Pine. Estas pruebas no compilan el Pine ni demuestran una mejora de tasa de aciertos.

Se mantienen las correcciones operativas de calendario de acciones, datos OHLC, estado después del envío, recuperación de errores, control de frecuencia, heartbeat y cron. La simulación real de Kraken mencionada en README corresponde a la revisión operativa anterior; no valida señales de esta nueva regla. No se desplegaron cambios ni se enviaron mensajes reales en esta actualización.

El código original de Downloads permanece sin modificar; el paquete contiene la copia actualizada del proyecto. README explica cómo activarlo y recrear alertas.
