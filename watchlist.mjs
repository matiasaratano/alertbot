import {CRYPTO_SYMBOLS,STOCK_SYMBOLS,maxAlertDelayMs} from './config.mjs';
export const WATCH_TFS=['15m','1h','4h','1d'];
export const MAX_WATCHES=8;
export const watchPrefix=(symbol,tf)=>`_watch:${symbol}:${tf}:`;
export function listWatches(state) {
 return Object.entries(state).filter(([key,value])=>/^_watch:[A-Z]+:(15m|1h|4h|1d):side$/.test(key)&&(value===1||value===-1))
 .map(([key,value])=>{const [,symbol,tf]=key.split(':');return {symbol,tf,side:value===1?'long':'short',started:state[watchPrefix(symbol,tf)+'started']};});
}
const help='Comandos (solo seguimiento, no ejecutan operaciones):\n/seguir BTCUSD 15m long\n/seguir NVDA 1h short\n/dejar BTCUSD 15m\n/posiciones\nMarcos: 15m, 1h, 4h, 1d. Una dirección por activo y marco. Respondo en la próxima ejecución del scanner.';
export function applyWatchCommand(state,text,now=Date.now()) {
 const args=text.trim().split(/\s+/);const command=args.shift()?.split('@')[0].toLowerCase();
 if(['/start','/ayuda','/help'].includes(command))return help;
 if(['/posiciones','/seguimientos'].includes(command)){
  const watches=listWatches(state);return watches.length?'Seguimientos activos (no son posiciones del broker):\n'+watches.map(w=>`${w.symbol} · ${w.tf} · ${w.side.toUpperCase()}`).join('\n'):'No hay seguimientos activos.\n'+help;
 }
 if(!['/seguir','/dejar'].includes(command))return text.startsWith('/')?help:null;
 const symbol=args[0]?.toUpperCase();const tf=args[1]?.toLowerCase();
 if(![...CRYPTO_SYMBOLS,...STOCK_SYMBOLS].includes(symbol)||!WATCH_TFS.includes(tf))return 'Activo o marco no disponible. Activos: '+[...CRYPTO_SYMBOLS,...STOCK_SYMBOLS].join(', ')+'\n'+help;
 const prefix=watchPrefix(symbol,tf);
 if(command==='/dejar'){
  if(args.length!==2)return 'Uso: /dejar BTCUSD 15m';
  for(const key of Object.keys(state))if(key.startsWith(prefix))delete state[key];
  return `Seguimiento desactivado: ${symbol} ${tf}. No se cerró ninguna operación.`;
 }
 const side=args[2]?.toLowerCase();if(args.length!==3||!['long','short'].includes(side))return 'Uso: /seguir BTCUSD 15m long (o short)';
 if(state[prefix+'side']===(side==='long'?1:-1))return `Ya sigo ${symbol} ${tf} ${side.toUpperCase()}. Para empezar un seguimiento nuevo, usá /dejar y después /seguir.`;
 if(!state[prefix+'side']&&listWatches(state).length>=MAX_WATCHES)return `Máximo ${MAX_WATCHES} seguimientos. Quitá uno con /dejar.`;
 for(const key of Object.keys(state))if(key.startsWith(prefix))delete state[key];
 Object.assign(state,{[prefix+'side']:side==='long'?1:-1,[prefix+'started']:now,[prefix+'cursor']:now,[prefix+'level']:0,[prefix+'clear']:0});
 return `Siguiendo ${symbol} · ${tf} · ${side.toUpperCase()} desde ahora. Avisaré de debilitamiento y pérdida de estructura contra ese movimiento en velas cerradas. No abrí ninguna operación. Los avisos dependen del horario del scanner.`;
}
export async function fetchTelegramUpdates(token,offset,fetchImpl=fetch) {
 const response=await fetchImpl(`https://api.telegram.org/bot${token}/getUpdates`,{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({offset,limit:100,timeout:0,allowed_updates:['message']})});
 const data=await response.json();
 if(!response.ok||data.ok!==true||!Array.isArray(data.result))throw Error(`No se pudieron leer comandos Telegram (HTTP ${response.status}, código ${data.error_code??'desconocido'}). Si hay webhook u otro lector getUpdates, revisar la configuración; no se modifica automáticamente.`);
 return data.result;
}
export async function processCommands({state,updates,chatId,allowedUserId,persist,reply,now=Date.now()}) {
 let accepted=0;
 for(const update of updates.slice().sort((a,b)=>a.update_id-b.update_id)) {
  if(!Number.isSafeInteger(update.update_id)||update.update_id<(state._telegramUpdateOffset??0))continue;
  const m=update.message;
  const privateOwner=String(m?.chat?.id)===String(chatId)&&m?.chat?.type==='private'&&String(m?.from?.id)===String(chatId);
  const allowed=String(m?.chat?.id)===String(chatId)&&(privateOwner||(allowedUserId&&String(m?.from?.id)===String(allowedUserId)));
  const draft={...state};let response=null;
  if(allowed&&!m?.from?.is_bot&&typeof m?.text==='string'&&Number.isFinite(m.date)&&m.date*1000<=now&&now-m.date*1000<=maxAlertDelayMs()){response=applyWatchCommand(draft,m.text,now);if(response){accepted++;if(now-m.date*1000>=15*60000)response+=`\n🕒 Comando recibido hace ${Math.floor((now-m.date*1000)/60000)} min; procesado ahora. Un seguimiento nuevo comienza ahora, no retroactivamente.`;}}
  else if(allowed&&!m?.from?.is_bot&&m?.text?.startsWith('/')&&Number.isFinite(m.date)&&now-m.date*1000>maxAlertDelayMs())response=`Ese comando supera la ventana de ${maxAlertDelayMs()/60000} minutos y no se aplicó. Reenviá el comando para registrar el seguimiento actual.`;
  draft._telegramUpdateOffset=update.update_id+1;
  // Guardar el comando una sola vez. Un fallo de respuesta no deshace el seguimiento.
  persist(draft);for(const key of Object.keys(state))delete state[key];Object.assign(state,draft);
  if(response)await reply(response);
 }
 return accepted;
}
