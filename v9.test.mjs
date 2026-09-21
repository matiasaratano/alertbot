import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRsiSignals,pendingRsiEvents,deliverRsiEvents} from './rsi-signals.mjs';
import {analyzeSymbol,scanMarkets,composeMessage} from './scan.mjs';
import {aggregateCryptoWeeks,fetchTwelveDataSeries} from './data-sources.mjs';
import {latestCryptoClose,latestStockClose,stockBarTimes,stockWeekTimes} from './market-calendar.mjs';
import {applyWatchCommand,listWatches} from './watchlist.mjs';
import {INDICATOR,TF_MS,TIMEFRAMES} from './config.mjs';
const time=Date.parse('2026-09-19T16:02:00Z'),end=time-120000;
function fixture(tf='4h',bear=false){
 const close=Array.from({length:50},(_,i)=>100-i*.5);close[49]=close[48]+8;
 const prices=bear?close.map(x=>200-x):close;
 return {close:prices,high:prices.map(x=>x+1000),low:prices.map(x=>x-1000),openTime:prices.map((_,i)=>end-(50-i)*TF_MS[tf]),closeTime:prices.map((_,i)=>end-(49-i)*TF_MS[tf])};
}
test('v9 BUY/SELL follow only closed RSI crossings, even against EMA and without price breakout',()=>{
 for(const bear of [false,true]){
  const c=fixture('4h',bear),events=analyzeSymbol('BTCUSD','4h',c),last=events.at(-1);
  assert.equal(last.idx,49);assert.equal(last.signal,bear?'rsi_sell':'rsi_buy');assert.equal(last.confirmedTime,end);
  assert.ok(bear?last.price>last.ema:last.price<last.ema);
  assert.equal(last.kind,'rsi');assert.deepEqual(last.pivots,[]);
  const text=composeMessage('BTCUSD','4h',last,true,time);assert.match(text,bear?/SELL · RSI/:/BUY · RSI/);assert.doesNotMatch(text,/CONFLUENCIA|POSIBLE LONG|DIVERGENCIA/);
 }
});
test('v9 never sends momentum PRE or repeated above-band levels, and remains causal',()=>{
 const c=fixture();const events=buildRsiSignals(c);assert.equal(events.length,1);
 const extended={...c,close:[...c.close,c.close.at(-1)+1],high:[...c.high,2000],low:[...c.low,-2000],openTime:[...c.openTime,end],closeTime:[...c.closeTime,end+14400000]};
 assert.deepEqual(buildRsiSignals(extended),events);
 assert.deepEqual(buildRsiSignals(Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v.slice(0,49)]))),[]);
});
test('v9 recovery is isolated from old confluence state, without cooldown; retries only unsent crossings',async()=>{
 const state={'v2:BTCUSD:4h:rsi_buy':time,'_lastImportant:BTCUSD:4h:setup_bull':time};
 const events=[{signal:'rsi_buy',confirmedTime:time-3600000},{signal:'rsi_buy',confirmedTime:time-1000}];
 assert.deepEqual(pendingRsiEvents(state,'BTCUSD','4h',events,time),events);
 await assert.rejects(deliverRsiEvents(state,'BTCUSD','4h',events,async e=>{if(e===events[1])throw Error('offline');},()=>{}));
 assert.deepEqual(pendingRsiEvents(state,'BTCUSD','4h',events,time),[events[1]]);
 await deliverRsiEvents(state,'BTCUSD','4h',[events[1]],async()=>{},()=>{});
 assert.deepEqual(pendingRsiEvents(state,'BTCUSD','4h',events,time),[]);
 assert.deepEqual(pendingRsiEvents({},'BTCUSD','4h',[{signal:'rsi_buy',confirmedTime:time-14400001},{signal:'rsi_buy',confirmedTime:time+1}],time),[]);
});
test('hourly legacy watches are inactive, new hourly watches rejected, weekly accepted',()=>{
 assert.deepEqual(TIMEFRAMES,['4h','1d','1w']);
 const s={'_watch:BTCUSD:1h:side':1};assert.deepEqual(listWatches(s),[]);
 assert.match(applyWatchCommand(s,'/seguir BTCUSD 1h long'),/no disponible/);
 applyWatchCommand(s,'/dejar BTCUSD 1h');assert.deepEqual(s,{});
 applyWatchCommand(s,'/seguir BTCUSD 1w long');assert.equal(listWatches(s)[0].tf,'1w');
});
test('scanner disables 1h targets and still sends v9 BUY for a watched 4h pair',async()=>{
 const state={};applyWatchCommand(state,'/seguir BTCUSD 4h long',time-14400000);
 const calls=[],messages=[];
 const result=await scanMarkets({state,clock:()=>time,persist:()=>{},cryptoSymbols:['BTCUSD'],stockSymbols:[],timeframes:['1h','4h'],extraTargets:[{symbol:'ETHUSD',tf:'1h'}],cryptoFetch:async(s,tf)=>{calls.push(tf);return fixture();},send:async m=>messages.push(m)});
 assert.deepEqual(calls,['4h']);assert.equal(result.healthy,true);assert.ok(messages.some(m=>m.startsWith('BUY · RSI')));
 await scanMarkets({state,clock:()=>time,persist:()=>{},cryptoSymbols:['BTCUSD'],stockSymbols:[],timeframes:['4h'],cryptoFetch:async()=>{assert.fail('already processed');},send:async()=>{assert.fail('duplicate');}});
});
function days(start,count){const open=Date.parse(start);return {openTime:Array.from({length:count},(_,i)=>open+i*86400000),closeTime:Array.from({length:count},(_,i)=>open+(i+1)*86400000),high:Array.from({length:count},(_,i)=>100+i),low:Array.from({length:count},(_,i)=>50+i),close:Array.from({length:count},(_,i)=>70+i)};}
test('crypto weekly aggregation is Monday UTC, excludes partial first/current weeks and uses Sunday close',()=>{
 const c=days('2026-08-27T00:00:00Z',25),now=Date.parse('2026-09-19T12:00:00Z');
 const w=aggregateCryptoWeeks(c,now);assert.equal(w.close.length,2);
 assert.equal(new Date(w.openTime[0]).toISOString(),'2026-08-31T00:00:00.000Z');assert.equal(w.close[0],80);
 assert.equal(w.high[0],110);assert.equal(w.low[0],54);
 assert.equal(w.closeTime.at(-1),Date.parse('2026-09-14T00:00:00Z'));
 const missing=Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v.filter((_,i)=>i!==13)]));assert.throws(()=>aggregateCryptoWeeks(missing,now),/incompleta/);
});
test('weekly crypto target waits for Monday close and publication margin',()=>{
 const monday=Date.parse('2026-09-21T00:00:00Z');
 assert.equal(latestCryptoClose('1w',monday+30000),monday-604800000);
 assert.equal(latestCryptoClose('1w',monday+60000),monday);
});
test('stock weekly boundaries respect holidays, early closes and DST',()=>{
 assert.deepEqual(stockWeekTimes('2026-09-07'),{open:Date.parse('2026-09-08T13:30:00Z'),close:Date.parse('2026-09-11T20:00:00Z')});
 assert.equal(stockBarTimes('2026-03-30','1w').close,Date.parse('2026-04-02T20:00:00Z'));
 assert.equal(stockBarTimes('2026-11-23','1w').close,Date.parse('2026-11-27T18:00:00Z'));
 assert.equal(latestStockClose('1w',Date.parse('2026-11-27T18:00:30Z')),Date.parse('2026-11-20T21:00:00Z'));
 assert.equal(latestStockClose('1w',Date.parse('2026-11-27T18:01:00Z')),Date.parse('2026-11-27T18:00:00Z'));
});
test('weekly stock provider requests 1week within calendar coverage and excludes open week',async()=>{
 const oldFetch=globalThis.fetch,oldNow=Date.now;
 try{
  Date.now=()=>Date.parse('2026-09-17T12:00:00Z');
  globalThis.fetch=async url=>{assert.equal(url.searchParams.get('interval'),'1week');assert.equal(url.searchParams.get('start_date'),'2020-01-06');return {ok:true,json:async()=>({values:[{datetime:'2026-09-07',high:'110',low:'90',close:'100'},{datetime:'2026-09-14',high:'120',low:'90',close:'110'}]})};};
  const c=await fetchTwelveDataSeries('AAPL','1w','fake-test-key');assert.equal(c.close.length,1);assert.equal(c.closeTime[0],Date.parse('2026-09-11T20:00:00Z'));
 }finally{globalThis.fetch=oldFetch;Date.now=oldNow;}
});

