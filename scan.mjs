import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { rsiWilder, crossEvents, computeSqueezeMomentum, findPivots, findDivergences, findTurnDivergences } from './indicators.mjs';
import { fetchKrakenKlines, fetchTwelveDataSeries } from './data-sources.mjs';
import { latestStockClose } from './market-calendar.mjs';
import { sendTelegram } from './telegram.mjs';
import { CRYPTO_SYMBOLS, STOCK_SYMBOLS, TIMEFRAMES, SIGNALS, INDICATOR, TF_MS, HISTORY,
  SETTLEMENT_MS, maxAlertDelayMs, DIVERGENCE_MODE } from './config.mjs';

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
  if (close.length < 90) throw new Error(`${symbol} ${tf}: historial insuficiente`);
  if (!closeTime || [openTime,closeTime,high,low].some(a=>a.length!==close.length)) throw new Error('Serie desalineada o sin cierres');
  const p = INDICATOR;
  const events = [];
  const rsi = rsiWilder(close,p.rsiLen);
  const { crossover:buy } = crossEvents(rsi,p.buyLevel);
  const { crossunder:sell } = crossEvents(rsi,p.sellLevel);
  for (let i=p.rsiLen+1;i<close.length;i++) {
    if (buy[i]) events.push({signal:'rsi_buy',idx:i,text:`🟢 BUY (RSI) — cruzó por encima de ${p.buyLevel}. RSI=${rsi[i].toFixed(1)}`});
    if (sell[i]) events.push({signal:'rsi_sell',idx:i,text:`🔴 SELL (RSI) — cruzó por debajo de ${p.sellLevel}. RSI=${rsi[i].toFixed(1)}`});
  }
  const { val } = computeSqueezeMomentum(high,low,close,p.sqz);
  const pivots = findPivots(val,p.pivotLen,p.pivotLen);
  const { bullish,bearish } = findDivergences(pivots,{highPrices:high,lowPrices:low},p);
  if (DIVERGENCE_MODE !== 'turn') for (const d of bullish) events.push({signal:'div_bull',idx:d.idx,confirmedIdx:d.idx+p.pivotLen,text:'📈 Divergencia ALCISTA de Momentum'});
  if (DIVERGENCE_MODE !== 'turn') for (const d of bearish) events.push({signal:'div_bear',idx:d.idx,confirmedIdx:d.idx+p.pivotLen,text:'📉 Divergencia BAJISTA de Momentum'});
  if (DIVERGENCE_MODE !== 'confirmed') {
    const early=findTurnDivergences(val,high,low,p);
    for(const d of early.bullish) events.push({signal:'pre_bull',idx:d.idx,confirmedIdx:d.confirmedIdx,preliminary:true,text:'🔎 PRE Bull — giro alcista de Momentum confirmado por 1 vela cerrada. Preaviso.'});
    for(const d of early.bearish) events.push({signal:'pre_bear',idx:d.idx,confirmedIdx:d.confirmedIdx,preliminary:true,text:'🔎 PRE Bear — giro bajista de Momentum confirmado por 1 vela cerrada. Preaviso.'});
  }
  return events.map(e=>({...e,barTime:openTime[e.idx],confirmedTime:closeTime[e.confirmedIdx ?? e.idx]}))
    .sort((a,b)=>a.confirmedTime-b.confirmedTime);
}
export function processEvents(state,symbol,tf,events,now=Date.now()) {
  const delay=maxAlertDelayMs();
  const prefix=`v2:${symbol}:${tf}:`;
  const known=new Set(SIGNALS.filter(signal=>Number.isFinite(state[prefix+signal])));
  for (const signal of SIGNALS) if (!known.has(signal)) state[prefix+signal]=now;
  return events.filter(ev=>known.has(ev.signal) && Number.isFinite(ev.confirmedTime)
    && ev.confirmedTime>state[prefix+ev.signal] && ev.confirmedTime<=now && now-ev.confirmedTime<=delay)
    .sort((a,b)=>a.confirmedTime-b.confirmedTime);
}
export async function deliverEvents(state,symbol,tf,events,send,persist) {
  for (const ev of events) {
    await send(ev);
    state[`v2:${symbol}:${tf}:${ev.signal}`]=ev.confirmedTime;
    persist(state);
  }
}
const formatDate = ms=>new Date(ms).toLocaleString('es-AR',{
  timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
});
export function composeMessage(symbol,tf,ev,isCrypto,now=Date.now()) {
  const tvSymbol=isCrypto ? `KRAKEN:${symbol}` : `NASDAQ:${symbol}`;
  const interval={ '1h':'60', '4h':'240', '1d':'D' }[tf];
  const lines=[ev.text,`<b>${symbol}</b> · ${tf} · ${isCrypto?'Kraken':'Twelve Data, sesión regular'}`,
    `🕒 ${ev.confirmedIdx==null?'Vela':'Pivot'}: ${formatDate(ev.barTime)} (ART)`,
    `✅ ${ev.preliminary?'Giro confirmado (1 vela)':'Confirmación'}: ${formatDate(ev.confirmedTime)} (ART)`,
    `📬 Detectada: ${formatDate(now)} (ART)`];
  if (ev.preliminary) lines.push('Preaviso tras 1 vela de giro. Todavía no es la divergencia confirmada de 5 velas; puede fallar.');
  if (ev.confirmedIdx!=null && !ev.preliminary) lines.push(`Confirmada ${INDICATOR.pivotLen} velas después del pivot.`);
  const delay=Math.floor((now-ev.confirmedTime)/60000);
  if (delay>=15) lines.push(`⏱ Recibida ${delay} min después del cierre de confirmación.`);
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
