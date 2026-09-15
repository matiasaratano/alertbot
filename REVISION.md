> Bot con seguimiento manual: ver [SEGUIMIENTO-TELEGRAM.md](SEGUIMIENTO-TELEGRAM.md). Esa guía reemplaza las reglas de notificación anteriores; el Pine v8 se conserva.

> Versión vigente v8, 15/09/2026: consultar [NOTIFICACIONES.md](NOTIFICACIONES.md) y [comparación histórica](audit-v8/INFORME.md). Las revisiones siguientes describen versiones anteriores.

> Actualización 14/09/2026: la política vigente, el nuevo Pine y la activación están en [NOTIFICACIONES.md](NOTIFICACIONES.md). Las descripciones de la revisión anterior que siguen no incluyen los nuevos preavisos; su auditoría de volumen no valida esta versión.

# Revisión actual: confluencia y Telegram selectivo

El Pine elegido cambió la lógica respecto del detector PRE anterior. Se agregaron las divergencias RSI sobre pivots de precio, eventos de giro/salida SQZ y la confluencia de cuatro familias en ventana8, con EMA200 y cooldown8 del Pine.

La política de Telegram se separa de la señal del gráfico:1h exige3/4 con divergencia;4h exige2/4 con divergencia;diario admite confluencia o divergencia confirmada aislada. Se agrupan coincidencias y se limita la repetición por dirección durante8 velas. Los mensajes indican edades de evidencias y las divergencias contra tendencia. No se presenta el score como probabilidad.

El aviso automático de inactividad se retiró del cron y del módulo watchdog. Se mantienen diagnósticos manuales y logs del scanner.

40 pruebas pasan y se ejecutó una comparación pública de volumen de avisos en BTC, documentada en NOTIFICACIONES.md. Se verificó reducción de volumen, no aumento de rentabilidad ni coincidencia exacta con el motor de Pine. El script aportado se conservó intacto.

Esta revisión prepara cambios locales. Requiere commit y push para afectar la ejecución remota. No se enviaron mensajes reales ni se alteraron las credenciales o el estado operativo.
