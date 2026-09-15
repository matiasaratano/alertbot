import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreSetups,buildSetups,selectSetups,SETUP_LABELS,SETUP} from './setups.mjs';
import {INDICATOR} from './config.mjs';
import {analyzeSymbol,processEvents,deliverEvents,composeMessage} from './scan.mjs';
function fixture(n=15){const empty=()=>Object.fromEntries(Object.keys(SETUP_LABELS).map(k=>[k,Array(n).fill(false)]));return {close:Array(n).fill(100),high:Array(n).fill(101),low:Array(n).fill(99),momentum:Array(n).fill(0),trend:Array(n).fill(90),bull:empty(),bear:empty()};}
test('SELL can signal above EMA200, only with setup, falling momentum and price break',()=>{
 const d=fixture();d.bear.rsi_trigger[3]=true;d.close[3]=98;d.momentum[3]=-1;
 const events=scoreSetups(d);assert.equal(events.length,1);assert.equal(events[0].side,'bear');assert.equal(events[0].trendOk,false);
 d.close[3]=99;assert.equal(scoreSetups(d).length,0);
 d.close[3]=98;d.momentum[3]=0;assert.equal(scoreSetups(d).length,0);
 d.momentum[3]=-1;d.bear.rsi_trigger[3]=false;assert.equal(scoreSetups(d).length,0);
});
test('setup expires after three bars; pivot and turn alone are not BUY/SELL',()=>{
 const d=fixture();d.bull.mom_pre[2]=true;d.close[5]=102;d.momentum[5]=1;
 assert.deepEqual(scoreSetups(d).map(e=>e.idx),[5]);
 d.close[5]=100;d.momentum[5]=0;d.close[6]=102;d.momentum[6]=1;
 assert.deepEqual(scoreSetups(d),[]);
});
test('BUY mirrors SELL, consumes setup and applies cooldown without blocking opposite direction',()=>{
 const d=fixture();d.bull.rsi_trigger[2]=true;
 for(const i of [2,3,4,7]){d.close[i]=102;d.momentum[i]=i;}
 d.bull.rsi_div[4]=true;d.bull.rsi_trigger[7]=true;
 d.bear.rsi_trigger[5]=true;d.close[5]=98;d.momentum[5]=-1;
 assert.deepEqual(scoreSetups(d).map(e=>[e.idx,e.side]),[[2,'bull'],[5,'bear'],[7,'bull']]);
});
test('setup pipeline is causal, dates align, 1h Telegram remains selective',()=>{
 const close=Array.from({length:700},(_,i)=>100+10*Math.sin(i/8)+(i%97)*.05);
 const d={close,high:close.map(x=>x+1),low:close.map(x=>x-1),openTime:close.map((_,i)=>1700000000000+i*14400000),closeTime:close.map((_,i)=>1700000000000+(i+1)*14400000)};
 const full=buildSetups(d,INDICATOR);assert.ok(full.length>0);
 for(const n of [250,400,600])assert.deepEqual(buildSetups(Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v.slice(0,n)])),INDICATOR),full.filter(e=>e.idx<n));
 for(const e of analyzeSymbol('BTCUSD','4h',d))assert.equal(e.confirmedTime,d.closeTime[e.idx]);
 assert.deepEqual(selectSetups(full,'1h'),full);
});
test('setup after prealert is useful new evidence and is persisted only after success',async()=>{
 const t=1800000000000,state={};processEvents(state,'NVDA','4h',[],t-1000);
 const e={kind:'setup',side:'bear',signal:'setup_bear',confirmedTime:t,cooldownCutoff:t-100,earlyReferenceTime:t-10000,pivots:[],evidence:[]};
 state['_earlyReference:NVDA:4h:bear']=t-10000;
 assert.equal(processEvents(state,'NVDA','4h',[e],t).length,1);
 await assert.rejects(deliverEvents(state,'NVDA','4h',[e],async()=>{throw Error('offline')},()=>{}));
 assert.equal(state['v2:NVDA:4h:setup_bear'],t-1000);
 await deliverEvents(state,'NVDA','4h',[e],async()=>{},()=>{});
 assert.equal(state['v2:NVDA:4h:setup_bear'],t);
 assert.equal(processEvents(state,'NVDA','4h',[e],t).length,0);
});
test('opportunity message explains current price evidence and countertrend context',()=>{
 const d=fixture();d.bear.rsi_trigger[3]=true;d.close[3]=98;d.momentum[3]=-1;
 const e={...scoreSetups(d)[0],rsi:65,pivots:[],confirmedTime:1800000000000};
 const message=composeMessage('NVDA','4h',e,false,e.confirmedTime);
 assert.match(message,/POSIBLE SHORT · REVISAR/);assert.match(message,/Contra EMA200/);assert.match(message,/ruptura de precio/);assert.doesNotMatch(message,/undefined|NaN|\/4/);
});
