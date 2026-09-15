import {rsiWilder,crossEvents,computeSqueezeMomentum,findPivots,findDivergences} from './indicators.mjs';
import {ema,rsiPriceDivergences} from './confluence.mjs';
import {earlyTurns} from './early.mjs';
export const SETUP = {window:3,cooldown:4};
export const SETUP_LABELS={rsi_trigger:'RSI salió de la banda',rsi_div:'Divergencia RSI confirmada',mom_div:'Divergencia momentum confirmada',mom_pre:'Divergencia momentum tentativa'};

// Un setup reciente + dirección actual del momentum + ruptura al cierre
// del extremo de la vela anterior. EMA200 describe contexto; no veta señales.
export function scoreSetups({high,low,close,momentum,trend,bull,bear},p=SETUP) {
 const seen={bull:{},bear:{}},lastSignal={bull:-Infinity,bear:-Infinity},used={bull:-Infinity,bear:-Infinity};
 const out=[];
 for(let i=1;i<close.length;i++)for(const [side,components] of [['bull',bull],['bear',bear]]) {
  for(const name of Object.keys(SETUP_LABELS))if(components[name][i])seen[side][name]=i;
  const evidence=Object.entries(seen[side]).filter(([,idx])=>i-idx<=p.window)
   .map(([name,idx])=>({name,idx,barsAgo:i-idx,label:SETUP_LABELS[name]}));
  const newest=Math.max(-Infinity,...evidence.map(e=>e.idx));
  const turning=side==='bull'?momentum[i]>momentum[i-1]:momentum[i]<momentum[i-1];
  const priceBreak=side==='bull'?close[i]>high[i-1]:close[i]<low[i-1];
  if(!turning||!priceBreak||newest<=used[side]||i-lastSignal[side]<=p.cooldown)continue;
  used[side]=newest;lastSignal[side]=i;
  out.push({idx:i,side,kind:'setup',confluenceSignal:true,evidence,
   freshDivergences:evidence.filter(e=>e.barsAgo===0&&e.name.endsWith('_div')).map(e=>e.name),
   trendOk:side==='bull'?close[i]>trend[i]:close[i]<trend[i],price:close[i],ema:trend[i]});
 }
 return out;
}
export function buildSetups(candles,p,options=SETUP) {
 const {high,low,close}=candles,n=close.length;
 const rsi=rsiWilder(close,p.rsiLen),{val}=computeSqueezeMomentum(high,low,close,p.sqz);
 const empty=()=>Object.fromEntries(Object.keys(SETUP_LABELS).map(k=>[k,Array(n).fill(false)]));
 const bull=empty(),bear=empty();
 bull.rsi_trigger=crossEvents(rsi,p.buyLevel).crossover;bear.rsi_trigger=crossEvents(rsi,p.sellLevel).crossunder;
 const details={bull:new Map(),bear:new Map()};
 const add=(side,name,idx,pivotIdx,prevIdx)=>{
  (side==='bull'?bull:bear)[name][idx]=true;
  const list=details[side].get(idx)??[];list.push({name,pivotIdx,prevIdx,tentative:name==='mom_pre'});details[side].set(idx,list);
 };
 for(const [name,divs] of [['mom_div',findDivergences(findPivots(val,p.pivotLen,p.pivotLen),{highPrices:high,lowPrices:low},p)],['rsi_div',rsiPriceDivergences(high,low,rsi,p)]])
  for(const [key,side] of [['bullish','bull'],['bearish','bear']])for(const d of divs[key])add(side,name,d.idx+p.pivotLen,d.idx,d.prevIdx);
 for(const d of earlyTurns(val,high,low,p))add(d.side,'mom_pre',d.confirmedIdx,d.idx,d.prevIdx);
 return scoreSetups({high,low,close,momentum:val,trend:ema(close,p.emaLength),bull,bear},options).map(e=>({...e,
  rsi:rsi[e.idx],pivots:e.evidence.flatMap(c=>(details[e.side].get(c.idx)??[]).filter(d=>d.name===c.name))}));
}
export function selectSetups(events,tf) {
 // La confluencia v8 ya exige precio, momentum y un setup. Eliminar el
 // veto adicional de divergencia en 1h para no ocultar los setups RSI.
 return events;
}
