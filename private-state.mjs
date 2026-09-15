import fs from 'node:fs';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
const privateKey=key=>key.startsWith('_watch:')||key==='_telegramUpdateOffset';
const derive=token=>createHash('sha256').update('alertbot-watch-v1\0'+token).digest();
export function encryptWatchState(state,token) {
 if(!token)throw Error('Falta TELEGRAM_TOKEN para proteger los seguimientos');
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',derive(token),nonce);
 const body=Buffer.concat([cipher.update(JSON.stringify(state),'utf8'),cipher.final()]);
 return JSON.stringify({version:1,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')});
}
export function decryptWatchState(text,token) {
 try {
  const e=JSON.parse(text);if(e.version!==1||!token)throw Error();
  const decipher=createDecipheriv('aes-256-gcm',derive(token),Buffer.from(e.nonce,'base64'));
  decipher.setAuthTag(Buffer.from(e.tag,'base64'));
  const result=JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.body,'base64')),decipher.final()]).toString('utf8'));
  if(!result||Array.isArray(result)||Object.entries(result).some(([k,v])=>!privateKey(k)||!Number.isFinite(v)))throw Error();
  return result;
 }catch{throw Error('No se pudo leer watch-state.enc. Revisar TELEGRAM_TOKEN o la integridad del archivo; no se reinicia el seguimiento automáticamente.');}
}
export function loadPrivateState(token,path=new URL('./watch-state.enc',import.meta.url)) {
 try{return decryptWatchState(fs.readFileSync(path,'utf8'),token);}catch(e){if(e.code==='ENOENT')return {};throw e;}
}
export function createRuntimePersist(token,savePublic,path=new URL('./watch-state.enc',import.meta.url)) {
 let lastPlain=fs.existsSync(path)?JSON.stringify(loadPrivateState(token,path)):undefined;
 return state=>{
  const pub={},priv={};for(const [key,value] of Object.entries(state))(privateKey(key)?priv:pub)[key]=value;
  const plain=JSON.stringify(priv);
  try {
   if(plain!==lastPlain){const temp=new URL('./watch-state.enc.tmp',path);fs.writeFileSync(temp,encryptWatchState(priv,token));fs.renameSync(temp,path);lastPlain=plain;}
   savePublic(pub);
  }catch(e){e.statePersistenceFailed=true;throw e;}
 };
}
