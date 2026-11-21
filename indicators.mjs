// RSI de Wilder (RMA): misma fórmula que ta.rsi() de Pine.
export function rsiWilder(closes, length) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < length + 1) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain += Math.max(diff, 0) / length;
    avgLoss += Math.max(-diff, 0) / length;
  }
  const value = () => avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out[length] = value();
  for (let i = length + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (length - 1) + Math.max(diff, 0)) / length;
    avgLoss = (avgLoss * (length - 1) + Math.max(-diff, 0)) / length;
    out[i] = value();
  }
  return out;
}

// ta.crossover / ta.crossunder sobre un nivel fijo.
export function crossEvents(series, level) {
  const crossover = new Array(series.length).fill(false);
  const crossunder = new Array(series.length).fill(false);
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] == null || series[i] == null) continue;
    if (series[i - 1] <= level && series[i] > level) crossover[i] = true;
    if (series[i - 1] >= level && series[i] < level) crossunder[i] = true;
  }
  return { crossover, crossunder };
}

export function ema(values, length) {
  let previous;
  return values.map(value => {
    previous = previous === undefined ? value : previous + 2 / (length + 1) * (value - previous);
    return previous;
  });
}

// Pivots tipo ta.pivothigh/pivotlow: igualdad permitida a la izquierda, estricta a la derecha.
// Un pivot solo existe cuando ya hay `right` velas cerradas después del extremo.
export function findPivots(values, left, right) {
  const highs = [], lows = [];
  for (let i = left; i < values.length - right; i++) {
    const win = values.slice(i - left, i + right + 1);
    if (win.some(v => v == null)) continue;
    const center = values[i];
    if (win.every((v, j) => j <= left ? center >= v : center > v)) highs.push({ idx: i, value: center });
    if (win.every((v, j) => j <= left ? center <= v : center < v)) lows.push({ idx: i, value: center });
  }
  return { highs, lows };
}
