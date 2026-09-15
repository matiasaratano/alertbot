import {computeSqueezeMomentum,rsiWilder,crossEvents} from './indicators.mjs';
import {buildConfluence} from './confluence.mjs';
import {buildEarly} from './early.mjs';
import {INDICATOR} from './config.mjs';
export const MONITOR = {evidenceWindow:3,structureBars:3,recoveryBars:2,marksWindow:3,marksMinimum:2};

// Las marcas se cuentan como eventos visuales, no como pruebas independientes de reversión.
// Nivel 1: debilitamiento. Nivel 2: además cede estructura de precio reciente.
export function classifyWeakness({side,momentum,rsiWarning,divergence,priceBreak,marks=[],marksWindow=MONITOR.marksWindow,marksMinimum=MONITOR.marksMinimum}) {
 const evidence=[];
 const cluster=marks.length>=marksMinimum;
 if(cluster)evidence.push(`${marks.length} marcas ${side==='long'?'rojas':'verdes'} en ${marksWindow} velas: ${marks.map(m=>`${m.label} (hace ${m.barsAgo})`).join(', ')}`);
 if(momentum)evidence.push('Momentum pierde fuerza durante dos cierres');
 if(rsiWarning)evidence.push('RSI muestra debilidad contra el movimiento');
 if(divergence)evidence.push('Divergencia contraria (ver tipo y fecha)');
 if(priceBreak)evidence.push('Cierre rompe el extremo de las tres velas anteriores');
 const level=priceBreak&&(momentum||rsiWarning||divergence)?2:cluster||divergence||(momentum&&rsiWarning)?1:0;
 return {side,level,evidence};
}
// Fórmulas de círculos, rombos y cuadrados del Pine v8. Cada marca se
// registra una vez en su vela; un valor RSI extremo sostenido no suma marcas.
export function smallMarkers(val,sqzOn,rsi,p=INDICATOR) {
 const bull=Array.from({length:val.length},()=>[]),bear=Array.from({length:val.length},()=>[]);
 const up=crossEvents(rsi,p.buyLevel).crossover,down=crossEvents(rsi,p.sellLevel).crossunder;
 for(let i=0;i<val.length;i++) {
  const add=(side,kind,label)=>side[i].push({idx:i,kind,label});
  if(up[i])add(bull,'rsi','círculo RSI');if(down[i])add(bear,'rsi','círculo RSI');
  if(i<2||![val[i],val[i-1],val[i-2]].every(Number.isFinite))continue;
  if(val[i]<0&&val[i]>val[i-1]&&val[i-1]<=val[i-2])add(bull,'turn','rombo momentum');
  if(val[i]>0&&val[i]<val[i-1]&&val[i-1]>=val[i-2])add(bear,'turn','rombo momentum');
  if(sqzOn[i-1]&&!sqzOn[i]){
   if(val[i]>0&&val[i]>val[i-1])add(bull,'release','cuadrado squeeze');
   if(val[i]<0&&val[i]<val[i-1])add(bear,'release','cuadrado squeeze');
  }
 }
 return {bull,bear};
}
export function recentMarkers(series,idx,window=MONITOR.marksWindow) {
 return series.slice(Math.max(0,idx-window+1),idx+1).flat().map(m=>({...m,barsAgo:idx-m.idx}));
}
export function buildWeakness(candles,p=INDICATOR,options=MONITOR) {
 const {close,high,low}=candles,n=close.length;
 const {val,sqzOn}=computeSqueezeMomentum(high,low,close,p.sqz),rsi=rsiWilder(close,p.rsiLen);
 const bearRsi=crossEvents(rsi,p.sellLevel).crossunder,bullRsi=crossEvents(rsi,p.buyLevel).crossover;
 const markers=smallMarkers(val,sqzOn,rsi,p);
 const below50=crossEvents(rsi,50).crossunder,above50=crossEvents(rsi,50).crossover;
 const divs={bull:new Map(),bear:new Map()};
 for(const e of [...buildConfluence(candles,p),...buildEarly(candles,p)]) {
  const items=e.kind==='early'?e.pivots.map(d=>({...d,tentative:true})):e.pivots.filter(d=>d.pivotIdx+p.pivotLen===e.idx);
  if(items.length)divs[e.side].set(e.idx,[...(divs[e.side].get(e.idx)??[]),...items]);
 }
 const results={long:[],short:[]};
 for(const side of ['long','short']) {
  let lastRsi=-Infinity,lastDiv=-Infinity,lastDetails=[];
  for(let i=0;i<n;i++) {
   const isLong=side==='long',opposite=isLong?'bear':'bull';
   if((isLong?bearRsi[i]||below50[i]:bullRsi[i]||above50[i]))lastRsi=i;
   if(divs[opposite].has(i)){lastDiv=i;lastDetails=divs[opposite].get(i);}
   const ready=i>=options.structureBars&&[val[i],val[i-1],val[i-2]].every(Number.isFinite);
   const momentum=ready&&(isLong?val[i]<val[i-1]&&val[i-1]<val[i-2]:val[i]>val[i-1]&&val[i-1]>val[i-2]);
   const priceBreak=ready&&(isLong?close[i]<Math.min(...low.slice(i-options.structureBars,i)):close[i]>Math.max(...high.slice(i-options.structureBars,i)));
   const recovered=ready&&(isLong?val[i]>0&&val[i]>val[i-1]&&val[i-1]>val[i-2]&&rsi[i]>50&&close[i]>close[i-1]:val[i]<0&&val[i]<val[i-1]&&val[i-1]<val[i-2]&&rsi[i]<50&&close[i]<close[i-1]);
   const marks=recentMarkers(markers[opposite],i,options.marksWindow);
   const divergence=i-lastDiv<=options.evidenceWindow,rsiWarning=i-lastRsi<=options.evidenceWindow;
   results[side].push({...classifyWeakness({side,momentum,rsiWarning,divergence,priceBreak,marks,marksWindow:options.marksWindow,marksMinimum:options.marksMinimum}),idx:i,recovered,price:close[i],rsi:rsi[i],
    divergenceAge:divergence?i-lastDiv:undefined,pivots:divergence?lastDetails:[],rsiAge:rsiWarning?i-lastRsi:undefined});
  }
 }
 return results;
}
// Sin avisos repetidos por vela. Una escalada 1→2 pasa inmediatamente.
// Dos cierres con recuperación del impulso rearman el episodio. El llamador persiste tras enviar.
export function transitionMonitor(previous,current) {
 const level=previous.level??0,clear=previous.clear??0;
 if(current.level===0){const nextClear=current.recovered?Math.min(MONITOR.recoveryBars,clear+1):0;return {notify:false,next:{level:nextClear>=MONITOR.recoveryBars?0:level,clear:nextClear}};}
 return {notify:current.level>level,next:{level:Math.max(level,current.level),clear:0}};
}
