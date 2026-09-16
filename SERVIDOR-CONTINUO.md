# Bot continuo: preparación y puesta en marcha

El cron de GitHub está configurado cada cinco minutos, pero en las ejecuciones revisadas del 16/09/2026 hubo inicios a las 08:22 y 12:27 ART, separados por más de cuatro horas. Ambas terminaron sin alertas; la ejecución manual de las 09:54 encontró dos. Ejecutar manualmente no cambia los filtros. Los comandos también se consultan solo durante una ejecución y ahora caducan después de cuatro horas.

GitHub advierte que las ejecuciones programadas pueden retrasarse o descartarse durante alta carga: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

## Qué incorpora este cambio

`npm start` mantiene el bot encendido. Consulta comandos cada cinco segundos después de terminar el ciclo anterior. Ejecuta el análisis al inicio y vuelve a intentarlo 60 segundos después de finalizar el análisis anterior. Las tareas son secuenciales: si un proveedor demora, los comandos esperan a que termine ese análisis. No garantiza respuestas en cinco segundos ni alertas instantáneas. Las señales siguen usando velas cerradas y el margen de publicación del proveedor.

Conserva los filtros, seguimientos y control de duplicados. La ventana de recuperación actual es de cuatro horas. Consultar más seguido permite detectar oportunidades antes de que caduquen; no genera señales nuevas ni asegura que un trade sea rentable. El indicador de TradingView no cambia.

Los logs muestran `TELEGRAM_POLL` con actualizaciones recibidas y comandos respondidos (incluidos errores de uso), `WORKER_ALIVE` aproximadamente cada minuto cuando el ciclo progresa, y `Listo: ... chequeos, ... alertas`. Las respuestas a comandos no se cuentan como alertas de mercado. `heartbeat.json` añade esos contadores al último análisis. No se envían avisos de funcionamiento a Telegram.

## Activar en Railway, cuando decidas contratar el servidor

El código está preparado; estos pasos no se han ejecutado y subir un commit no crea el servidor.

1. Subir los archivos de código y pruebas. Mantener Actions funcionando mientras se prepara la migración.
2. Crear un servicio desde el repositorio con despliegue inicialmente pausado, o sin las variables de Telegram hasta completar el paso 5. El Dockerfile inicia `node worker.mjs`; no requiere dominio, puerto ni healthcheck HTTP. Usar una sola réplica, servicio continuo (sin cron ni suspensión/serverless), y reinicio ante fallo.
3. Agregar un volumen persistente montado en `/data`. El Dockerfile configura `ALERTBOT_DATA_DIR=/data`. Ahí se conservan estado y seguimientos entre reinicios y despliegues. Sin volumen, se pueden perder al reemplazar el contenedor.
4. Preparar las mismas variables privadas de Actions: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `TWELVEDATA_API_KEY` y, solo para grupos, `TELEGRAM_ALLOWED_USER_ID`. Railway no hereda automáticamente los secrets de GitHub. Mantener el mismo token permite descifrar los seguimientos existentes. No incluir credenciales en archivos versionados.
5. Para el cambio efectivo: deshabilitar únicamente el workflow **Scan crypto & stock signals**, esperar a que termine cualquier ejecución pendiente y que persista sus archivos. Actualizar con `git pull --rebase origin main` y desplegar en Railway ese último commit, con el `state.json` y `watch-state.enc` más recientes. Recién entonces habilitar las variables y arrancar el servicio. No ejecutar Actions y el servidor a la vez: cada máquina tendría su propio estado y competiría por los mensajes de Telegram.
6. En el primer arranque, el servicio importa ambos archivos del commit al directorio `/data/runtime` de forma conjunta. En reinicios posteriores conserva el volumen, sin reimportar una copia vieja del repositorio. Comprobar logs y enviar `/posiciones`: los seguimientos anteriores deben aparecer. Si no aparecen, detener el servicio y revisar la versión inicial importada antes de continuar.
7. Para comprobar respuesta, usar `/posiciones` y, si se desea seguir BTC, `/seguir BTCUSD 15m long`. Esto solo registra seguimiento. Una respuesta confirma comunicación; que no haya alertas inmediatamente puede ser correcto si no hay condiciones nuevas.

Después de migrar, el estado vigente vive en el volumen, no en los commits de GitHub. Antes de volver a Actions, detener el servicio y recuperar `state.json` y `watch-state.enc` actuales; no reactivar con un estado antiguo. Para actualizar código en Railway, conservar el volumen y evitar despliegues simultáneos. No cambiar el token sin migrar el estado cifrado.

Documentación de referencia: https://docs.railway.com/volumes y https://docs.railway.com/guides/cron-workers-queues . Consultar el precio vigente al contratar; no se ha creado ni pagado ningún recurso.

## Ejecutar en una computadora propia

Con Node 22 o superior, Actions detenido y el estado más reciente descargado, cargar las variables de `.env.example` en un archivo `.env` local y ejecutar:

```sh
node --env-file=.env worker.mjs
```

La computadora debe seguir encendida, con conexión y sin suspensión. `npm start` sirve si las variables ya están exportadas. `npm run scan` sigue siendo la ejecución única para Actions; no iniciarla al mismo tiempo que el worker. El bloqueo se mantiene durante toda la vida del worker y se libera al terminar; después de un corte recupera bloqueos de procesos inexistentes. Un bloqueo inválido se debe investigar, no borrar mientras corre otro scanner.

## Verificación local

`npm test` incluye persistencia del volumen, recuperación del bloqueo, ciclos sin solapamiento, reintentos, apagado y comandos con Telegram simulado. No envía mensajes reales. No se ha construido la imagen Docker en esta computadora (Docker no está instalado). Se requiere verificar el despliegue y un comando real después de activar el servidor.
