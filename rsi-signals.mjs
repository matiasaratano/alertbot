import {rsiWilder,crossEvents} from './indicators.mjs';
import {ema} from './confluence.mjs';
import {INDICATOR,maxAlertDelayMs} from './config.mjs';
export function buildRsiSignals(candles,p=INDICATOR) {
 const rsi=rsiWilder(candles.close,p.rsiLen),trend=ema(candles.close,p.emaLength);
 const buy=crossEvents(rsi,p.buyLevel).crossover,sell=crossEvents(rsi,p.sellLevel).crossunder;
 const out=[];
 for(let i=1;i<rsi.length;i++)if(buy[i]||sell[i])out.push({idx:i,kind:'rsi',side:buy[i]?'bull':'bear',signal:buy[i]?'rsi_buy':'rsi_sell',
  price:candles.close[i],rsi:rsi[i],previousRsi:rsi[i-1],ema:trend[i],level:buy[i]?p.buyLevel:p.sellLevel,
  barTime:candles.openTime[i],confirmedTime:candles.closeTime[i],evidence:[],pivots:[]});
 return out;
}
const prefix=(symbol,tf)=>`v9:${symbol}:${tf}:`;
export function initializeRsiState(state,symbol,tf,now) {
 for(const type of ['rsi_buy','rsi_sell'])if(!Number.isFinite(state[prefix(symbol,tf)+type]))state[prefix(symbol,tf)+type]=now-maxAlertDelayMs()-1;
}
export function pendingRsiEvents(state,symbol,tf,events,now) {
 initializeRsiState(state,symbol,tf,now);
 return events.filter(e=>e.confirmedTime>state[prefix(symbol,tf)+e.signal]&&e.confirmedTime<=now&&now-e.confirmedTime<=maxAlertDelayMs()).sort((a,b)=>a.confirmedTime-b.confirmedTime);
}
export async function deliverRsiEvents(state,symbol,tf,events,send,persist) {
 for(const event of events){await send(event);state[prefix(symbol,tf)+event.signal]=event.confirmedTime;persist(state);}
}
export function rsiMessage(symbol,tf,e,isCrypto,now) {
 const date=new Date(e.confirmedTime).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hourCycle:'h23'}),delay=Math.max(0,Math.floor((now-e.confirmedTime)/60000));
 const side=e.side==='bull'?'BUY':'SELL',source=isCrypto?'Kraken USD':'Twelve Data, sesión regular';
 const text=[`${side} · RSI · Híbrido v9`,`${symbol} · ${tf} · ${source}`,
  `RSI(${INDICATOR.rsiLen}) cruzó ${side==='BUY'?'por encima':'por debajo'} de ${e.level} al cierre: ${e.previousRsi.toFixed(2)} → ${e.rsi.toFixed(2)}.`,
  `Precio al cierre: ${e.price.toFixed(2)} USD.`,
  `Cierre: ${date} (ART) · Detectada ${delay} min después del cierre.`];
 if(delay>=15)text.push('🕒 AVISO RECUPERADO: describe un cierre anterior. Revisá el gráfico actual; el movimiento puede haber cambiado.');
 text.push(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent((isCrypto?'KRAKEN:':'NASDAQ:')+symbol)}&interval=${{'4h':'240','1d':'D','1w':'W'}[tf]}`);
 return text.join('\n');
}
