import fs from 'node:fs';
import { fetchKrakenKlines } from './data-sources.mjs';
import { buildConfluence } from './confluence.mjs';
import { analyzeSymbol } from './scan.mjs';
import { INDICATOR } from './config.mjs';
import { rsiWilder, crossEvents, computeSqueezeMomentum, findTurnDivergences } from './indicators.mjs';
const result=[];
for(const tf of ['1h','4h','1d']) {
 const candles=await fetchKrakenKlines('BTCUSD',tf,700);
 const rsi=rsiWilder(candles.close,14),buy=crossEvents(rsi,30).crossover,sell=crossEvents(rsi,70).crossunder;
 const {val}=computeSqueezeMomentum(candles.high,candles.low,candles.close);
 const pre=findTurnDivergences(val,candles.high,candles.low);
 const before=buy.filter((v,i)=>i>=249&&v).length+sell.filter((v,i)=>i>=249&&v).length+[...pre.bullish,...pre.bearish].filter(e=>e.confirmedIdx>=249).length;
 const candidates=analyzeSymbol('BTCUSD',tf,candles);
 const sent=[],last={};for(const e of candidates){if((last[e.side]??-Infinity)>=e.cooldownCutoff)continue;sent.push(e);last[e.side]=e.confirmedTime;}
 result.push({tf,from:new Date(candles.closeTime[249]).toISOString(),to:new Date(candles.closeTime.at(-1)).toISOString(),oldIndividualAlerts:before,pineConfluences:buildConfluence(candles,INDICATOR).filter(e=>e.idx>=249&&e.confluenceSignal).length,priorityBeforeNotificationCooldown:candidates.length,priorityMessages:sent.length});
}
fs.writeFileSync(new URL('./priority-audit.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
