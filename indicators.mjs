// indicators.mjs
// Reimplementa en JS puro las fórmulas del indicador Pine Script v5:
// "SQZMOM + RSI Signal (precio) + Momentum Div (panel) v4"
// Todas las funciones trabajan sobre arrays completos (no streaming),
// así que no hace falta replicar el "lag" de confirmación de TradingView:
// directamente buscamos los pivots ya confirmados en el historial.

export function sma(values, length) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

export function stdev(values, length) {
  const out = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i++) {
    const win = values.slice(i - length + 1, i + 1);
    const mean = win.reduce((a, b) => a + b, 0) / length;
    const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / length;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

export function trueRange(highs, lows, closes) {
  const out = new Array(highs.length).fill(null);
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      out[i] = highs[i] - lows[i];
    } else {
      out[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    }
  }
  return out;
}

export function rollingHighest(values, length) {
  const out = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i++) {
    out[i] = Math.max(...values.slice(i - length + 1, i + 1));
  }
  return out;
}

export function rollingLowest(values, length) {
  const out = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i++) {
    out[i] = Math.min(...values.slice(i - length + 1, i + 1));
  }
  return out;
}

// RSI de Wilder (RMA) — misma fórmula que ta.rsi() de Pine
export function rsiWilder(closes, length) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < length + 1) return out;

  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }

  let avgGain = gains.slice(1, length + 1).reduce((a, b) => a + b, 0) / length;
  let avgLoss = losses.slice(1, length + 1).reduce((a, b) => a + b, 0) / length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = length + 1; i < closes.length; i++) {
    avgGain = (avgGain * (length - 1) + gains[i]) / length;
    avgLoss = (avgLoss * (length - 1) + losses[i]) / length;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ta.crossover / ta.crossunder sobre un nivel fijo
export function crossEvents(series, level) {
  const crossover = new Array(series.length).fill(false); // sube y cruza por encima
  const crossunder = new Array(series.length).fill(false); // baja y cruza por debajo
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] == null || series[i] == null) continue;
    if (series[i - 1] <= level && series[i] > level) crossover[i] = true;
    if (series[i - 1] >= level && series[i] < level) crossunder[i] = true;
  }
  return { crossover, crossunder };
}

// Regresión lineal (least squares), replica ta.linreg(source, length, 0):
// valor de la recta ajustada evaluado en la última barra de la ventana.
function linregEndpoint(windowValues) {
  const n = windowValues.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let x = 0; x < n; x++) {
    const y = windowValues[x];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return intercept + slope * (n - 1);
}

// Squeeze Momentum de LazyBear (histograma "val" + sqzOn/sqzOff)
export function computeSqueezeMomentum(
  highs, lows, closes,
  { length = 20, mult = 2.0, lengthKC = 20, multKC = 1.5 } = {}
) {
  const n = closes.length;
  const basis = sma(closes, length);
  const dev = stdev(closes, length).map((s) => (s == null ? null : s * mult));
  const upperBB = basis.map((b, i) => (b == null || dev[i] == null ? null : b + dev[i]));
  const lowerBB = basis.map((b, i) => (b == null || dev[i] == null ? null : b - dev[i]));

  const ma = sma(closes, lengthKC);
  const tr = trueRange(highs, lows, closes);
  const rangema = sma(tr, lengthKC);
  const upperKC = ma.map((m, i) => (m == null || rangema[i] == null ? null : m + rangema[i] * multKC));
  const lowerKC = ma.map((m, i) => (m == null || rangema[i] == null ? null : m - rangema[i] * multKC));

  const sqzOn = new Array(n).fill(false);
  const sqzOff = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if ([lowerBB[i], lowerKC[i], upperBB[i], upperKC[i]].some((v) => v == null)) continue;
    sqzOn[i] = lowerBB[i] > lowerKC[i] && upperBB[i] < upperKC[i];
    sqzOff[i] = lowerBB[i] < lowerKC[i] && upperBB[i] > upperKC[i];
  }

  const highestKC = rollingHighest(highs, lengthKC);
  const lowestKC = rollingLowest(lows, lengthKC);
  const smaCloseKC = sma(closes, lengthKC);

  const source = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (highestKC[i] == null || lowestKC[i] == null || smaCloseKC[i] == null) continue;
    const donchianMid = (highestKC[i] + lowestKC[i]) / 2;
    const avgVal = (donchianMid + smaCloseKC[i]) / 2;
    source[i] = closes[i] - avgVal;
  }

  const val = new Array(n).fill(null);
  for (let i = lengthKC - 1; i < n; i++) {
    const win = source.slice(i - lengthKC + 1, i + 1);
    if (win.some((v) => v == null)) continue;
    val[i] = linregEndpoint(win);
  }

  return { val, sqzOn, sqzOff };
}

// Pivots tipo ta.pivothigh/pivotlow(val, left, right): un punto es pivot
// si es el máximo/mínimo estricto dentro de la ventana [i-left, i+right].
export function findPivots(val, left, right) {
  const highs = [];
  const lows = [];
  for (let i = left; i < val.length - right; i++) {
    if (val[i] == null) continue;
    const win = val.slice(i - left, i + right + 1);
    if (win.some((v) => v == null)) continue;
    const center = val[i];

    const isHigh = win.every((v, winIdx) => winIdx === left || center > v);
    if (isHigh) highs.push({ idx: i, value: center });

    const isLow = win.every((v, winIdx) => winIdx === left || center < v);
    if (isLow) lows.push({ idx: i, value: center });
  }
  return { highs, lows };
}

// Recorre la lista cronológica de pivots confirmados y aplica las mismas
// condiciones que el bloque de divergencias del Pine Script:
//   bearish: val del pivot actual < val del pivot anterior (momentum más bajo)
//            Y precio (high) actual > precio anterior (precio más alto)
//   bullish: val del pivot actual > val del pivot anterior (momentum más alto)
//            Y precio (low) actual < precio anterior (precio más bajo)
//   siempre que la distancia en barras esté dentro de [divRangeMin, divRangeMax]
export function findDivergences(
  { highs, lows },
  { highPrices, lowPrices },
  { divRangeMin = 5, divRangeMax = 60 } = {}
) {
  const bearish = [];
  for (let k = 1; k < highs.length; k++) {
    const prev = highs[k - 1];
    const curr = highs[k];
    const barGap = curr.idx - prev.idx;
    if (barGap < divRangeMin || barGap > divRangeMax) continue;
    const prevPrice = highPrices[prev.idx];
    const currPrice = highPrices[curr.idx];
    if (curr.value < prev.value && currPrice > prevPrice) {
      bearish.push({ idx: curr.idx, prevIdx: prev.idx });
    }
  }

  const bullish = [];
  for (let k = 1; k < lows.length; k++) {
    const prev = lows[k - 1];
    const curr = lows[k];
    const barGap = curr.idx - prev.idx;
    if (barGap < divRangeMin || barGap > divRangeMax) continue;
    const prevPrice = lowPrices[prev.idx];
    const currPrice = lowPrices[curr.idx];
    if (curr.value > prev.value && currPrice < prevPrice) {
      bullish.push({ idx: curr.idx, prevIdx: prev.idx });
    }
  }

  return { bullish, bearish };
}
