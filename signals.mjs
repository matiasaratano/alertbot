import { rsiWilder, crossEvents, ema, findPivots } from './indicators.mjs';
import { RSI, DIVERGENCE, EMA_LENGTH, CRYPTO_SYMBOLS } from './config.mjs';

// Tipos de aviso. `side` indica qué divergencia refuerza la señal.
export const SIGNAL_TYPES = {
  rsi_buy: { side: 'bull', icon: '🟢', title: 'RSI sale de sobreventa', describe: l => `cruzó ${l} hacia arriba` },
  rsi_sell: { side: 'bear', icon: '🟠', title: 'RSI sale de sobrecompra', describe: l => `cruzó ${l} hacia abajo` },
  rsi_extreme_low: { side: 'bull', icon: '🔵', title: 'RSI en sobreventa extrema', describe: l => `bajó de ${l}` },
  rsi_extreme_high: { side: 'bear', icon: '🔴', title: 'RSI en sobrecompra extrema', describe: l => `superó ${l}` },
};

export function buildSignals(candles, p = RSI, d = DIVERGENCE) {
  const { close, high, low } = candles;
  const rsi = rsiWilder(close, p.length);
  const trend = close.length >= EMA_LENGTH ? ema(close, EMA_LENGTH) : null;
  const crosses = {
    rsi_buy: [crossEvents(rsi, p.oversold).crossover, p.oversold],
    rsi_sell: [crossEvents(rsi, p.overbought).crossunder, p.overbought],
    rsi_extreme_low: [crossEvents(rsi, p.extremeLow).crossunder, p.extremeLow],
    rsi_extreme_high: [crossEvents(rsi, p.extremeHigh).crossover, p.extremeHigh],
  };
  const pivots = { bull: findPivots(low, d.pivotLen, d.pivotLen).lows, bear: findPivots(high, d.pivotLen, d.pivotLen).highs };
  const out = [];
  for (let i = 1; i < close.length; i++) {
    for (const [signal, [hits, level]] of Object.entries(crosses)) {
      if (!hits[i]) continue;
      const div = divergenceAt(i, SIGNAL_TYPES[signal].side, { high, low, rsi, pivots }, d);
      out.push({
        signal, idx: i, level, rsi: rsi[i], previousRsi: rsi[i - 1], price: close[i],
        ema: trend?.[i], confirmedTime: candles.closeTime[i],
        divergence: div && { prevTime: candles.openTime[div.prevIdx], pivotTime: candles.openTime[div.idx] },
      });
    }
  }
  return { events: out, lastRsi: rsi.at(-1) };
}

// Divergencia RSI al momento del cruce, sin mirar el futuro: compara el extremo de precio
// de las últimas `lookback` velas con el pivot anterior ya confirmado.
// Alcista: mínimo más bajo con RSI más alto. Bajista: máximo más alto con RSI más bajo.
export function divergenceAt(i, side, { high, low, rsi, pivots }, d = DIVERGENCE) {
  const bull = side === 'bull', price = bull ? low : high;
  let idx = i;
  for (let k = Math.max(0, i - d.lookback); k <= i; k++) {
    if (bull ? price[k] < price[idx] : price[k] > price[idx]) idx = k;
  }
  const prev = pivots[side].filter(p => p.idx + d.pivotLen <= i && idx - p.idx >= d.rangeMin && idx - p.idx <= d.rangeMax).at(-1);
  if (!prev || rsi[idx] == null || rsi[prev.idx] == null) return undefined;
  const diverges = bull ? price[idx] < price[prev.idx] && rsi[idx] > rsi[prev.idx]
    : price[idx] > price[prev.idx] && rsi[idx] < rsi[prev.idx];
  return diverges ? { idx, prevIdx: prev.idx } : undefined;
}

const sentKey = (symbol, tf, signal) => `rsi:${symbol}:${tf}:${signal}`;
export const lastSent = (state, symbol, tf, signal) => state[sentKey(symbol, tf, signal)] ?? 0;

export function pendingEvents(state, symbol, tf, events, now, maxDelay) {
  return events.filter(e => e.confirmedTime > lastSent(state, symbol, tf, e.signal)
    && e.confirmedTime <= now && now - e.confirmedTime <= maxDelay)
    .sort((a, b) => a.confirmedTime - b.confirmedTime);
}
export async function deliverEvents(state, symbol, tf, events, send, persist) {
  for (const event of events) {
    await send(event);
    state[sentKey(symbol, tf, event.signal)] = event.confirmedTime;
    persist(state);
  }
}

