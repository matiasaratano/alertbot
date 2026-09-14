import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildConfluence, scoreConfluence, selectImportant, rsiPriceDivergences, ema, COMPONENT_LABELS } from './confluence.mjs';
import { analyzeSymbol, composeMessage, processEvents, deliverEvents } from './scan.mjs';
import { INDICATOR, ALERT_POLICY } from './config.mjs';
import { heartbeatStatus } from './watchdog.mjs';
function setup(n=30) {
 const empty=()=>Object.fromEntries(Object.keys(COMPONENT_LABELS).map(k=>[k,Array(n).fill(false)]));
 return {close:Array(n).fill(100),trend:Array(n).fill(90),bull:empty(),bear:empty()};
}
test('confluence requires a fresh event and uses inclusive eight-bar window',()=>{
 const data=setup();data.bull.rsi_trigger[0]=true;data.bull.sqz_event[8]=true;data.bull.sqz_event[10]=true;
 const events=scoreConfluence(data,INDICATOR).filter(e=>e.confluenceSignal);
 assert.deepEqual(events.map(e=>e.idx),[8]);assert.equal(events[0].score,2);
 assert.equal(events[0].evidence.find(c=>c.name==='rsi_trigger').barsAgo,8);
});
test('confluence cooldown is strictly greater than eight, matching Pine',()=>{
 const data=setup();for(const i of [0,8,9]){data.bull.rsi_trigger[i]=true;data.bull.sqz_event[i]=true;}
 assert.deepEqual(scoreConfluence(data,INDICATOR).filter(e=>e.confluenceSignal).map(e=>e.idx),[0,9]);
});
test('EMA filter blocks wrong side and equality; bearish rule is symmetric',()=>{
 const data=setup();data.bear.rsi_trigger[0]=true;data.bear.sqz_event[0]=true;
 assert.equal(scoreConfluence(data,INDICATOR).length,0);
 data.trend.fill(100);assert.equal(scoreConfluence(data,INDICATOR).length,0);
 data.trend.fill(110);assert.equal(scoreConfluence(data,INDICATOR)[0].side,'bear');
});
test('RSI divergence is anchored on price pivots, only appears after confirmation',()=>{
 const low=[5,3,5,4,2,4],high=low.map(v=>v+5),rsi=[50,20,50,50,30,50];
 const p={...INDICATOR,pivotLen:1,divRangeMin:2};
 assert.deepEqual(rsiPriceDivergences(high,low,rsi,p).bullish,[{idx:4,prevIdx:1,confirmedIdx:5}]);
 assert.deepEqual(rsiPriceDivergences(high.slice(0,-1),low.slice(0,-1),rsi.slice(0,-1),p).bullish,[]);
});
test('RSI and momentum divergence count independently and are grouped per bar',()=>{
 const data=setup();data.bull.rsi_div[5]=true;data.bull.mom_div[5]=true;
 const events=scoreConfluence(data,INDICATOR);
 assert.equal(events.length,1);assert.equal(events[0].score,2);assert.equal(events[0].freshDivergences.length,2);
});
test('Telegram policy omits isolated triggers and restricts 1h more than 4h',()=>{
 const data=setup();data.bull.rsi_trigger[3]=true;data.bull.sqz_event[3]=true;
 const twoNoDiv=scoreConfluence(data,INDICATOR);
 assert.equal(selectImportant(twoNoDiv,'1h',ALERT_POLICY).length,0);
 assert.equal(selectImportant(twoNoDiv,'4h',ALERT_POLICY).length,0);
 assert.equal(selectImportant(twoNoDiv,'1d',ALERT_POLICY).length,1);
 data.bull.rsi_div[3]=true;
 assert.equal(selectImportant(scoreConfluence(data,INDICATOR),'1h',ALERT_POLICY).length,1);
});
test('daily standalone divergences are silent and diagnostic messages explicitly exclude BUY/SELL',()=>{
 const data=setup();data.trend.fill(110);data.bull.mom_div[5]=true;
 assert.equal(selectImportant(scoreConfluence(data,INDICATOR),'1d',ALERT_POLICY).length,0);
 const daily=scoreConfluence(data,INDICATOR);
 assert.equal(daily.length,1);assert.equal(daily[0].confluenceSignal,false);
 assert.equal(selectImportant(daily,'4h',ALERT_POLICY).length,0);
 const text=composeMessage('BTCUSD','1d',{...daily[0],rsi:38,confirmedTime:Date.now()},true);
 assert.match(text,/contra la tendencia/);assert.match(text,/Divergencia confirmada de marco diario/);
});
test('notification cooldown uses candle timestamps, groups backlog, and persists only successes',async()=>{
 const t=1800000000000,state={};processEvents(state,'BTCUSD','1h',[],t-100000);
 const e=(offset,cutoff,signal='important_bull')=>({signal,confirmedTime:t+offset,cooldownCutoff:cutoff});
 const first=e(0,t-28800000),second=e(60000,t-28740000),opposite=e(60000,t-28740000,'important_bear');
 const accepted=processEvents(state,'BTCUSD','1h',[first,second,opposite],t+120000);
 assert.deepEqual(accepted,[first,opposite]);
 await assert.rejects(deliverEvents(state,'BTCUSD','1h',accepted,async ev=>{if(ev===opposite)throw Error('failed');},()=>{}));
 assert.equal(state['_lastImportant:BTCUSD:1h:important_bull'],t);
 assert.equal(state['_lastImportant:BTCUSD:1h:important_bear'],undefined);
 assert.deepEqual(processEvents(state,'BTCUSD','1h',[second,opposite],t+120000),[opposite]);
 // La barra 8 aún se silencia; la 9 queda fuera del intervalo.
 assert.equal(processEvents(state,'BTCUSD','1h',[e(28800000,t)],t+28800001).length,0);
 assert.equal(processEvents(state,'BTCUSD','1h',[e(32400000,t+3600000)],t+32400001).length,1);
});
function fixture(n=700) {
 const close=Array.from({length:n},(_,i)=>100+10*Math.sin(i/8)+(i%97)*.05);
 return {close,high:close.map((v,i)=>v+1+(i%17)*.2),low:close.map((v,i)=>v-1-(i%13)*.2),
 openTime:close.map((_,i)=>1700000000000+i*86400000),closeTime:close.map((_,i)=>1700000000000+(i+1)*86400000)};
}
test('pipeline emits important events with actual close timestamps and no individual messages',()=>{
 const candles=fixture(),events=analyzeSymbol('BTCUSD','1d',candles);
 assert.ok(events.length>0);
 for(const e of events){assert.match(e.signal,/^(important|early)_/);assert.equal(e.confirmedTime,candles.closeTime[e.idx]);}
 const ev=events.at(-1);candles.closeTime[ev.idx]-=1800000;
 assert.equal(analyzeSymbol('BTCUSD','1d',candles).find(e=>e.idx===ev.idx&&e.side===ev.side).confirmedTime,ev.confirmedTime-1800000);
});
test('message describes evidence age and source without inventing a probability',()=>{
 const ev={...buildConfluence(fixture(),INDICATOR).find(e=>e.confluenceSignal),rsi:42,confirmedTime:1800000000000};
 const text=composeMessage('BTCUSD','4h',ev,true,1800000600000);
 assert.match(text,/condiciones recientes/);assert.match(text,/KRAKEN%3ABTCUSD/);assert.match(text,/10 min/);assert.doesNotMatch(text.split('https://')[0],/%/);
});
test('confluence decisions are unchanged by future bars',()=>{
 const full=fixture(),all=buildConfluence(full,INDICATOR);
 for(const n of [250,333,501,650]){
 const part=Object.fromEntries(Object.entries(full).map(([k,v])=>[k,v.slice(0,n)]));
 assert.deepEqual(buildConfluence(part,INDICATOR),all.filter(e=>e.idx<n));
 }
});
test('EMA200 seeds from first value and is recursive',()=>{
 assert.deepEqual(ema([100,201],200),[100,100+202/201]);
});
test('watchdog has no Telegram delivery path and no scheduled workflow',()=>{
 assert.equal(heartbeatStatus(null).healthy,false);
 assert.equal(heartbeatStatus({lastRun:new Date().toISOString(),healthy:true}).healthy,true);
 const code=fs.readFileSync(new URL('./watchdog.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/sendTelegram|TELEGRAM_TOKEN/);
 const workflow=fs.readFileSync(new URL('./.github/workflows/watchdog.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/schedule:|cron:/);
});
test('updated Pine has synchronized copies, keeps original separately and enables early views',()=>{
 const pine=fs.readFileSync(new URL('./tradingview/alertbot.pine',import.meta.url),'utf8');
 assert.equal(fs.readFileSync(new URL('./tradingview/alertbot.txt',import.meta.url),'utf8'),pine);
 assert.ok(pine.startsWith('//@version=6\n'));
 assert.match(pine,/EN FORMACIÓN/);
 assert.match(pine,/float earlyHigh = lastMomHigh/);
 assert.notEqual(pine,fs.readFileSync(new URL('./tradingview/selected-confluence.pine',import.meta.url),'utf8'));
});
