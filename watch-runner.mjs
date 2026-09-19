import {buildWeakness,transitionMonitor} from './monitor.mjs';
import {watchPrefix} from './watchlist.mjs';
import {maxAlertDelayMs} from './config.mjs';
const date=ms=>new Date(ms).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'});
export function monitorMessage(watch,event,candles,now) {
 const time=candles.closeTime[event.idx],symbol=watch.symbol;
 const tv=(['BTCUSD','ETHUSD','SOLUSD','BNBUSD'].includes(symbol)?'KRAKEN:':'NASDAQ:')+symbol;
 const lines=[`${event.level===2?'🔴 ESTRUCTURA CEDIÓ':'🟡 DEBILITAMIENTO'} · ${watch.side.toUpperCase()}`,`<b>${symbol}</b> · ${watch.tf} · ${tv.startsWith('KRAKEN:') ? 'Kraken USD' : 'Twelve Data, sesión regular'}`,
 ...event.evidence.map(e=>'• '+e)];
 if(event.rsiAge!==undefined)lines.push(`Evento RSI: hace ${event.rsiAge} vela(s).`);
 for(const p of event.pivots)lines.push(`• ${p.name==='rsi_div'?'RSI':'Momentum'} ${p.tentative?'tentativa':'confirmada'}: ${date(candles.openTime[p.prevIdx])} → ${date(candles.openTime[p.pivotIdx])} (ART); detectada hace ${event.divergenceAge} vela(s).`);
 lines.push(event.level===2?'Revisá tu operación: el precio también cedió contra el movimiento seguido.':'Revisá el impulso: puede ser una pausa, no necesariamente una reversión.',
 `Precio: ${event.price.toFixed(2)} USD · RSI: ${event.rsi.toFixed(1)}`,`Cierre: ${date(time)} (ART) · demora: ${Math.max(0,Math.floor((now-time)/60000))} min.`,
 `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}&interval=${{'15m':'15','1h':'60','4h':'240','1d':'D','1w':'W'}[watch.tf]}`);
 return lines.join('\n');
}
export async function processWatch({state,watch,candles,send,persist,now=Date.now(),series}) {
 const prefix=watchPrefix(watch.symbol,watch.tf);
 const readings=series??buildWeakness(candles)[watch.side];
 const cursor=state[prefix+'cursor']??watch.started;
 const indices=candles.closeTime.map((t,i)=>[t,i]).filter(([t])=>t>cursor&&t<=now);
 if(!indices.length)return 0;
 // Simular los episodios en orden y consolidar en un único aviso del intervalo.
 // La simulación no se guarda hasta que Telegram confirme el envío.
 let episode={level:state[prefix+'level']??0,clear:state[prefix+'clear']??0};
 let candidate;
 for(const [time,i] of indices){
  const reading=readings[i];
  if(reading.level===0)episode=transitionMonitor(episode,reading).next;
  else {
   episode={...episode,clear:0};
   if(reading.level>episode.level&&now-time<=maxAlertDelayMs()) {
    // Priorizar la advertencia más fuerte; la más reciente si empatan.
    if(!candidate||reading.level>=readings[candidate.i].level)candidate={time,i};
    episode={level:reading.level,clear:0};
   }
  }
 }
 const [lastTime,lastIdx]=indices.at(-1);
 let sent=0;
 if(candidate){
  const {time,i}=candidate;
  let message=monitorMessage(watch,{...readings[i],idx:i},candles,now);
  if(i!==lastIdx||now-time>=15*60000) {
   const status=['sin condición de debilidad en ese cierre (no garantiza recuperación)','debilitamiento','pérdida de estructura'][readings[lastIdx].level];
   message=`🕒 AVISO RECUPERADO DEL INTERVALO\n${message}\nÚltimo cierre revisado: ${date(lastTime)} (ART): ${status}.\nLa advertencia anterior describe lo que ocurrió; evaluá el gráfico actual antes de actuar.`;
  }
  await send(message);sent=1;
 }
 const draft={...state,[prefix+'level']:episode.level,[prefix+'clear']:episode.clear,[prefix+'cursor']:lastTime};
 persist(draft);Object.assign(state,draft);
 return sent;
}
