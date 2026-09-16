import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const SOURCE_DIR=fileURLToPath(new URL('./',import.meta.url));
export function runtimeFile(name,env=process.env) {
 return env.ALERTBOT_DATA_DIR ? pathToFileURL(path.join(path.resolve(env.ALERTBOT_DATA_DIR),'runtime',name)) : new URL(name,import.meta.url);
}
// Instalar juntos los archivos de una misma versión; nunca reemplazar un volumen existente.
export function initializeData(env=process.env,source=SOURCE_DIR) {
 if(!env.ALERTBOT_DATA_DIR)return;
 const root=path.resolve(env.ALERTBOT_DATA_DIR),dest=path.join(root,'runtime');
 if(fs.existsSync(dest)) {
  if(!fs.existsSync(path.join(dest,'state.json')))throw Error('Falta state.json en el volumen; restaurar el estado antes de iniciar.');
  return;
 }
 fs.mkdirSync(root,{recursive:true});
 const staging=fs.mkdtempSync(path.join(root,'.seed-'));
 try {
  fs.copyFileSync(path.join(source,'state.json'),path.join(staging,'state.json'));
  for(const name of ['watch-state.enc','heartbeat.json']) {
   const from=path.join(source,name);if(fs.existsSync(from))fs.copyFileSync(from,path.join(staging,name));
  }
  fs.renameSync(staging,dest);
 }finally{fs.rmSync(staging,{recursive:true,force:true});}
}
