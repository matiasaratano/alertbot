import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {run,loadState} from './scan.mjs';
import {loadPrivateState} from './private-state.mjs';
import {maxAlertDelayMs} from './config.mjs';
import {runtimeFile,initializeData} from './runtime-paths.mjs';
import {acquireLock} from './runtime-lock.mjs';

export async function runWorker({cycle=run,clock=Date.now,wait=sleep,signal,
 pollMs=5000,scanMs=60000,log=console.log,onError=console.error}={}) {
 if(!Number.isFinite(pollMs)||pollMs<1000||!Number.isFinite(scanMs)||scanMs<pollMs)throw Error('Intervalos del worker inválidos');
 let nextScan=-Infinity,lastStatus=-Infinity;
 while(!signal?.aborted) {
  const commandsOnly=clock()<nextScan;
  try{await cycle({commandsOnly,lockHeld:true});}
  catch(error){
   onError('WORKER_ERROR '+error.message);
   if(error.statePersistenceFailed)throw error;
  }
  // Sin ciclos simultáneos ni ráfagas para recuperar ticks perdidos.
  if(!commandsOnly)nextScan=clock()+scanMs;
  if(clock()-lastStatus>=60000){log('WORKER_ALIVE '+new Date(clock()).toISOString());lastStatus=clock();}
  if(signal?.aborted)break;
  try{await wait(pollMs,undefined,{signal});}catch(error){if(error.name==='AbortError'&&signal?.aborted)break;throw error;}
 }
}
export async function startWorker() {
 if(!process.env.TELEGRAM_TOKEN||!process.env.TELEGRAM_CHAT_ID)throw Error('Faltan TELEGRAM_TOKEN / TELEGRAM_CHAT_ID');
 initializeData();
 const release=acquireLock(runtimeFile('scan.lock')),controller=new AbortController();
 const stop=()=>controller.abort();
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 console.log('Worker iniciado: comandos cada 5 s; análisis 60 s después de terminar el anterior.');
 try{
  maxAlertDelayMs();loadState();loadPrivateState(process.env.TELEGRAM_TOKEN);
  await runWorker({signal:controller.signal});
 }
 finally{release();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 startWorker().catch(error=>{console.error(error.message);process.exitCode=1;});
}
