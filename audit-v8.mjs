// Exploración descriptiva, no estrategia ni optimización de parámetros.
import fs from 'node:fs';
import {buildConfluence} from './confluence.mjs';
import {buildSetups,SETUP} from './setups.mjs';
import {INDICATOR} from './config.mjs';
const dir=new URL('./audit-v8/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const result=[];
for(const [symbol,pair] of [['BTCUSD','XBTUSD'],['ETHUSD','ETHUSD']])for(const [tf,interval,horizon] of [['4h',240,6],['1d',1440,5],['1w',10080,4]]) {
 const path=new URL(`${symbol}-${tf}.json`,dir);
 let rows;
 if(fs.existsSync(path))rows=JSON.parse(fs.readFileSync(path,'utf8'));
 else {
  const response=await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Kraken HTTP '+response.status);
  const data=await response.json();if(data.error?.length)throw Error(data.error.join(', '));
  rows=data.result[Object.keys(data.result).find(k=>k!=='last')].slice(0,-1).slice(-700);
  fs.writeFileSync(path,JSON.stringify(rows));
 }
 const c={open:rows.map(r=>Number(r[1])),high:rows.map(r=>Number(r[2])),low:rows.map(r=>Number(r[3])),close:rows.map(r=>Number(r[4]))};
 const prior=buildConfluence(c,INDICATOR).filter(e=>e.confluenceSignal),next=buildSetups(c,INDICATOR);
 const summary={symbol,tf,horizon,from:new Date(Number(rows[249][0])*1000).toISOString(),to:new Date(Number(rows.at(-1)[0])*1000).toISOString(),variants:[]};
 for(const [version,events] of [['v7',prior],['v8',next]])for(const side of ['bull','bear']) {
  const signals=events.filter(e=>e.idx>=249&&e.side===side);
  const trades=signals.filter(e=>e.idx+horizon<c.close.length).map(e=>{
   const signed=(c.close[e.idx+horizon]/c.open[e.idx+1]-1)*100*(side==='bull'?1:-1);
   return {date:new Date(Number(rows[e.idx][0])*1000).toISOString(),grossPct:signed,netPct:signed-.1,countertrend:!e.trendOk};
  });
  const n=trades.length,wins=trades.filter(t=>t.netPct>0).length;
  summary.variants.push({version,side,signals:signals.length,mature:n,winPct:n?wins/n*100:null,meanNetPct:n?trades.reduce((a,t)=>a+t.netPct,0)/n:null,countertrend:signals.filter(e=>!e.trendOk).length,trades});
 }
 result.push(summary);
}
fs.writeFileSync(new URL('results.json',dir),JSON.stringify({generatedAt:new Date().toISOString(),parameters:SETUP,feesRoundTripPct:.1,result},null,2));
const f=(v)=>v===null?'—':v.toFixed(2);
const lines=['# Comparación descriptiva v7 / v8','',
'BTC/USD y ETH/USD, Kraken. Solo velas cerradas; las últimas 700 disponibles, primeras 249 reservadas para calentamiento. Semanal nativo de Kraken: sus límites de semana pueden diferir de TradingView. No prueba equivalencia con el motor Pine.',
'', 'Entrada hipotética en la apertura siguiente y salida al cierre de la sexta vela en 4h, quinta en diario y cuarta en semanal. Retorno direccional menos 0,10% de coste total supuesto. Las señales pueden solaparse: no son trades de una cartera ejecutable. No incorpora stops, deslizamiento variable, financiación, préstamo ni dividendos. No se ajustaron parámetros buscando mejorar esta muestra.',
'', '| Activo | TF | Versión | Lado | Señales | Maduras | Positivas netas | Media neta | Contra EMA200 |','|---|---|---|---|---|---|---|---|---|'];
for(const r of result)for(const v of r.variants)lines.push(`| ${r.symbol} | ${r.tf} | ${v.version} | ${v.side==='bull'?'BUY':'SELL'} | ${v.signals} | ${v.mature} | ${f(v.winPct)}% | ${f(v.meanNetPct)}% | ${v.countertrend} |`);
lines.push('','## Límites de interpretación','', 'La tasa positiva depende de la salida elegida: no es una probabilidad de acierto del cartel. Esta comparación de muestras pequeñas no establece superioridad, no tiene una prueba independiente fuera de muestra y no valida acciones como NVDA. Evaluar aciertos junto con pérdida/ganancia media y expectativa; más aciertos pueden coexistir con pérdidas netas. Los rangos de fechas y cada observación están en results.json. La política de Telegram tiene filtros y cooldown adicionales, por lo que estos conteos describen las señales del gráfico.');
fs.writeFileSync(new URL('INFORME.md',dir),lines.join('\n')+'\n');
console.log(lines.slice(4,-4).join('\n'));
