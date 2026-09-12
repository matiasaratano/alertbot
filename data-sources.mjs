import { TF_MS, SETTLEMENT_MS } from './config.mjs';
import { stockBarTimes } from './market-calendar.mjs';
const KRAKEN_PAIR = { BTCUSD:'XBTUSD', ETHUSD:'ETHUSD', SOLUSD:'SOLUSD', BNBUSD:'BNBUSD' };
const TWELVEDATA_INTERVAL = { '15m':'15min', '1h':'1h', '4h':'4h', '1d':'1day' };

export function normalizeCandles(rows, now = Date.now()) {
  const ordered = rows.slice().sort((a,b)=>a.open-b.open);
  const result = { openTime:[], closeTime:[], high:[], low:[], close:[] };
  let previous = -Infinity;
  for (const row of ordered) {
    if (![row.open,row.end,row.high,row.low,row.close].every(Number.isFinite)
      || row.open <= previous || row.end <= row.open || row.high < row.low
      || row.close < row.low || row.close > row.high) throw new Error('Serie OHLC inválida o duplicada');
    previous = row.open;
    if (row.end + SETTLEMENT_MS > now) continue;
    result.openTime.push(row.open); result.closeTime.push(row.end);
    result.high.push(row.high); result.low.push(row.low); result.close.push(row.close);
  }
  return result;
}
export async function fetchKrakenKlines(symbol, tf, limit = 500) {
  if (!TF_MS[tf]) throw new Error(`Temporalidad inválida: ${tf}`);
  const pair = KRAKEN_PAIR[symbol];
  if (!pair) throw new Error(`Par Kraken no configurado: ${symbol}`);
  const url = new URL('https://api.kraken.com/0/public/OHLC');
  url.search = new URLSearchParams({pair, interval:String(TF_MS[tf]/60000)});
  const response = await fetch(url, {signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Kraken HTTP ${response.status}`);
  const data = await response.json();
  if (data.error?.length) throw new Error(`Kraken: ${data.error.join(', ')}`);
  const key = Object.keys(data.result ?? {}).find(k=>k!=='last');
  if (!key || !Array.isArray(data.result[key])) throw new Error('Kraken: respuesta sin velas');
  // Kraken documenta que el último registro SIEMPRE está sin confirmar.
  const rows = data.result[key].slice(0,-1).slice(-limit).map(r=>({
    open:Number(r[0])*1000, end:Number(r[0])*1000+TF_MS[tf],
    high:Number(r[2]), low:Number(r[3]), close:Number(r[4]),
  }));
  return normalizeCandles(rows);
}
let lastTwelveRequest = 0;
export async function fetchTwelveDataSeries(symbol, tf, apiKey, outputsize = 500) {
  const interval = TWELVEDATA_INTERVAL[tf];
  if (!interval) throw new Error(`Temporalidad inválida: ${tf}`);
  const wait = Math.max(0, 8100-(Date.now()-lastTwelveRequest));
  if (wait) await new Promise(resolve=>setTimeout(resolve,wait));
  lastTwelveRequest=Date.now();
  const url = new URL('https://api.twelvedata.com/time_series');
  url.search = new URLSearchParams({symbol,interval,outputsize:String(outputsize),timezone:'UTC',
    apikey:apiKey,order:'ASC',prepost:'false',adjust:'splits'});
  const response = await fetch(url, {signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Twelve Data HTTP ${response.status}`);
  const data = await response.json();
  if (data.status==='error') throw new Error(`Twelve Data: código ${data.code ?? 'desconocido'}`);
  if (!Array.isArray(data.values) || !data.values.length) throw new Error('Twelve Data: respuesta sin velas');
  const rows = data.values.map(v=>{
    const times = stockBarTimes(v.datetime,tf);
    return {open:times.open,end:times.close,high:Number(v.high),low:Number(v.low),close:Number(v.close)};
  });
  return normalizeCandles(rows);
}
