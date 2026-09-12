import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { processEvents,deliverEvents,scanMarkets,analyzeSymbol,loadState,saveState,composeMessage } from './scan.mjs';
import { normalizeCandles,fetchKrakenKlines } from './data-sources.mjs';
import { sessionForDate,stockBarTimes,latestStockClose } from './market-calendar.mjs';
import { sendTelegram } from './telegram.mjs';
import { findPivots,crossEvents,rsiWilder,computeSqueezeMomentum,findDivergences } from './indicators.mjs';
const now=Date.parse('2026-09-11T20:02:00Z');
const event=(time,signal='rsi_buy')=>({signal,confirmedTime:time});

test('bootstrap initializes absent types and suppresses historical events',()=>{
 const state={};assert.deepEqual(processEvents(state,'BTCUSD','1h',[event(now-1000)],now),[]);
 assert.equal(Object.keys(state).length,6);
 assert.equal(processEvents(state,'BTCUSD','1h',[event(now+1000,'div_bear')],now+2000).length,1);
});
test('expired and future events suppressed without discarding valid backlog',()=>{
 const state={};processEvents(state,'BTCUSD','1h',[],now-20000000);
 const events=[event(now-10000000),...Array.from({length:5},(_,i)=>event(now-5000+i)),event(now+1)];
 assert.equal(processEvents(state,'BTCUSD','1h',events,now).length,5);
});
test('partial Telegram failure checkpoints successes and retries only unsent event',async()=>{
 const state={};processEvents(state,'BTCUSD','1h',[],now-5000);
 const events=[event(now-3000),event(now-2000)];let persisted=0;
 await assert.rejects(deliverEvents(state,'BTCUSD','1h',events,async ev=>{if(ev===events[1])throw Error('failed');},()=>persisted++));
 assert.equal(persisted,1);assert.deepEqual(processEvents(state,'BTCUSD','1h',events,now),[events[1]]);
});
test('Telegram checks API ok even when HTTP status is 200',async()=>{
 const original=globalThis.fetch;
 try {globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({ok:false,error_code:429})});
 await assert.rejects(sendTelegram('test','test','test'));}finally{globalThis.fetch=original;}
});
test('pivot only appears after right-hand confirmation bars',()=>{
 assert.equal(findPivots([0,1,4,2],2,2).highs.length,0);
 assert.deepEqual(findPivots([0,1,4,2,1],2,2).highs,[{idx:2,value:4}]);
});
test('equal extremes choose the rightmost eligible pivot',()=>{
 assert.deepEqual(findPivots([0,4,4,2,1],2,2).highs,[{idx:2,value:4}]);
 assert.equal(findPivots([0,1,4,4,1],2,2).highs.length,0);
 assert.deepEqual(findPivots([4,0,0,2,3],2,2).lows,[{idx:2,value:0}]);
});
test('crosses match Pine direction and equality boundaries',()=>{
 assert.deepEqual(crossEvents([null,29,30,31,30,29],30).crossover,[false,false,false,true,false,false]);
 assert.deepEqual(crossEvents([71,70,69],70).crossunder,[false,false,true]);
});
test('Wilder RSI matches reference seed and first smoothing step',()=>{
 const closes=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00];
 const rsi=rsiWilder(closes,14);
 assert.ok(Math.abs(rsi[14]-70.46413502109705)<1e-10);
 assert.ok(Math.abs(rsi[15]-66.24961855355505)<1e-10);
});
test('linear price ramp has constant squeeze momentum of 9.5 after warmup',()=>{
 const close=Array.from({length:100},(_,i)=>100+i);
 const {val}=computeSqueezeMomentum(close.map(v=>v+1),close.map(v=>v-1),close);
 assert.equal(val[37],null);assert.equal(val[38],9.5);assert.equal(val.at(-1),9.5);
});
test('divergence uses consecutive pivots and inclusive range, like provided Pine',()=>{
 const highs=Array(70).fill(1);highs[5]=10;highs[10]=11;highs[70-1]=12;
 const result=findDivergences({highs:[{idx:5,value:8},{idx:10,value:6},{idx:69,value:4}],lows:[]},{highPrices:highs,lowPrices:highs},{divRangeMin:5,divRangeMax:60});
 assert.deepEqual(result.bearish,[{idx:10,prevIdx:5},{idx:69,prevIdx:10}]);
});
test('US sessions account for DST, holidays, and early closes',()=>{
 assert.equal(sessionForDate('2026-03-06').open,Date.parse('2026-03-06T14:30:00Z'));
 assert.equal(sessionForDate('2026-03-09').open,Date.parse('2026-03-09T13:30:00Z'));
 assert.equal(sessionForDate('2026-11-26'),null);
 assert.equal(sessionForDate('2026-11-27').close,Date.parse('2026-11-27T18:00:00Z'));
 assert.throws(()=>sessionForDate('2031-01-01'),/cobertura/);
});
test('daily timestamps use session open and close, not UTC midnight plus 24h',()=>{
 assert.deepEqual(stockBarTimes('2026-09-11','1d'),{open:Date.parse('2026-09-11T13:30:00Z'),close:Date.parse('2026-09-11T20:00:00Z')});
});
test('hourly and 4h bars clip to early close; misaligned bars fail explicitly',()=>{
 assert.equal(stockBarTimes('2026-11-27 17:30:00','1h').close,Date.parse('2026-11-27T18:00:00Z'));
 assert.equal(stockBarTimes('2026-11-27 14:30:00','4h').close,Date.parse('2026-11-27T18:00:00Z'));
 assert.throws(()=>stockBarTimes('2026-11-27 14:00:00','1h'));
});
test('scheduler checks after close with publication margin and carries Friday close over weekend',()=>{
 const close=Date.parse('2026-11-27T18:00:00Z');
 assert.ok(latestStockClose('1d',close+30000)<close);
 assert.equal(latestStockClose('1d',close+60000),close);
 assert.equal(latestStockClose('1h',Date.parse('2026-11-28T15:00:00Z')),close);
 assert.equal(latestStockClose('4h',Date.parse('2026-09-11T17:31:00Z')),Date.parse('2026-09-11T17:30:00Z'));
});
test('OHLC validation sorts, drops all unclosed bars and rejects duplicate/invalid rows',()=>{
 const row={open:now-3600000,end:now-120000,high:2,low:1,close:1.5};
 const future={...row,open:now,end:now+3600000};
 assert.deepEqual(normalizeCandles([future,row],now).close,[1.5]);
 assert.throws(()=>normalizeCandles([row,row],now));
 assert.throws(()=>normalizeCandles([{...row,close:NaN}],now));
});
test('Kraken discards last uncommitted row even if local clock says it closed',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>({ok:true,json:async()=>({error:[],result:{PAIR:[[1000,1,2,1,1.5],[4600,1,2,1,1.5]],last:1}})});
  assert.deepEqual((await fetchKrakenKlines('BTCUSD','1h')).openTime,[1000000]);
 }finally{globalThis.fetch=original;}
});
function fixture(lastClose=Date.parse('2026-09-11T20:00:00Z')) {
 const close=Array.from({length:500},(_,i)=>100+10*Math.sin(i/8)+i*.001);
 return {close,high:close.map(v=>v+1),low:close.map(v=>v-1),
  closeTime:close.map((_,i)=>lastClose-(499-i)*3600000),openTime:close.map((_,i)=>lastClose-(500-i)*3600000)};
}
test('signal confirmation timestamp comes from actual candle close, including short bars',()=>{
 const candles=fixture();const events=analyzeSymbol('BTCUSD','1h',candles);
 assert.ok(events.length>0);
 for(const ev of events) assert.equal(ev.confirmedTime,candles.closeTime[ev.confirmedIdx ?? ev.idx]);
 const ev=events.at(-1);candles.closeTime[ev.confirmedIdx ?? ev.idx]-=1800000;
 assert.equal(analyzeSymbol('BTCUSD','1h',candles).find(e=>e.idx===ev.idx && e.signal===ev.signal).confirmedTime,ev.confirmedTime-1800000);
});
test('scanner skips successful close but retries stale provider on next tick',async()=>{
 const state={};let requests=0;
 const options={state,persist:()=>{},send:async()=>{},stockKey:'test',cryptoSymbols:[],stockSymbols:['AAPL'],timeframes:['1d'],clock:()=>now,
 stockFetch:async()=>{requests++;return fixture(Date.parse('2026-09-10T20:00:00Z'));}};
 assert.equal((await scanMarkets(options)).healthy,false);
 assert.equal(state['_checkedClose:AAPL:1d'],undefined);
 options.stockFetch=async()=>{requests++;return fixture();};
 assert.equal((await scanMarkets(options)).healthy,true);
 await scanMarkets(options);assert.equal(requests,2);
});
test('scanner catches one provider error without losing independent symbols',async()=>{
 const state={};const result=await scanMarkets({state,persist:()=>{},send:async()=>{},cryptoSymbols:['BAD','BTCUSD'],stockSymbols:[],timeframes:['1h'],clock:()=>now,
 cryptoFetch:async symbol=>{if(symbol==='BAD')throw Error('offline');return fixture();}});
 assert.equal(result.errors.length,1);assert.equal(result.checked,1);
 assert.equal(state['_checkedClose:BTCUSD:1h'],Date.parse('2026-09-11T20:00:00Z'));
});
test('state corruption fails instead of resetting and atomic writes round-trip',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alertbot-test-'));const file=pathToFileURL(path.join(dir,'state.json'));
 try {assert.deepEqual(loadState(file),{});saveState({key:now},file);assert.deepEqual(loadState(file),{key:now});
 fs.writeFileSync(file,'[]');assert.throws(()=>loadState(file));fs.writeFileSync(file,'broken');assert.throws(()=>loadState(file));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('message identifies exchange, confirmation time and retrospective pivot',()=>{
 const text=composeMessage('BTCUSD','4h',{text:'divergencia',barTime:now-72000000,confirmedTime:now-120000,confirmedIdx:10},true,now);
 assert.match(text,/Kraken/);assert.match(text,/Confirmación/);assert.match(text,/5 velas/);assert.match(text,/KRAKEN%3ABTCUSD/);
});

test('Telegram obeys explicit retry_after and paces group messages',async()=>{
 const {createTelegramSender}=await import('./telegram.mjs');let time=0,calls=0;const sleeps=[];
 const send=createTelegramSender({clock:()=>time,sleep:async ms=>{sleeps.push(ms);time+=ms;},fetchImpl:async()=>{
 calls++;return calls===1?{ok:false,status:429,json:async()=>({ok:false,error_code:429,parameters:{retry_after:4}})}:
 {ok:true,status:200,json:async()=>({ok:true,result:{message_id:calls}})};}});
 await send('test','-123','one');await send('test','-123','two');
 assert.equal(calls,3);assert.deepEqual(sleeps,[4100,3100]);
});
test('ambiguous network timeout is not retried inside Telegram sender',async()=>{
 const {createTelegramSender}=await import('./telegram.mjs');let calls=0;
 const send=createTelegramSender({fetchImpl:async()=>{calls++;throw Error('timeout');}});
 await assert.rejects(send('test','123','one'));assert.equal(calls,1);
});
test('starting outside market hours initializes future signals without requests',async()=>{
 const state={};let requests=0;const weekend=Date.parse('2026-09-12T18:00:00Z');
 await scanMarkets({state,persist:()=>{},send:async()=>{},stockKey:'test',cryptoSymbols:[],stockSymbols:['AAPL'],timeframes:['1d'],clock:()=>weekend,
 stockFetch:async()=>{requests++;return fixture();}});
 assert.equal(requests,0);assert.equal(state['v2:AAPL:1d:div_bear'],weekend);
 const mondayClose=Date.parse('2026-09-14T20:00:00Z');
 assert.equal(processEvents(state,'AAPL','1d',[event(mondayClose,'div_bear')],mondayClose+60000).length,1);
});


test('turn prealert waits for exactly one closed reversal bar',async()=>{
 const {findTurnDivergences}=await import('./indicators.mjs');
 const val=[0,-1,-2,-3,-4,-10,-4,-3,-2,-1,0,4,3,2,1,0,-2,-1];
 const lows=val.map(()=>10);lows[5]=8;lows[16]=7;const highs=lows.map(v=>v+2);
 assert.deepEqual(findTurnDivergences(val.slice(0,-1),highs.slice(0,-1),lows.slice(0,-1)).bullish,[]);
 assert.deepEqual(findTurnDivergences(val,highs,lows).bullish,[{idx:16,prevIdx:5,confirmedIdx:17}]);
 assert.equal(findPivots(val,5,5).lows.some(p=>p.idx===16),false);
});
test('continued decline and flat momentum do not trigger a reversal prealert',async()=>{
 const {findTurnDivergences}=await import('./indicators.mjs');
 for(const next of [-2,-1]) {
  const val=[0,-2,-5,-2,0,1,0,-1,next];const lows=[10,9,8,9,10,11,9,7,6];
  assert.deepEqual(findTurnDivergences(val,lows.map(v=>v+2),lows,{pivotLen:2,divRangeMin:3}).bullish,[]);
 }
});
test('bearish prealert mirrors bullish rule and requires price divergence',async()=>{
 const {findTurnDivergences}=await import('./indicators.mjs');
 const val=[0,2,5,2,0,-1,0,1,0];const highs=[10,11,12,11,10,9,11,13,12];
 const options={pivotLen:2,divRangeMin:3};
 assert.deepEqual(findTurnDivergences(val,highs,highs.map(v=>v-2),options).bearish,[{idx:7,prevIdx:2,confirmedIdx:8}]);
 highs[7]=12;
 assert.deepEqual(findTurnDivergences(val,highs,highs.map(v=>v-2),options).bearish,[]);
});
test('turn prealert does not repeat a candidate and has no future dependence',async()=>{
 const {findTurnDivergences}=await import('./indicators.mjs');
 const val=[0,-2,-5,-2,0,1,0,-1,0,1,2,1];
 const lows=[10,9,8,9,10,11,9,7,8,9,10,9];const highs=lows.map(v=>v+2);
 const p={pivotLen:2,divRangeMin:3,divRangeMax:60};
 const full=findTurnDivergences(val,highs,lows,p).bullish;
 assert.deepEqual(full,[{idx:7,prevIdx:2,confirmedIdx:8}]);
 for(let n=1;n<=val.length;n++) assert.deepEqual(findTurnDivergences(val.slice(0,n),highs.slice(0,n),lows.slice(0,n),p).bullish,full.filter(e=>e.confirmedIdx<n));
});
test('prealert message explicitly distinguishes one-bar turn from five-bar confirmation',()=>{
 const text=composeMessage('BTCUSD','1h',{text:'PRE Bull',barTime:now-7200000,confirmedTime:now-60000,confirmedIdx:50,preliminary:true},true,now);
 assert.match(text,/Giro confirmado \(1 vela\)/);assert.match(text,/Todavía no es/);assert.doesNotMatch(text,/Confirmada 5 velas/);
});
test('Pine paste file uses closed-bar turn rule and grouped close alerts',()=>{
 const source=fs.readFileSync(new URL('./tradingview/alertbot.txt',import.meta.url),'utf8');
 assert.ok(source.startsWith('//@version=6\nindicator('));
 assert.ok(!source.includes('```'));assert.match(source,/earlyBullStart = barstate.isconfirmed/);
 assert.match(source,/val > val\[1\]/);assert.match(source,/alert.freq_once_per_bar_close/);assert.doesNotMatch(source,/alert.freq_all/);
 assert.equal(source,fs.readFileSync(new URL('./tradingview/alertbot.pine',import.meta.url),'utf8'));
});
