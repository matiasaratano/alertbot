import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initializeData,runtimeFile} from './runtime-paths.mjs';
import {acquireLock} from './runtime-lock.mjs';
import {runWorker} from './worker.mjs';
import {run,loadState} from './scan.mjs';
import {loadPrivateState,encryptWatchState} from './private-state.mjs';

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'alertbot-runtime-'));return {root,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}
test('volume bootstrap preserves encrypted watches and never overwrites runtime state on redeploy',()=>{
 const f=fixture();try{
  const source=path.join(f.root,'source');fs.mkdirSync(source);
  const env={ALERTBOT_DATA_DIR:path.join(f.root,'data')},token='test-token';
  fs.writeFileSync(path.join(source,'state.json'),'{"signal":12}');
  fs.writeFileSync(path.join(source,'watch-state.enc'),encryptWatchState({'_telegramUpdateOffset':77},token));
  initializeData(env,source);
  assert.deepEqual(loadState(runtimeFile('state.json',env)),{signal:12});
  assert.deepEqual(loadPrivateState(token,runtimeFile('watch-state.enc',env)),{_telegramUpdateOffset:77});
  fs.writeFileSync(runtimeFile('state.json',env),'{"signal":99}');
  initializeData(env,source);assert.deepEqual(loadState(runtimeFile('state.json',env)),{signal:99});
  fs.unlinkSync(runtimeFile('state.json',env));assert.throws(()=>initializeData(env,source),/restaurar/);
 }finally{f.cleanup();}
});
test('incomplete seed cannot install a volume or silently reset state',()=>{
 const f=fixture();try{
  const env={ALERTBOT_DATA_DIR:path.join(f.root,'data')};
  assert.throws(()=>initializeData(env,f.root),/ENOENT/);
  assert.equal(fs.existsSync(path.join(env.ALERTBOT_DATA_DIR,'runtime')),false);
 }finally{f.cleanup();}
});
test('lock prevents an overlapping scanner and releases after shutdown',()=>{
 const f=fixture();try{
  const file=path.join(f.root,'scan.lock');const release=acquireLock(file);
  assert.throws(()=>acquireLock(file),/activo/);release();release();assert.equal(fs.existsSync(file),false);
  // A container can restart with the same PID: this process has not acquired it.
  fs.writeFileSync(file,String(process.pid));acquireLock(file)();
  fs.writeFileSync(file,String(process.ppid));assert.throws(()=>acquireLock(file),/activo/);
 }finally{f.cleanup();}
});
test('worker polls commands between scans and never overlaps or catches up slow scans',async()=>{
 const stop=new AbortController(),modes=[];let now=0,active=0;
 await runWorker({signal:stop.signal,clock:()=>now,pollMs:1000,scanMs:3000,log:()=>{},
  cycle:async({commandsOnly})=>{assert.equal(active++,0);modes.push(commandsOnly);now+=commandsOnly?0:10000;await Promise.resolve();active--;if(modes.length===5)stop.abort();},
  wait:async ms=>{now+=ms;}});
 assert.deepEqual(modes,[false,true,true,false,true]);
});
test('worker retries recoverable failures and stops on state write failures',async()=>{
 const stop=new AbortController();let calls=0,errors=0,now=0;
 await runWorker({signal:stop.signal,clock:()=>now,pollMs:1000,scanMs:1000,log:()=>{},onError:()=>errors++,wait:async ms=>{now+=ms;},
  cycle:async()=>{calls++;if(calls===1)throw Error('provider unavailable');stop.abort();}});
 assert.equal(calls,2);assert.equal(errors,1);
 const fatal=Object.assign(Error('disk full'),{statePersistenceFailed:true});
 await assert.rejects(runWorker({cycle:async()=>{throw fatal;},onError:()=>{}}),/disk full/);
});
test('abort interrupts worker wait without another polling cycle',async()=>{
 const stop=new AbortController();let calls=0;
 await runWorker({signal:stop.signal,cycle:async()=>{calls++;queueMicrotask(()=>stop.abort());},log:()=>{}});
 assert.equal(calls,1);
});
test('commands-only cycle acknowledges /posiciones, encrypts offset and preserves market heartbeat',async()=>{
 const f=fixture(),keys=['ALERTBOT_DATA_DIR','TELEGRAM_TOKEN','TELEGRAM_CHAT_ID','TELEGRAM_ALLOWED_USER_ID'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]])),oldFetch=globalThis.fetch;
 try{
  process.env.ALERTBOT_DATA_DIR=f.root;process.env.TELEGRAM_TOKEN='test-token';process.env.TELEGRAM_CHAT_ID='42';delete process.env.TELEGRAM_ALLOWED_USER_ID;
  const dir=path.join(f.root,'runtime');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'state.json'),'{}');
  fs.writeFileSync(path.join(dir,'heartbeat.json'),'previous-market-scan');
  const requests=[];
  globalThis.fetch=async(url)=>{
   requests.push(String(url));
   if(String(url).endsWith('/getUpdates'))return {ok:true,json:async()=>({ok:true,result:[{update_id:123,message:{date:Math.floor(Date.now()/1000),chat:{id:42,type:'private'},from:{id:42},text:'/posiciones'}}]})};
   assert.ok(String(url).endsWith('/sendMessage'),'no market data request in commands-only cycle');
   return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};
  };
  const result=await run({commandsOnly:true});
  assert.equal(result.commandsProcessed,1);assert.equal(result.updatesReceived,1);assert.equal(requests.length,2);
  assert.equal(loadPrivateState('test-token')._telegramUpdateOffset,124);
  assert.equal(fs.readFileSync(runtimeFile('heartbeat.json'),'utf8'),'previous-market-scan');
  assert.equal(fs.existsSync(runtimeFile('scan.lock')),false);
 }finally{globalThis.fetch=oldFetch;for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}f.cleanup();}
});
