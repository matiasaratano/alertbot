import test from 'node:test';
import assert from 'node:assert/strict';
import {earlyTurns,buildEarly} from './early.mjs';
import {INDICATOR,EARLY_TIMEFRAMES} from './config.mjs';
import {processEvents,deliverEvents,composeMessage} from './scan.mjs';
const val=[1,2,10,2,1,2,3,5,4,6,3,2];
const high=val.map(()=>90);high[2]=100;high[7]=110;high[9]=115;
const low=high.map(x=>x-5);
const p={...INDICATOR,pivotLen:2,divRangeMin:3};
test('first closed turn, same-sign momentum, and one warning per reference',()=>{
 assert.deepEqual(earlyTurns(val,high,low,p),[{idx:7,prevIdx:2,confirmedIdx:8,side:'bear'}]);
 assert.deepEqual(earlyTurns(val.slice(0,8),high.slice(0,8),low.slice(0,8),p),[]);
 const inverse=earlyTurns(val.map(x=>-x),low.map(x=>-x),high.map(x=>-x),p);
 assert.deepEqual(inverse,[{idx:7,prevIdx:2,confirmedIdx:8,side:'bull'}]);
 assert.equal(earlyTurns(val.map(x=>x-7),high,low,p).length,0);
});
test('early decisions do not depend on future candles',()=>{
 const all=earlyTurns(val,high,low,p);
 for(let n=4;n<=val.length;n++)assert.deepEqual(earlyTurns(val.slice(0,n),high.slice(0,n),low.slice(0,n),p),all.filter(e=>e.confirmedIdx<n));
 const close=Array.from({length:700},(_,i)=>100+10*Math.sin(i/8)+(i%97)*.05);
 const data={close,high:close.map(x=>x+1),low:close.map(x=>x-1)};
 const full=buildEarly(data,INDICATOR);
 assert.ok(full.length>0);
 for(const n of [250,400,600])assert.deepEqual(buildEarly(Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.slice(0,n)])),INDICATOR),full.filter(e=>e.idx<n));
 assert.deepEqual(EARLY_TIMEFRAMES,['4h','1d']);
});
test('delivery failure does not consume reference; success suppresses later repeat and confirmation',async()=>{
 const t=1800000000000,state={};processEvents(state,'NVDA','1d',[],t-1000);
 const e={kind:'early',side:'bear',signal:'early_bear',confirmedTime:t,cooldownCutoff:t-10000,earlyReferenceTime:t-100000,pivots:[],evidence:[]};
 assert.equal(processEvents(state,'NVDA','1d',[e],t).length,1);
 await assert.rejects(deliverEvents(state,'NVDA','1d',[e],async()=>{throw Error('failed');},()=>{}));
 assert.equal(state['_earlyReference:NVDA:1d:bear'],undefined);
 await deliverEvents(state,'NVDA','1d',[e],async()=>{},()=>{});
 assert.equal(processEvents(state,'NVDA','1d',[{...e,confirmedTime:t+60000,cooldownCutoff:t+1}],t+60000).length,0);
 const confirmation={...e,kind:undefined,earlyReferenceTime:undefined,signal:'important_bear',confirmedTime:t+60000,
 pivots:[{name:'mom_div',prevTime:e.earlyReferenceTime}],evidence:[{name:'mom_div',barsAgo:0}]};
 assert.equal(processEvents(state,'NVDA','1d',[confirmation],t+60000).length,0);
 // Una condición nueva e independiente sí puede producir una confluencia.
 confirmation.evidence.push({name:'rsi_trigger',barsAgo:0});
 assert.equal(processEvents(state,'NVDA','1d',[confirmation],t+60000).length,1);
});
test('early message is tentative and displays both extreme dates',()=>{
 const t=Date.UTC(2026,8,14,20),ev={kind:'early',side:'bear',confluenceSignal:false,evidence:[],price:210.88,ema:198,rsi:43.9,confirmedTime:t,
 pivots:[{name:'mom_div',prevTime:Date.UTC(2026,7,19,13,30),pivotTime:Date.UTC(2026,8,11,13,30)}]};
 const text=composeMessage('NVDA','1d',ev,false,t+600000);
 assert.match(text,/POSIBLE DIVERGENCIA MOMENTUM/);assert.match(text,/no es BUY\/SELL/);
 assert.match(text,/19\/08\/2026/);assert.match(text,/11\/09\/2026/);
 assert.doesNotMatch(text,/pivots se confirman|esta vela/);
});
