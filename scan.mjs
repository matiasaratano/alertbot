import fs from 'node:fs';
import {runtimeFile,initializeData} from './runtime-paths.mjs';
import {acquireLock} from './runtime-lock.mjs';
import { pathToFileURL } from 'node:url';
import { buildSetups, selectSetups } from './setups.mjs';
import {loadPrivateState,createRuntimePersist} from './private-state.mjs';
import {listWatches,fetchTelegramUpdates,processCommands} from './watchlist.mjs';
import {processWatch} from './watch-runner.mjs';
import { buildEarly } from './early.mjs';
import { fetchKrakenKlines, fetchTwelveDataSeries } from './data-sources.mjs';
import { latestStockClose } from './market-calendar.mjs';
import { sendTelegram } from './telegram.mjs';
import { CRYPTO_SYMBOLS, STOCK_SYMBOLS, TIMEFRAMES, SIGNALS, INDICATOR, TF_MS, HISTORY,
  ENTRY_15M_SYMBOLS, EARLY_TIMEFRAMES, SETTLEMENT_MS, maxAlertDelayMs, NOTIFICATION_COOLDOWN_BARS } from './config.mjs';

export function loadState(path = runtimeFile('state.json')) {
  try {
    const state = JSON.parse(fs.readFileSync(path,'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)
      || Object.values(state).some(value=>!Number.isFinite(value))) throw new Error('state.json inválido: se requiere un objeto de timestamps');
    return state;
  } catch (error) { if (error.code==='ENOENT') return {}; throw error; }
}
export function saveState(state, path = runtimeFile('state.json')) {
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
  const selected = selectSetups(buildSetups(candles, INDICATOR), tf);
  if (EARLY_TIMEFRAMES.includes(tf)) {
    const early = buildEarly(candles, INDICATOR);
    // Evitar dos mensajes en el mismo cierre y dirección; conservar la confluencia.
    for (const e of early) {
      const confluence = selected.find(c => c.idx === e.idx && c.side === e.side);
      if (confluence) {
        confluence.earlyReference = e.pivots[0].prevIdx;
        if (!confluence.pivots.some(d => d.tentative && d.prevIdx === e.pivots[0].prevIdx && d.pivotIdx === e.pivots[0].pivotIdx)) confluence.pivots.push({...e.pivots[0], tentative:true});
      }
      else selected.push(e);
    }
  }
  return selected.filter(e => e.idx >= 249).map(e => ({
    ...e, signal: `${e.kind === 'early' ? 'early' : e.kind === 'setup' ? 'setup' : 'important'}_${e.side}`, barTime: openTime[e.idx], confirmedTime: closeTime[e.idx],
    cooldownCutoff: closeTime[e.idx - (e.kind === 'setup' ? 4 : NOTIFICATION_COOLDOWN_BARS)],
    evidence: e.evidence.map(c => ({ ...c, confirmedTime: closeTime[c.idx] })),
    earlyReferenceTime: e.kind === 'early' ? openTime[e.pivots[0].prevIdx] : e.earlyReference === undefined ? (e.pivots.find(d => d.tentative) ? openTime[e.pivots.find(d => d.tentative).prevIdx] : undefined) : openTime[e.earlyReference],
    pivots: e.pivots.map(d => ({ ...d, pivotTime: openTime[d.pivotIdx], prevTime: openTime[d.prevIdx] })),
  })).sort((a,b) => a.confirmedTime - b.confirmedTime);
}
export function processEvents(state,symbol,tf,events,now=Date.now()) {
  const delay=maxAlertDelayMs();
  const prefix=`v2:${symbol}:${tf}:`;
  const known=new Set(SIGNALS.filter(signal=>Number.isFinite(state[prefix+signal])));
  for (const signal of SIGNALS) if (!known.has(signal)) state[prefix+signal]=now;
  const candidates = events.filter(ev=>known.has(ev.signal) && Number.isFinite(ev.confirmedTime)
    && ev.confirmedTime>state[prefix+ev.signal] && ev.confirmedTime<=now && now-ev.confirmedTime<=Math.min(delay,TF_MS[tf]))
    .sort((a,b)=>a.confirmedTime-b.confirmedTime);
  const lastNotification = {};
  return candidates.filter(ev => {
    const referenceKey = `_earlyReference:${symbol}:${tf}:${ev.side}`;
    const sentReference = lastNotification[referenceKey] ?? state[referenceKey] ?? -Infinity;
    if (ev.kind === 'early' && ev.earlyReferenceTime !== undefined && ev.earlyReferenceTime <= sentReference) return false;
    // Una confirmación de momentum ya preavisada no vuelve a disparar por sí sola.
    if (ev.kind !== 'early' && ev.pivots?.some(p => p.name === 'mom_div' && p.prevTime <= sentReference)
      && !ev.evidence.some(c => c.barsAgo === 0 && c.name !== 'mom_div')) return false;
    if (!ev.signal.startsWith('important_') && !ev.signal.startsWith('early_') && !ev.signal.startsWith('setup_')) return true;
    const key = `_lastImportant:${symbol}:${tf}:${ev.signal}`;
    const last = lastNotification[key] ?? state[key] ?? -Infinity;
    if (last >= ev.cooldownCutoff) return false;
    lastNotification[key] = ev.confirmedTime;
    if (ev.earlyReferenceTime !== undefined) lastNotification[referenceKey] = Math.max(sentReference, ev.earlyReferenceTime);
    return true;
  });
}
export async function deliverEvents(state,symbol,tf,events,send,persist) {
  for (const ev of events) {
    await send(ev);
    state[`v2:${symbol}:${tf}:${ev.signal}`]=ev.confirmedTime;
    if (ev.signal.startsWith('important_') || ev.signal.startsWith('early_') || ev.signal.startsWith('setup_')) state[`_lastImportant:${symbol}:${tf}:${ev.signal}`] = ev.confirmedTime;
    if (ev.earlyReferenceTime !== undefined) state[`_earlyReference:${symbol}:${tf}:${ev.side}`] = Math.max(state[`_earlyReference:${symbol}:${tf}:${ev.side}`] ?? -Infinity, ev.earlyReferenceTime);
    persist(state);
  }
}
const formatDate = ms=>new Date(ms).toLocaleString('es-AR',{
  timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
});
const escapeHtml = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function composeMessage(symbol, tf, ev, isCrypto, now = Date.now()) {
  const tvSymbol = isCrypto ? `KRAKEN:${symbol}` : `NASDAQ:${symbol}`;
  const interval = { '15m':'15', '1h':'60', '4h':'240', '1d':'D' }[tf];
  const direction = ev.side === 'bull' ? 'ALCISTA' : 'BAJISTA';
  const lines = [
    `${ev.kind === 'early' ? '👀 POSIBLE DIVERGENCIA MOMENTUM' : ev.confluenceSignal ? (ev.kind === 'setup' ? (ev.side === 'bull' ? 'POSIBLE LONG' : 'POSIBLE SHORT') : (ev.side === 'bull' ? 'BUY' : 'SELL')) + (ev.kind === 'setup' ? ' · REVISAR' : ' · CONFLUENCIA') : 'DIVERGENCIA CONFIRMADA · SIN BUY/SELL'} · ${direction}`,
    `<b>${escapeHtml(symbol)}</b> · ${tf} · ${isCrypto ? 'Kraken USD' : 'Twelve Data, sesión regular'}`,
    ev.kind === 'setup' ? 'Setup reciente + giro del momentum + ruptura de precio al cierre.' : ev.kind === 'early' ? 'Primer giro con una vela cerrada. Candidata: puede invalidarse; no es BUY/SELL.' : ev.confluenceSignal ? `Confluencia Pine: ${ev.score}/4 condiciones recientes` : 'Divergencia confirmada de marco diario',
  ];
  if (ev.kind === 'setup') lines.push(ev.trendOk ? 'Contexto EMA200 a favor. Evaluar contexto y riesgo.' : 'Contra EMA200: posible corrección o giro; evaluar contexto y riesgo.');
  for (const p of ev.pivots ?? []) {
    if (Number.isFinite(p.prevTime) && Number.isFinite(p.pivotTime)) lines.push(`• Extremos ${p.name === 'rsi_div' ? 'RSI' : 'momentum'}${p.tentative ? ' candidato' : ''}: ${formatDate(p.prevTime)} → ${formatDate(p.pivotTime)} (ART)`);
  }
  for (const c of ev.evidence) lines.push(`• ${c.label}: ${c.barsAgo === 0 ? 'esta vela' : `hace ${c.barsAgo} vela(s)`}`);
  if (ev.evidence.some(c => c.name.endsWith('_div'))) lines.push(`Los pivots se confirman ${INDICATOR.pivotLen} velas después del extremo.`);
  const sideEma = ev.price > ev.ema ? 'encima' : ev.price < ev.ema ? 'debajo' : 'sobre';
  lines.push(`Precio: ${ev.price.toFixed(2)} USD · RSI: ${ev.rsi.toFixed(1)} · ${sideEma} de EMA${INDICATOR.emaLength}`);
  if (ev.kind !== 'early' && !ev.confluenceSignal && !ev.trendOk) lines.push('Divergencia contra la tendencia EMA; no es BUY/SELL por confluencia.');
  lines.push(`✅ Cierre: ${formatDate(ev.confirmedTime)} (ART)`);
  const delay = Math.max(0, Math.floor((now - ev.confirmedTime) / 60000));
  lines.push(`📬 Detectada ${delay} min después del cierre.`);
  lines.push(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}&interval=${interval}`);
  return lines.join('\n');
}
export async function scanMarkets({state,persist,send,cryptoFetch=fetchKrakenKlines,stockFetch=fetchTwelveDataSeries,
  clock=Date.now,stockKey,cryptoSymbols=CRYPTO_SYMBOLS,stockSymbols=STOCK_SYMBOLS,timeframes=TIMEFRAMES,extraTargets=[]}) {
  const errors=[]; let alertsSent=0; let checked=0;
  const started=clock(),watches=listWatches(state);
  const targets=new Map();
  const add=(symbol,tf,opportunities)=>{
    const isCrypto=CRYPTO_SYMBOLS.includes(symbol)||cryptoSymbols.includes(symbol);
    if(!isCrypto&&!stockKey)return;
    const key=`${symbol}:${tf}`;const existing=targets.get(key);
    targets.set(key,{symbol,tf,isCrypto,opportunities:opportunities||existing?.opportunities||false,watch:watches.find(w=>w.symbol===symbol&&w.tf===tf)});
  };
  for(const symbol of [...cryptoSymbols,...stockSymbols])for(const tf of timeframes)add(symbol,tf,true);
  for(const t of extraTargets)add(t.symbol,t.tf,true);
  for(const w of watches)add(w.symbol,w.tf,false);
  // Seguimientos primero, y luego marcos cortos, para reducir demora propia.
  const ordered=[...targets.values()].sort((a,b)=>Number(Boolean(b.watch))-Number(Boolean(a.watch))||TF_MS[a.tf]-TF_MS[b.tf]);
  for(const t of ordered)if(t.opportunities)processEvents(state,t.symbol,t.tf,[],started);
  persist(state);
  for(const {symbol,tf,isCrypto,opportunities,watch} of ordered) {
        try {
          const now=clock();
          const target=isCrypto ? Math.floor((now-SETTLEMENT_MS)/TF_MS[tf])*TF_MS[tf] : latestStockClose(tf,now);
          // Los cierres antiguos (por ejemplo fin de semana) no requieren requests.
          if (now-target>maxAlertDelayMs()) continue;
          const checkKey=`_checkedClose:${symbol}:${tf}`;
          const watchDue=watch&&(state[`_watch:${symbol}:${tf}:cursor`]??0)<target;
          if ((state[checkKey] ?? 0)>=target&&!watchDue) continue;
          const candles=isCrypto ? await cryptoFetch(symbol,tf,HISTORY) : await stockFetch(symbol,tf,stockKey,HISTORY);
          if (!candles.closeTime?.length) throw new Error('Sin velas cerradas');
          if(candles.close.length<250)throw new Error('Historial insuficiente: se requieren 250 velas cerradas');
          const actual=candles.closeTime.at(-1);
          // Si el proveedor está atrasado, no avanzar target: se reintenta en el próximo tick.
          const events=opportunities?analyzeSymbol(symbol,tf,candles):[];
          if(watch&&actual>=target)alertsSent+=await processWatch({state,watch,candles,send,persist,now:clock()});
          // El seguimiento ya indica qué revisar: no superponer una entrada en
          // el mismo activo/marco mientras el usuario lo sigue.
          if(watch)for(const side of ['bull','bear'])for(const type of ['setup','early'])state[`v2:${symbol}:${tf}:${type}_${side}`]=actual;
          const accepted=watch?[]:processEvents(state,symbol,tf,events,clock());
          persist(state);
          await deliverEvents(state,symbol,tf,accepted,async ev=>{
            console.info('SIGNAL_AUDIT', JSON.stringify({symbol,tf,parameters:INDICATOR,event:ev}));
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
  return {alertsSent,checked,healthy:errors.length===0,errors};
}
export async function run({commandsOnly=false,lockHeld=false}={}) {
  const token=process.env.TELEGRAM_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
  const dryRun=process.argv.includes('--dry-run');
  if (!dryRun && (!token || !chat)) throw new Error('Faltan TELEGRAM_TOKEN / TELEGRAM_CHAT_ID');
  maxAlertDelayMs();
  if(!dryRun)initializeData();
  const release=!dryRun&&!lockHeld?acquireLock(runtimeFile('scan.lock')):undefined;
  try {
  const state={...loadState(),...(token?loadPrivateState(token):{})};
  const persistRuntime=createRuntimePersist(token,saveState);
  let commandError,commandsProcessed=0,updatesReceived=0;
  if(!dryRun) {
    try {
      const updates=await fetchTelegramUpdates(token,state._telegramUpdateOffset??0);
      updatesReceived=updates.length;
      commandsProcessed=await processCommands({state,updates,chatId:chat,allowedUserId:process.env.TELEGRAM_ALLOWED_USER_ID,persist:persistRuntime,reply:text=>sendTelegram(token,chat,text)});
    } catch(error) {
      if(error.statePersistenceFailed)throw error;
      commandError='Comandos Telegram: '+error.message;console.error(commandError);
    }
  }
  if(!commandsOnly||updatesReceived||commandError)console.info('TELEGRAM_POLL',JSON.stringify({at:new Date().toISOString(),updatesReceived,commandsProcessed,healthy:!commandError}));
  if(commandsOnly){if(commandError)throw Error(commandError);return {commandsProcessed,updatesReceived};}
  const result=await scanMarkets({state,persist:dryRun?()=>{}:persistRuntime,send:dryRun?async text=>console.log('[SIMULADO]',text):text=>sendTelegram(token,chat,text),stockKey:process.env.TWELVEDATA_API_KEY,extraTargets:ENTRY_15M_SYMBOLS.map(symbol=>({symbol,tf:'15m'}))});
  Object.assign(result,{commandsProcessed,updatesReceived});
  if(commandError){result.errors.push(commandError);result.healthy=false;}
  if (!dryRun) fs.writeFileSync(runtimeFile('heartbeat.json'),JSON.stringify({lastRun:new Date().toISOString(),...result},null,2));
  if (!result.healthy) throw new Error(`${result.errors.length} chequeos fallaron; ver logs`);
  console.log(`${dryRun?'Simulación':'Listo'}: ${result.checked} chequeos, ${result.alertsSent} alertas.`);
  return result;
  } finally {
    release?.();
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  run().catch(error=>{console.error(error.message);process.exitCode=1;});
}
