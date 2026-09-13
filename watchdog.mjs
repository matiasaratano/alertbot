import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Diagnóstico manual, sin mensajes a Telegram ni necesidad de credenciales.
export function heartbeatStatus(heartbeat, now = Date.now()) {
  const last = Date.parse(heartbeat?.lastRun);
  if (!Number.isFinite(last) || last > now || now - last > 30 * 60000) return { healthy: false, reason: 'Heartbeat ausente, inválido o de más de 30 minutos.' };
  if (heartbeat.healthy === false) return { healthy: false, reason: 'La última corrida registró errores; revisar Actions.' };
  return { healthy: true, reason: 'Heartbeat reciente.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let heartbeat;
  try { heartbeat = JSON.parse(fs.readFileSync(new URL('./heartbeat.json', import.meta.url), 'utf8')); } catch {}
  const status = heartbeatStatus(heartbeat);
  console.log(status.reason);
  process.exitCode = status.healthy ? 0 : 1;
}