test('weekly scanner sends at actual weekly close and links W for crypto and stocks',async()=>{
 for(const isCrypto of [true,false]){
  const target=Date.parse(isCrypto?'2026-09-21T00:00:00Z':'2026-09-18T20:00:00Z');
  const c=fixture('1w');c.closeTime=c.closeTime.map((_,i)=>target-(49-i)*604800000);c.openTime=c.closeTime.map(t=>t-604800000);
  const messages=[];const symbol=isCrypto?'BTCUSD':'AAPL';
  const result=await scanMarkets({state:{},clock:()=>target+120000,persist:()=>{},cryptoSymbols:isCrypto?[symbol]:[],stockSymbols:isCrypto?[]:[symbol],stockKey:'test',timeframes:['1w'],cryptoFetch:async()=>c,stockFetch:async()=>c,send:async m=>messages.push(m)});
  assert.equal(result.healthy,true);assert.equal(result.alertsSent,1);assert.match(messages[0],/BUY · RSI/);assert.match(messages[0],/interval=W/);
 }
});


test('MELI afternoon close renders unambiguous 24-hour ART time',()=>{
 const e={kind:'rsi',side:'bull',signal:'rsi_buy',previousRsi:29.77807813,rsi:40.2813462,level:30,price:1826.48,confirmedTime:Date.parse('2026-09-21T17:30:00Z')};
 const text=composeMessage('MELI','4h',e,false,Date.parse('2026-09-21T17:58:00Z'));
 assert.match(text,/14:30:00/);assert.doesNotMatch(text,/02:30:00/);assert.match(text,/28 min/);
});
