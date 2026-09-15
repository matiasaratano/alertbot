import fs from 'node:fs';
import {fetchTwelveDataSeries} from './data-sources.mjs';
import {buildConfluence, rsiPriceDivergences} from './confluence.mjs';
import {buildSetups} from './setups.mjs';
import {buildEarly} from './early.mjs';
import {rsiWilder} from './indicators.mjs';
import {INDICATOR,HISTORY} from './config.mjs';
const symbol=process.argv[2] ?? 'NVDA';
if (!/^[A-Z]{1,10}$/.test(symbol)) throw Error('Símbolo inválido');
if (!process.env.TWELVEDATA_API_KEY) throw Error('Falta TWELVEDATA_API_KEY; ejecutar el workflow Diagnóstico de señales');
const candles=await fetchTwelveDataSeries(symbol,'1d',process.env.TWELVEDATA_API_KEY,HISTORY);
const rsi=rsiWilder(candles.close,INDICATOR.rsiLen);
const describe=e=>({...e,date:new Date(candles.closeTime[e.idx]).toISOString(),
  pivots:e.pivots.map(p=>({...p,previous:new Date(candles.openTime[p.prevIdx]).toISOString(),
    extreme:new Date(candles.openTime[p.pivotIdx]).toISOString(),
    previousHigh:candles.high[p.prevIdx],high:candles.high[p.pivotIdx],
    previousLow:candles.low[p.prevIdx],low:candles.low[p.pivotIdx],
    previousRsi:rsi[p.prevIdx],rsi:rsi[p.pivotIdx]}))});
const output={symbol,source:'Twelve Data: regular, adjust=splits',parameters:INDICATOR,
 generatedAt:new Date().toISOString(),
 events:buildConfluence(candles,INDICATOR).slice(-30).map(describe),
 opportunities:buildSetups(candles,INDICATOR).slice(-30).map(describe),
 early:buildEarly(candles,INDICATOR).slice(-20).map(describe),
 priceDivergences:rsiPriceDivergences(candles.high,candles.low,rsi,INDICATOR),candles};
fs.writeFileSync('signal-diagnostic.json',JSON.stringify(output,null,2));
console.log('Guardado signal-diagnostic.json. No se enviaron mensajes ni se modificó state.json.');
