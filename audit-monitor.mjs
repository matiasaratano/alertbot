import fs from 'node:fs';
import {buildWeakness,transitionMonitor} from './monitor.mjs';
import {buildSetups} from './setups.mjs';
import {computeSqueezeMomentum,rsiWilder,crossEvents} from './indicators.mjs';
import {INDICATOR} from './config.mjs';
const dir=new URL('./audit-monitor/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const out=[];
for(const [symbol,pair] of [['BTCUSD','XBTUSD'],['ETHUSD','ETHUSD']])for(const [tf,minutes] of [['15m',15],['1h',60],['4h',240]]) {
 const path=new URL(`${symbol}-${tf}.json`,dir);let rows;
 if(fs.existsSync(path))rows=JSON.parse(fs.readFileSync(path,'utf8'));
 else {
  const response=await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${minutes}`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Kraken HTTP '+response.status);
  const data=await response.json();if(data.error?.length)throw Error(data.error.join(', '));
  rows=data.result[Object.keys(data.result).find(k=>k!=='last')].slice(0,-1).slice(-700);fs.writeFileSync(path,JSON.stringify(rows));
 }
 const c={close:rows.map(r=>+r[4]),high:rows.map(r=>+r[2]),low:rows.map(r=>+r[3])};
 const {val,sqzOn}=computeSqueezeMomentum(c.high,c.low,c.close,INDICATOR.sqz);
 const rsi=rsiWilder(c.close,14),r=crossEvents(rsi,30).crossover,s=crossEvents(rsi,70).crossunder;
 let raw=0;for(let i=249;i<rows.length;i++)raw+=Number(r[i])+Number(s[i])+Number(val[i]<0&&val[i]>val[i-1]&&val[i-1]<=val[i-2])+Number(val[i]>0&&val[i]<val[i-1]&&val[i-1]>=val[i-2])+Number(sqzOn[i-1]&&!sqzOn[i]&&val[i]!==val[i-1]);
 const readings=buildWeakness(c),entry=buildSetups(c,INDICATOR).filter(e=>e.idx>=249);
 const result={symbol,tf,from:new Date(+rows[249][0]*1000).toISOString(),to:new Date(+rows.at(-1)[0]*1000).toISOString(),individualEvents:raw,opportunities:entry.length};
 for(const side of ['long','short']){
  let state={level:0,clear:0},weak=0,structure=0;
  for(const e of readings[side].slice(249)){const t=transitionMonitor(state,e);state=t.next;if(t.notify){if(e.level===1)weak++;else structure++;}}
  result[side]={weak,structure,total:weak+structure};
 }
 out.push(result);
}
fs.writeFileSync(new URL('results.json',dir),JSON.stringify(out,null,2));
const lines=['# Volumen descriptivo de avisos','',
'BTC/ETH de Kraken, últimas 700 velas cerradas y 249 de calentamiento. Simula por separado mantener seguimiento LONG o SHORT durante toda la ventana, procesando cada cierre; no representa tus trades ni evalúa rentabilidad. Cuenta escaladas y rearme tras dos cierres de recuperación del impulso. La muestra se usó para revisar el volumen y mejorar la regla que evita repeticiones; no es una validación independiente ni se optimizó rentabilidad.',
'', '| Activo | TF | Marcas individuales | Setups v8 | Seguimiento LONG | Seguimiento SHORT |','|---|---|---:|---:|---:|---:|'];
for(const r of out)lines.push(`| ${r.symbol} | ${r.tf} | ${r.individualEvents} | ${r.opportunities} | ${r.long.total} | ${r.short.total} |`);
lines.push('','Las ventanas difieren por el límite de historia; sus fechas están en results.json. Los setups no incluyen el cooldown adicional del envío, el monitoreo sí usa sus episodios. Durante un seguimiento se silencian las oportunidades de ese activo/marco. Las columnas LONG/SHORT son escenarios alternativos, no sumarlas como mensajes simultáneos. La recuperación del impulso rearma el monitor, así que un seguimiento largo puede producir varios episodios. Esto mide volumen potencial, no calidad ni latencia de Telegram.');
fs.writeFileSync(new URL('INFORME.md',dir),lines.join('\n')+'\n');console.log(lines.join('\n'));
