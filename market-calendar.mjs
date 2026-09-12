import fs from 'node:fs';
import { TF_MS, SETTLEMENT_MS } from './config.mjs';
const calendar = JSON.parse(fs.readFileSync(new URL('./us-sessions.json', import.meta.url), 'utf8'));
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit',
});
export function nyDate(time) {
  const parts = Object.fromEntries(dateFormat.formatToParts(time).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function sessionForDate(date) {
  if (date < calendar.start || date > calendar.end) throw new Error(`Calendario fuera de cobertura: ${date}. Regenerar us-sessions.json`);
  const session = calendar.sessions[date];
  return session ? { open:session[0], close:session[1] } : null;
}
export function stockBarTimes(datetime, tf) {
  if (!TF_MS[tf]) throw new Error(`Temporalidad no soportada: ${tf}`);
  const daily = tf === '1d';
  const timestamp = daily ? null : Date.parse(datetime.replace(' ', 'T') + 'Z');
  if (!daily && !Number.isFinite(timestamp)) throw new Error('Timestamp de acción inválido');
  const date = daily ? datetime.slice(0,10) : nyDate(timestamp);
  const session = sessionForDate(date);
  if (!session) throw new Error(`Vela recibida fuera de sesión: ${date}`);
  const open = daily ? session.open : timestamp;
  if (open < session.open || open >= session.close) throw new Error(`Vela fuera del horario regular: ${datetime}`);
  // Rechazar una alineación distinta en lugar de comparar series incompatibles.
  if (!daily && (open-session.open) % TF_MS[tf] !== 0) throw new Error(`Vela desalineada con sesión NY: ${datetime}`);
  return { open, close:daily ? session.close : Math.min(open+TF_MS[tf], session.close) };
}
const sessions = Object.values(calendar.sessions);
export function latestStockClose(tf, now = Date.now()) {
  if (!TF_MS[tf]) throw new Error(`Temporalidad no soportada: ${tf}`);
  sessionForDate(nyDate(now)); // valida cobertura incluso en feriados
  const cutoff = now - SETTLEMENT_MS;
  for (let i=sessions.length-1;i>=0;i--) {
    const [open, close] = sessions[i];
    if (open >= cutoff) continue;
    if (close <= cutoff) return close;
    if (tf !== '1d') {
      const bars = Math.floor((cutoff-open)/TF_MS[tf]);
      if (bars > 0) return open+bars*TF_MS[tf];
    }
  }
  throw new Error('No hay cierre previo dentro del calendario');
}
