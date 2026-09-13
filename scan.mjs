import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildConfluence, selectImportant } from './confluence.mjs';
import { fetchKrakenKlines, fetchTwelveDataSeries } from './data-sources.mjs';
import { latestStockClose } from './market-calendar.mjs';
import { sendTelegram } from './telegram.mjs';
import { CRYPTO_SYMBOLS, STOCK_SYMBOLS, TIMEFRAMES, SIGNALS, INDICATOR, TF_MS, HISTORY,
  SETTLEMENT_MS, maxAlertDelayMs, ALERT_POLICY, NOTIFICATION_COOLDOWN_BARS } from './config.mjs';

const STATE_PATH = new URL('./state.json', import.meta.url);
export function loadState(path = STATE_PATH) {
  try {
    const state = JSON.parse(fs.readFileSync(path,'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)
      || Object.values(state).some(value=>!Number.isFinite(value))) throw new Error('state.json inválido: se requiere un objeto de timestamps');
    return state;
  } catch (error) { if (error.code==='ENOENT') return {}; throw error; }
}
export function saveState(state, path = STATE_PATH) {
  const temp = new URL('./state.json.tmp',path);
  try {
    fs.writeFileSync(temp,JSON.stringify(state,null,2));
    fs.renameSync(temp,path);
  } catch (error) { error.statePersistenceFailed = true; throw error; }
}
export function analyzeSymbol(symbol, tf, candles) {
  const { openTime, closeTime, high, low, close } = candles;
  if (!TF_MS[tf]) throw new Error(`Temporalidad no soportada: ${tf}`);
  if (close.length < 250) throw new Error(`${symbol} ${tf}: historial insuficiente para EMA200`);
  if (!closeTime || [openTime,closeTime,high,low].some(a=>a.length!==close.length)) throw new Error('Serie desalineada o sin cierres');
  const selected = selectImportant(buildConfluence(candles, INDICATOR), tf, ALERT_POLICY);
  return selected.filter(e => e.idx >= 249).map(e => ({
    ...e, signal: `important_${e.side}`, barTime: openTime[e.idx], confirmedTime: closeTime[e.idx],
    cooldownCutoff: closeTime[e.idx - NOTIFICATION_COOLDOWN_BARS],
    evidence: e.evidence.map(c => ({ ...c, confirmedTime: closeTime[c.idx] })),
    pivots: e.pivots.map(d => ({ ...d, pivotTime: openTime[d.pivotIdx] })),
  })).sort((a,b) => a.confirmedTime - b.confirmedTime);
}
export function processEvents(state,symbol,tf,events,now=Date.now()) {
  const delay=maxAlertDelayMs();
  const prefix=`v2:${symbol}:${tf}:`;
  const known=new Set(SIGNALS.filter(signal=>Number.isFinite(state[prefix+signal])));
  for (const signal of SIGNALS) if (!known.has(signal)) state[prefix+signal]=now;
  const candidates = events.filter(ev=>known.has(ev.signal) && Number.isFinite(ev.confirmedTime)
    && ev.confirmedTime>state[prefix+ev.signal] && ev.confirmedTime<=now && now-ev.confirmedTime<=delay)
    .sort((a,b)=>a.confirmedTime-b.confirmedTime);
  const lastNotification = {};
  return candidates.filter(ev => {
    if (!ev.signal.startsWith('important_')) return true;
    const key = `_lastImportant:${symbol}:${tf}:${ev.signal}`;
    const last = lastNotification[key] ?? state[key] ?? -Infinity;
    if (last >= ev.cooldownCutoff) return false;
    lastNotification[key] = ev.confirmedTime;
    return true;
  });
}
export async function deliverEvents(state,symbol,tf,events,send,persist) {
  for (const ev of events) {
    await send(ev);
    state[`v2:${symbol}:${tf}:${ev.signal}`]=ev.confirmedTime;
    if (ev.signal.startsWith('important_')) state[`_lastImportant:${symbol}:${tf}:${ev.signal}`] = ev.confirmedTime;
    persist(state);
  }
}
const formatDate = ms=>new Date(ms).toLocaleString('es-AR',{
  timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
});
const escapeHtml = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function composeMessage(symbol, tf, ev, isCrypto, now = Date.now()) {
  const tvSymbol = isCrypto ? `KRAKEN:${symbol}` : `NASDAQ:${symbol}`;
  const interval = { '1h':'60', '4h':'240', '1d':'D' }[tf];
  const direction = ev.side === 'bull' ? 'ALCISTA' : 'BAJISTA';
  const lines = [
    `${tf === '1d' ? '⭐ DIARIO' : '🔎 REVISAR'} · ${direction}`,
    `<b>${escapeHtml(symbol)}</b> · ${tf} · ${isCrypto ? 'Kraken USD' : 'Twelve Data, sesión regular'}`,
    ev.confluenceSignal ? `Confluencia Pine: ${ev.score}/4 condiciones recientes` : 'Divergencia confirmada de marco diario',
  ];
  for (const c of ev.evidence) lines.push(`• ${c.label}: ${c.barsAgo === 0 ? 'esta vela' : `hace ${c.barsAgo} vela(s)`}`);
  if (ev.evidence.some(c => c.name.endsWith('_div'))) lines.push(`Los pivots se confirman ${INDICATOR.pivotLen} velas después del extremo.`);
  const sideEma = ev.price > ev.ema ? 'encima' : ev.price < ev.ema ? 'debajo' : 'sobre';
  lines.push(`Precio: ${ev.price.toFixed(2)} USD · RSI: ${ev.rsi.toFixed(1)} · ${sideEma} de EMA${INDICATOR.emaLength}`);
  if (!ev.confluenceSignal && !ev.trendOk) lines.push('Divergencia contra la tendencia EMA; no es BUY/SELL por confluencia.');
  lines.push(`✅ Cierre: ${formatDate(ev.confirmedTime)} (ART)`);
  const delay = Math.max(0, Math.floor((now - ev.confirmedTime) / 60000));
  lines.push(`📬 Detectada ${delay} min después del cierre.`);
  lines.push(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}&interval=${interval}`);
  return lines.join('\n');
}
export async function scanMarkets({state,persist,send,cryptoFetch=fetchKrakenKlines,stockFetch=fetchTwelveDataSeries,
  clock=Date.now,stockKey,cryptoSymbols=CRYPTO_SYMBOLS,stockSymbols=STOCK_SYMBOLS,timeframes=TIMEFRAMES}) {
  const errors=[]; let alertsSent=0; let checked=0;
  // Inicializar al arrancar, incluso fuera de sesión, para no silenciar
  // la primera señal futura de una temporalidad todavía no consultada.
  const started=clock();
  for (const symbol of [...cryptoSymbols,...(stockKey?stockSymbols:[])]) {
    for (const tf of timeframes) processEvents(state,symbol,tf,[],started);
  }
  persist(state);
  for (const isCrypto of [true,false]) {
    if (!isCrypto && !stockKey) continue;
    for (const symbol of isCrypto?cryptoSymbols:stockSymbols) {
      for (const tf of timeframes) {
        try {
          const now=clock();
          const target=isCrypto ? Math.floor((now-SETTLEMENT_MS)/TF_MS[tf])*TF_MS[tf] : latestStockClose(tf,now);
          // Los cierres antiguos (por ejemplo fin de semana) no requieren requests.
          if (now-target>maxAlertDelayMs()) continue;
          const checkKey=`_checkedClose:${symbol}:${tf}`;
          if ((state[checkKey] ?? 0)>=target) continue;
          const candles=isCrypto ? await cryptoFetch(symbol,tf,HISTORY) : await stockFetch(symbol,tf,stockKey,HISTORY);
          if (!candles.closeTime?.length) throw new Error('Sin velas cerradas');
          const actual=candles.closeTime.at(-1);
          // Si el proveedor está atrasado, no avanzar target: se reintenta en el próximo tick.
          const events=analyzeSymbol(symbol,tf,candles);
          const accepted=processEvents(state,symbol,tf,events,clock());
          persist(state);
          await deliverEvents(state,symbol,tf,accepted,async ev=>{
            await send(composeMessage(symbol,tf,ev,isCrypto,clock())); alertsSent++;
          },persist);
          if (actual<target) throw new Error(`Proveedor atrasado: último cierre ${new Date(actual).toISOString()}, esperado ${new Date(target).toISOString()}`);
          state[checkKey]=target; persist(state); checked++;
        } catch (error) {
          if (error.statePersistenceFailed) throw error;
          const message=`${symbol} ${tf}: ${error.message}`;
          errors.push(message); console.error(message);
        }
      }
    }
  }
  return {alertsSent,checked,healthy:errors.length===0,errors};
}
export async function run() {
  const token=process.env.TELEGRAM_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
  const dryRun=process.argv.includes('--dry-run');
  if (!dryRun && (!token || !chat)) throw new Error('Faltan TELEGRAM_TOKEN / TELEGRAM_CHAT_ID');
  maxAlertDelayMs();
  const lock=new URL('./scan.lock',import.meta.url);
  let lockFd;
  if (!dryRun) {
    try { lockFd=fs.openSync(lock,'wx'); fs.writeFileSync(lockFd,String(process.pid)); }
    catch (error) { if (error.code==='EEXIST') throw new Error('Ya existe scan.lock: hay otro scanner activo o quedó un bloqueo tras un corte'); throw error; }
  }
  try {
  const state=loadState();
  const result=await scanMarkets({state,persist:dryRun?()=>{}:saveState,send:dryRun?async text=>console.log('[SIMULADO]',text):text=>sendTelegram(token,chat,text),stockKey:process.env.TWELVEDATA_API_KEY});
  if (!dryRun) fs.writeFileSync(new URL('./heartbeat.json',import.meta.url),JSON.stringify({lastRun:new Date().toISOString(),...result},null,2));
  if (!result.healthy) throw new Error(`${result.errors.length} chequeos fallaron; ver logs`);
  console.log(`${dryRun?'Simulación':'Listo'}: ${result.checked} chequeos, ${result.alertsSent} alertas.`);
  } finally {
    if (lockFd!==undefined) { fs.closeSync(lockFd); fs.unlinkSync(lock); }
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  run().catch(error=>{console.error(error.message);process.exitCode=1;});
}
