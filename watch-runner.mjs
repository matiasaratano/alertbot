import {buildWeakness,transitionMonitor} from './monitor.mjs';
import {watchPrefix} from './watchlist.mjs';
import {TF_MS,maxAlertDelayMs} from './config.mjs';
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
 `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}&interval=${{'15m':'15','1h':'60','4h':'240','1d':'D'}[watch.tf]}`);
 return lines.join('\n');
}
export async function processWatch({state,watch,candles,send,persist,now=Date.now(),series}) {
 const prefix=watchPrefix(watch.symbol,watch.tf);
 const readings=series??buildWeakness(candles)[watch.side];
 const cursor=state[prefix+'cursor']??watch.started;
 const indices=candles.closeTime.map((t,i)=>[t,i]).filter(([t])=>t>cursor&&t<=now);
 if(!indices.length)return 0;
 // Consolidar cierres acumulados: no enviar una debilidad vieja ya recuperada.
 let episode={level:state[prefix+'level']??0,clear:state[prefix+'clear']??0};
 for(const [,i] of indices){
  // Solo un aviso entregado puede elevar el nivel persistido.
  if(readings[i].level===0)episode=transitionMonitor(episode,readings[i]).next;
  else episode={...episode,clear:0};
 }
 const [time,i]=indices.at(-1);const freshness=Math.min(maxAlertDelayMs(),TF_MS[watch.tf]);
 let sent=0;
 if(readings[i].level>episode.level&&now-time<=freshness){
  await send(monitorMessage(watch,readings[i],candles,now));sent=1;
  episode={level:readings[i].level,clear:0};
 }
 const draft={...state,[prefix+'level']:episode.level,[prefix+'clear']:episode.clear,[prefix+'cursor']:time};
 persist(draft);Object.assign(state,draft);
 return sent;
}
