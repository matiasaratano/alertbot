import { rsiWilder, crossEvents, ema, findPivots } from './indicators.mjs';
import { RSI, DIVERGENCE, EMA_LENGTHS, EMA_SLOPE_BARS, EMA_NEAR_PCT, CRYPTO_SYMBOLS } from './config.mjs';

// Tipos de aviso. `side` indica qué divergencia refuerza la señal.
export const SIGNAL_TYPES = {
  rsi_buy: { side: 'bull', icon: '🟢', title: 'RSI sale de sobreventa', short: 'sale de sobreventa' },
  rsi_sell: { side: 'bear', icon: '🟠', title: 'RSI sale de sobrecompra', short: 'sale de sobrecompra' },
  rsi_extreme_low: { side: 'bull', icon: '🔵', title: 'RSI en sobreventa extrema', short: 'sobreventa extrema' },
  rsi_extreme_high: { side: 'bear', icon: '🔴', title: 'RSI en sobrecompra extrema', short: 'sobrecompra extrema' },
};

export function buildSignals(candles, p = RSI, d = DIVERGENCE) {
  const { close, high, low } = candles;
  const rsi = rsiWilder(close, p.length);
  // Una EMA solo se informa si hay al menos tantas velas como su período.
  const emas = Object.fromEntries(EMA_LENGTHS.filter(n => close.length >= n).map(n => [n, ema(close, n)]));
  const emaContext = i => Object.fromEntries(Object.entries(emas).filter(([n]) => i >= n - 1).map(([n, series]) => [n, {
    value: series[i], pct: (close[i] / series[i] - 1) * 100,
    rising: i >= EMA_SLOPE_BARS ? series[i] > series[i - EMA_SLOPE_BARS] : undefined,
  }]));
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
        emas: emaContext(i), confirmedTime: candles.closeTime[i],
        divergence: div && { prevTime: candles.openTime[div.prevIdx], pivotTime: candles.openTime[div.idx] },
      });
    }
  }
  return { events: out, lastRsi: rsi.at(-1), lastEmas: emaContext(close.length - 1) };
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

// Aviso breve: qué pasó, en qué tendencia está y, si aplica, la divergencia.
export function signalMessage(symbol, tf, e, now) {
  const type = SIGNAL_TYPES[e.signal];
  const lines = [`${type.icon} <b>${symbol}</b> · ${tfLabel(tf)} · ${type.short} (RSI ${e.rsi.toFixed(1)})`];
  const trend = trendSentence(e.emas);
  if (trend) lines.push(trend);
  if (e.divergence) {
    lines.push(type.side === 'bull'
      ? '⭐ Divergencia alcista: el precio hizo un mínimo más bajo, pero el RSI no.'
      : '⭐ Divergencia bajista: el precio hizo un máximo más alto, pero el RSI no.');
  }
  const hours = Math.floor((now - e.confirmedTime) / 3600000);
  lines.push(`Cierre ${fmtDate(e.confirmedTime, false)} · ${e.price.toFixed(2)} USD${hours >= 24 ? ` · 🕒 hace ${hours} h, revisá el gráfico actual` : ''}`);
  lines.push(chartLink(symbol, tf));
  return lines.join('\n');
}

const pct = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const dist = v => `${Math.round(Math.abs(v))}%`;
// Una frase sobre la tendencia según la EMA200 (distancia y pendiente). Sin EMA200, usa la EMA50.
export function trendSentence(emas = {}) {
  const m = emas[200];
  if (m && m.rising !== undefined) {
    const near = Math.abs(m.pct) <= EMA_NEAR_PCT, above = m.pct >= 0;
    if (above && m.rising) return near ? '📍 Corrige hasta la EMA200 dentro de una tendencia alcista.'
      : `Tendencia alcista: ${dist(m.pct)} sobre la EMA200, que sigue subiendo.`;
    if (above) return near ? '📍 Está recuperando la EMA200, que todavía baja.'
      : `Superó la EMA200 bajista por ${dist(m.pct)}: posible cambio de tendencia.`;
    if (m.rising) return near ? '📍 Perforó apenas la EMA200, que sigue subiendo.'
      : `Corrección profunda: ${dist(m.pct)} debajo de la EMA200, que todavía sube.`;
    return near ? '📍 Tendencia bajista, cerca de testear la EMA200 desde abajo.'
      : `Tendencia bajista: ${dist(m.pct)} debajo de la EMA200, que sigue bajando.`;
  }
  const short = emas[50];
  if (short) return `${dist(short.pct)} ${short.pct >= 0 ? 'sobre' : 'debajo de'} la EMA50 (no hay historial para la EMA200).`;
  return undefined;
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
    const ema200 = state[`_ema200:${symbol}:1d`];
    const row = { symbol, values, ema200: values['1d'] !== undefined && Number.isFinite(ema200) ? ema200 : undefined,
      min: Math.min(...known), max: Math.max(...known) };
    if (row.min <= RSI.nearLow) low.push(row);
    if (row.max >= RSI.nearHigh) high.push(row);
  }
  const marker = (v, isLow) => isLow
    ? (v <= RSI.extremeLow ? '🔵' : v <= RSI.oversold ? '🟢' : '⚪')
    : (v >= RSI.extremeHigh ? '🔴' : v >= RSI.overbought ? '🟠' : '⚪');
  const fmtRow = (r, isLow) => `${marker(isLow ? r.min : r.max, isLow)} ${r.symbol} · ${
    ['1d', '1w'].filter(tf => tf in r.values).map(tf => `${tf} ${r.values[tf].toFixed(1)}`).join(' · ')}${
    r.ema200 === undefined ? '' : ` · EMA200 ${pct(r.ema200)}${Math.abs(r.ema200) <= EMA_NEAR_PCT ? ' 📍' : ''}`}`;
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
  lines.push('', `🔵/🔴 extrema (${RSI.extremeLow}/${RSI.extremeHigh}) · 🟢/🟠 sobreventa/sobrecompra (${RSI.oversold}/${RSI.overbought}) · ⚪ cerca · EMA200 = distancia del precio a la media diaria (📍 a menos de ${EMA_NEAR_PCT}%)`);
  return lines.join('\n');
}
