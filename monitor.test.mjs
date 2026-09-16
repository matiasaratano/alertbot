import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyWeakness,transitionMonitor,buildWeakness,smallMarkers,recentMarkers} from './monitor.mjs';
import {applyWatchCommand,listWatches,processCommands,fetchTelegramUpdates,watchPrefix} from './watchlist.mjs';
import {processWatch} from './watch-runner.mjs';
import {scanMarkets} from './scan.mjs';
const t=1800000000000;
const event=level=>({side:'long',level,recovered:level===0,evidence:['Prueba'],price:100,rsi:50,pivots:[]});
const candles=(n=10)=>({closeTime:Array.from({length:n},(_,i)=>t+i*900000),openTime:Array.from({length:n},(_,i)=>t+(i-1)*900000)});
test('weakness groups momentum readings; requires RSI/divergence or price evidence',()=>{
 assert.equal(classifyWeakness({momentum:true}).level,0);
 assert.equal(classifyWeakness({rsiWarning:true}).level,0);
 assert.equal(classifyWeakness({priceBreak:true}).level,0);
 assert.equal(classifyWeakness({momentum:true,rsiWarning:true}).level,1);
 assert.equal(classifyWeakness({divergence:true}).level,1);
 assert.equal(classifyWeakness({momentum:true,priceBreak:true}).level,2);
});
test('episode warns once, escalates immediately, rearms only after two recovered closes',()=>{
 let s={level:0,clear:0};const flags=[];
 for(const level of [1,1,2,2,0,1,0,0,1]){const x=transitionMonitor(s,{level,recovered:level===0});flags.push(x.notify);s=x.next;}
 assert.deepEqual(flags,[true,false,true,false,false,false,false,false,true]);
});
test('watch commands validate universe, side, arity, are idempotent and remove all watch state',()=>{
 const s={};applyWatchCommand(s,'/seguir BTCUSD 15m long',t);assert.equal(listWatches(s).length,1);
 applyWatchCommand(s,'/seguir BTCUSD 15m long',t+100);assert.equal(s['_watch:BTCUSD:15m:started'],t);
 applyWatchCommand(s,'/seguir BTCUSD 15m short',t+200);assert.equal(listWatches(s)[0].side,'short');
 const before={...s};applyWatchCommand(s,'/seguir BAD 5m long',t);assert.deepEqual(s,before);
 assert.match(applyWatchCommand(s,'/posiciones',t),/SHORT/);
 applyWatchCommand(s,'/dejar BTCUSD 15m',t);assert.deepEqual(s,{});
});
test('commands accept only configured private owner or explicit group user; offset survives replay',async()=>{
 const state={},replies=[];
 const update=(id,chat=7,from=7,type='private')=>({update_id:id,message:{chat:{id:chat,type},from:{id:from},date:t/1000,text:'/seguir BTCUSD 15m long'}});
 const run=updates=>processCommands({state,updates,chatId:'7',persist:()=>{},reply:async text=>replies.push(text),now:t});
 await run([update(1,8),update(2,7,8),update(3)]);assert.equal(replies.length,1);assert.equal(listWatches(state).length,1);
 await run([update(3)]);assert.equal(replies.length,1);assert.equal(state._telegramUpdateOffset,4);
 const group={};await processCommands({state:group,updates:[update(5,-7,99,'group')],chatId:'-7',persist:()=>{},reply:async()=>{},now:t});assert.equal(listWatches(group).length,0);
 await processCommands({state:group,updates:[update(6,-7,99,'group')],chatId:'-7',allowedUserId:'99',persist:()=>{},reply:async()=>{},now:t});assert.equal(listWatches(group).length,1);
});
test('command persistence failure cannot consume offset; reply failure cannot undo applied command',async()=>{
 const state={},updates=[{update_id:1,message:{chat:{id:7,type:'private'},from:{id:7},date:t/1000,text:'/seguir BTCUSD 15m long'}}];
 await assert.rejects(processCommands({state,updates,chatId:7,persist:()=>{throw Error('disk')},reply:async()=>{},now:t}));assert.deepEqual(state,{});
 await assert.rejects(processCommands({state,updates,chatId:7,persist:()=>{},reply:async()=>{throw Error('network')},now:t}));assert.equal(listWatches(state).length,1);assert.equal(state._telegramUpdateOffset,2);
});
test('getUpdates propagates safe errors, supplies offset, and never changes webhook',async()=>{
 let captured;
 await assert.rejects(fetchTelegramUpdates('secret',42,async(url,options)=>{captured={url,body:JSON.parse(options.body)};return {ok:false,status:409,json:async()=>({ok:false,error_code:409})}}),/409/);
 assert.match(captured.url,/getUpdates$/);assert.equal(captured.body.offset,42);assert.equal(captured.body.timeout,0);
});
test('monitor starts from registration, persists only successful alerts, and escalates without entry cooldown',async()=>{
 const s={};applyWatchCommand(s,'/seguir BTCUSD 15m long',t);const w=listWatches(s)[0],c=candles();let sent=0;
 const series=Array.from({length:10},()=>event(1));
 await assert.rejects(processWatch({state:s,watch:w,candles:c,series,now:c.closeTime[1],persist:()=>{},send:async()=>{throw Error('offline')}}));
 assert.equal(s['_watch:BTCUSD:15m:cursor'],t);
 await processWatch({state:s,watch:w,candles:c,series,now:c.closeTime[1],persist:()=>{},send:async()=>sent++});assert.equal(sent,1);
 series[2]=event(2);await processWatch({state:s,watch:w,candles:c,series,now:c.closeTime[2],persist:()=>{},send:async()=>sent++});assert.equal(sent,2);
 series[3]=event(2);await processWatch({state:s,watch:w,candles:c,series,now:c.closeTime[3],persist:()=>{},send:async()=>sent++});assert.equal(sent,2);
});
test('backlog includes transient danger as one historical notice, without pretending it is current',async()=>{
 const s={};applyWatchCommand(s,'/seguir BTCUSD 15m long',t);const w=listWatches(s)[0],c=candles(4);let sent=0;
 const series=[event(0),event(2),event(1),event(0)];
 await processWatch({state:s,watch:w,candles:c,series,now:c.closeTime[3],persist:()=>{},send:async text=>{sent++;assert.match(text,/AVISO RECUPERADO/);assert.match(text,/sin condición de debilidad/);}});assert.equal(sent,1);assert.equal(s['_watch:BTCUSD:15m:level'],2);
});
test('weakness calculation is causal and symmetric under mirrored prices',()=>{
 const close=Array.from({length:500},(_,i)=>100+10*Math.sin(i/8)+(i%97)*.05);
 const c={close,high:close.map(x=>x+1),low:close.map(x=>x-1)},all=buildWeakness(c);
 assert.ok(all.long.some(e=>e.level>0));assert.ok(all.short.some(e=>e.level>0));
 for(const n of [250,350,450]){
  const part=buildWeakness(Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v.slice(0,n)])));
  for(const side of ['long','short'])assert.deepEqual(part[side],all[side].slice(0,n));
 }
 const mirrored=buildWeakness({close:close.map(x=>200-x),high:c.low.map(x=>200-x),low:c.high.map(x=>200-x)});
 assert.deepEqual(mirrored.short.map(e=>e.level),all.long.map(e=>e.level));
});
test('scanner consults active 15m watch first and reuses data for opportunity target',async()=>{
 const now=Date.parse('2026-09-15T15:02:00Z'),state={};applyWatchCommand(state,'/seguir ETHUSD 15m short',now-10000000);
 const calls=[],fetch=async(symbol,tf)=>{
  calls.push([symbol,tf]);const duration=tf==='15m'?900000:3600000,end=Math.floor((now-60000)/duration)*duration;
  const close=Array.from({length:300},(_,i)=>100+i*.1);
  return {close,high:close.map(x=>x+1),low:close.map(x=>x-1),openTime:close.map((_,i)=>end-(300-i)*duration),closeTime:close.map((_,i)=>end-(299-i)*duration)};
 };
 const result=await scanMarkets({state,clock:()=>now,cryptoSymbols:['BTCUSD'],stockSymbols:[],timeframes:['1h'],extraTargets:[{symbol:'ETHUSD',tf:'15m'}],cryptoFetch:fetch,persist:()=>{},send:async()=>{}});
 assert.equal(result.healthy,true);assert.deepEqual(calls,[['ETHUSD','15m'],['BTCUSD','1h']]);
});

