import fs from 'node:fs';
const held=new Set();
export function acquireLock(file) {
 const key=String(file);
 if(held.has(key))throw Error('Ya hay un scanner activo en este proceso');
 let fd;
 for(let attempt=0;attempt<2;attempt++) {
  try{fd=fs.openSync(file,'wx');break;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const pid=Number(fs.readFileSync(file,'utf8'));
   if(!Number.isInteger(pid)||pid<1)throw Error('scan.lock inválido; revisar antes de quitarlo');
   let alive=pid!==process.pid;
   if(alive)try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
   if(alive)throw Error('Ya hay otro scanner activo');
   fs.unlinkSync(file);
  }
 }
 if(fd===undefined)throw Error('No se pudo adquirir scan.lock');
 fs.writeFileSync(fd,String(process.pid));held.add(key);
 return ()=>{if(!held.delete(key))return;try{fs.unlinkSync(file);}finally{fs.closeSync(fd);}};
}