const fmtDate = (ms, withTime = true) => new Date(ms).toLocaleString('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23', day: '2-digit', month: '2-digit',
  ...(withTime ? { year: 'numeric', hour: '2-digit', minute: '2-digit' } : {}),
});
export const isCrypto = symbol => CRYPTO_SYMBOLS.includes(symbol);
export function chartLink(symbol, tf) {
  const tv = isCrypto(symbol) ? `KRAKEN:${symbol}` : symbol;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}&interval=${tf === '1w' ? 'W' : 'D'}`;
}
const tfLabel = tf => tf === '1w' ? 'semanal' : 'diario';

export function signalMessage(symbol, tf, e, now) {
  const type = SIGNAL_TYPES[e.signal];
  const lines = [
    `${type.icon} <b>${symbol}</b> · ${type.title} · ${tfLabel(tf)}`,
    `RSI(${RSI.length}) ${type.describe(e.level)}: ${e.previousRsi.toFixed(1)} → ${e.rsi.toFixed(1)}`,
  ];
  if (e.divergence) {
    lines.push(`⭐ Con divergencia ${type.side === 'bull' ? 'alcista' : 'bajista'} RSI (${fmtDate(e.divergence.prevTime, false)} → ${fmtDate(e.divergence.pivotTime, false)})`);
  }
  const trend = Number.isFinite(e.ema) ? ` · ${e.price >= e.ema ? 'encima' : 'debajo'} de EMA${EMA_LENGTH}` : '';
  lines.push(`Precio al cierre: ${e.price.toFixed(2)} USD${trend}`);
  lines.push(`Cierre: ${fmtDate(e.confirmedTime)} (ART)`);
  const hours = Math.floor((now - e.confirmedTime) / 3600000);
  if (hours >= 24) lines.push(`🕒 Aviso recuperado: la vela cerró hace ${hours} h. Revisá el gráfico actual.`);
  lines.push(chartLink(symbol, tf));
  return lines.join('\n');
}

// Resumen semanal: cruces enviados en los últimos 7 días + activos en zona o cerca.
export function weeklySummary(state, symbols, now) {
  const weekAgo = now - 7 * 86400000, staleAfter = 10 * 86400000;
  const crosses = [];
  for (const symbol of symbols) for (const tf of ['1d', '1w']) for (const signal of Object.keys(SIGNAL_TYPES)) {
    const t = lastSent(state, symbol, tf, signal);
    if (t > weekAgo) crosses.push({ symbol, tf, signal, t });
  }
  const low = [], high = [];
  for (const symbol of symbols) {
    const values = {};
    for (const tf of ['1d', '1w']) {
      const v = state[`_rsi:${symbol}:${tf}`], at = state[`_rsiAt:${symbol}:${tf}`];
      if (Number.isFinite(v) && now - at <= staleAfter) values[tf] = v;
    }
    const known = Object.values(values);
    if (!known.length) continue;
    const row = { symbol, values, min: Math.min(...known), max: Math.max(...known) };
    if (row.min <= RSI.nearLow) low.push(row);
    if (row.max >= RSI.nearHigh) high.push(row);
  }
  const marker = (v, isLow) => isLow
    ? (v <= RSI.extremeLow ? '🔵' : v <= RSI.oversold ? '🟢' : '⚪')
    : (v >= RSI.extremeHigh ? '🔴' : v >= RSI.overbought ? '🟠' : '⚪');
  const fmtRow = (r, isLow) => `${marker(isLow ? r.min : r.max, isLow)} ${r.symbol} · ${
    ['1d', '1w'].filter(tf => tf in r.values).map(tf => `${tf} ${r.values[tf].toFixed(1)}`).join(' · ')}`;
  const lines = [`📊 <b>Resumen semanal RSI</b> · ${fmtDate(now, false)}`, ''];
  lines.push('<b>Avisos de la semana</b>');
  if (crosses.length) {
    for (const c of crosses.sort((a, b) => a.t - b.t)) {
      lines.push(`${SIGNAL_TYPES[c.signal].icon} ${c.symbol} · ${c.tf} · ${SIGNAL_TYPES[c.signal].title} · ${fmtDate(c.t, false)}`);
    }
  } else lines.push('Ninguno.');
  lines.push('', `<b>Zona baja</b> (RSI ≤ ${RSI.nearLow})`);
  lines.push(...(low.length ? low.sort((a, b) => a.min - b.min).map(r => fmtRow(r, true)) : ['Ninguno.']));
  lines.push('', `<b>Zona alta</b> (RSI ≥ ${RSI.nearHigh})`);
  lines.push(...(high.length ? high.sort((a, b) => b.max - a.max).map(r => fmtRow(r, false)) : ['Ninguno.']));
  lines.push('', `🔵/🔴 extrema (${RSI.extremeLow}/${RSI.extremeHigh}) · 🟢/🟠 sobreventa/sobrecompra (${RSI.oversold}/${RSI.overbought}) · ⚪ cerca`);
  return lines.join('\n');
}