test('watch persistence encrypts positions and commands separately from public scanner state',async()=>{
 const {encryptWatchState,decryptWatchState,createRuntimePersist}=await import('./private-state.mjs');
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {pathToFileURL}=await import('node:url');
 const priv={'_watch:BTCUSD:15m:side':1,_telegramUpdateOffset:100};
 const encrypted=encryptWatchState(priv,'fake-test-token');assert.doesNotMatch(encrypted,/BTCUSD|telegramUpdate/);
 assert.deepEqual(decryptWatchState(encrypted,'fake-test-token'),priv);
 assert.throws(()=>decryptWatchState(encrypted,'wrong-token'),/No se pudo leer/);
 const dir=mkdtempSync(tmpdir()+'/alertbot-watch-test-');try{
  let pub;const path=pathToFileURL(dir+'/watch-state.enc');
  const persist=createRuntimePersist('fake-test-token',s=>pub=s,path);
  persist({...priv,'v2:BTCUSD:15m:setup_bull':10});assert.deepEqual(pub,{'v2:BTCUSD:15m:setup_bull':10});
  assert.deepEqual(decryptWatchState(readFileSync(path,'utf8'),'fake-test-token'),priv);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('lateral quiet bars do not rearm alerts without a recovered directional impulse',()=>{
 const before={level:2,clear:0};let state=before;
 for(let i=0;i<10;i++)state=transitionMonitor(state,{level:0,recovered:false}).next;
 assert.deepEqual(state,before);
 assert.equal(transitionMonitor(state,{level:1,recovered:false}).notify,false);
});

test('two contrary visual marks warn without divergence or price break; one alone does not',()=>{
 const mark={kind:'rsi',label:'círculo RSI',idx:2,barsAgo:0};
 assert.equal(classifyWeakness({side:'long',marks:[mark]}).level,0);
 const two=[mark,{...mark,kind:'turn',label:'rombo momentum'}];
 const warning=classifyWeakness({side:'long',marks:two});assert.equal(warning.level,1);assert.match(warning.evidence[0],/2 marcas rojas/);
 assert.match(classifyWeakness({side:'short',marks:two}).evidence[0],/verdes/);
 assert.equal(classifyWeakness({side:'long',marks:two,priceBreak:true}).level,1);
 assert.equal(classifyWeakness({side:'long',marks:two,priceBreak:true,momentum:true}).level,2);
});
test('marker events match Pine, use only three closed bars, and do not repeat sustained RSI readings',()=>{
 const val=[1,3,2,1,-1,-2,-1],sqz=[false,false,false,false,true,false,false],rsi=[75,75,65,64,63,62,61];
 const marks=smallMarkers(val,sqz,rsi);
 assert.deepEqual(marks.bear[2].map(m=>m.kind),['rsi','turn']);
 assert.equal(marks.bear[3].length,0);
 assert.equal(recentMarkers(marks.bear,4).length,2);
 assert.deepEqual(recentMarkers(marks.bear,5).map(m=>m.kind),['release']);
 assert.deepEqual(marks.bull[6].map(m=>m.kind),['turn']);
 for(let n=1;n<=val.length;n++){
  const part=smallMarkers(val.slice(0,n),sqz.slice(0,n),rsi.slice(0,n));
  for(const side of ['bull','bear'])assert.deepEqual(part[side],marks[side].slice(0,n));
 }
});

test('three-hour backlog warns once about recovered weakness and rearms after two recovery closes',async()=>{
 const s={};applyWatchCommand(s,'/seguir BTCUSD 15m long',t);const w=listWatches(s)[0],c=candles(13);
 const series=Array.from({length:13},(_,i)=>({...event(i===1?2:0),idx:i})),messages=[];
 const args={state:s,watch:w,candles:c,series,now:c.closeTime[12],persist:()=>{},send:async m=>messages.push(m)};
 await processWatch(args);assert.equal(messages.length,1);assert.match(messages[0],/165 min/);assert.match(messages[0],/sin condición de debilidad/);
 assert.equal(s[watchPrefix('BTCUSD','15m')+'level'],0);
 await processWatch(args);assert.equal(messages.length,1);
});
test('historical monitor send failure preserves cursor and can retry; expired warnings stay silent',async()=>{
 const s={};applyWatchCommand(s,'/seguir BTCUSD 15m long',t);const w=listWatches(s)[0],c=candles(20);
 const series=Array.from({length:20},(_,i)=>({...event(i===2?2:0),idx:i}));
 const args={state:s,watch:w,candles:c,series,persist:()=>{}};
 const before={...s};await assert.rejects(processWatch({...args,now:t+3*3600000,send:async()=>{throw Error('offline');}}));assert.deepEqual(s,before);
 let sent=0;await processWatch({...args,now:t+3*3600000,send:async()=>sent++});assert.equal(sent,1);
 const expired={};applyWatchCommand(expired,'/seguir BTCUSD 15m long',t);
 await processWatch({...args,state:expired,now:c.closeTime[19],send:async()=>sent++});assert.equal(sent,1);
});
test('commands wait through three-hour schedule, expire after four hours, and register from processing time',async()=>{
 const s={},replies=[];
 const make=(id,age)=>({update_id:id,message:{chat:{id:7,type:'private'},from:{id:7},date:(t-age)/1000,text:'/seguir BTCUSD 15m long'}});
 const args={state:s,chatId:7,persist:()=>{},reply:async m=>replies.push(m),now:t};
 await processCommands({...args,updates:[make(1,3*3600000)]});assert.equal(listWatches(s).length,1);assert.equal(listWatches(s)[0].started,t);assert.match(replies[0],/180 min/);
 await processCommands({...args,updates:[make(2,4*3600000+1000)]});assert.match(replies[1],/no se aplicó/);
});
