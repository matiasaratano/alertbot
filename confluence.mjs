import { rsiWilder, crossEvents, computeSqueezeMomentum, findPivots, findDivergences } from './indicators.mjs';

export function ema(values, length) {
  let previous;
  return values.map(value => {
    previous = previous === undefined ? value : previous + 2 / (length + 1) * (value - previous);
    return previous;
  });
}

// RSI: pivots DEL PRECIO, como el Pine seleccionado. Momentum: pivots del histograma.
export function rsiPriceDivergences(high, low, rsi, p) {
  const result = { bullish: [], bearish: [] };
  for (const [side, pivots, prices] of [
    ['bullish', findPivots(low, p.pivotLen, p.pivotLen).lows, low],
    ['bearish', findPivots(high, p.pivotLen, p.pivotLen).highs, high],
  ]) {
    for (let k = 1; k < pivots.length; k++) {
      const before = pivots[k - 1].idx, current = pivots[k].idx;
      const gap = current - before;
      if (gap < p.divRangeMin || gap > p.divRangeMax || !Number.isFinite(rsi[before]) || !Number.isFinite(rsi[current])) continue;
      if (side === 'bullish' ? prices[current] < prices[before] && rsi[current] > rsi[before]
        : prices[current] > prices[before] && rsi[current] < rsi[before]) {
        result[side].push({ idx: current, prevIdx: before, confirmedIdx: current + p.pivotLen });
      }
    }
  }
  return result;
}

export const COMPONENT_LABELS = {
  rsi_trigger: 'RSI salió de la banda', sqz_event: 'Giro o salida de squeeze',
  rsi_div: 'Divergencia RSI confirmada', mom_div: 'Divergencia momentum confirmada',
};

// Reproduce f_recent, freshEvent, EMA y cooldown del Pine sobre velas cerradas.
// El cooldown avanza también para señales Pine que el filtro de Telegram omite.
export function scoreConfluence({ close, trend, bull, bear }, p) {
  const result = [];
  const lastSeen = { bull: {}, bear: {} }, lastSignal = { bull: -Infinity, bear: -Infinity };
  for (let i = 0; i < close.length; i++) {
    for (const [side, components] of [['bull', bull], ['bear', bear]]) {
      let fresh = false;
      for (const name of Object.keys(COMPONENT_LABELS)) {
        if (components[name][i]) { lastSeen[side][name] = i; fresh = true; }
      }
      const evidence = Object.entries(lastSeen[side])
        .filter(([, idx]) => i - idx <= p.confluenceWindow)
        .map(([name, idx]) => ({ name, idx, barsAgo: i - idx, label: COMPONENT_LABELS[name] }));
      const score = evidence.length;
      const trendOk = !p.useEmaFilter || (side === 'bull' ? close[i] > trend[i] : close[i] < trend[i]);
      const raw = fresh && trendOk && score >= p.minimumScore;
      const confluenceSignal = raw && i - lastSignal[side] > p.signalCooldown;
      if (confluenceSignal) lastSignal[side] = i;
      const freshDivergences = ['rsi_div', 'mom_div'].filter(name => components[name][i]);
      if (confluenceSignal || freshDivergences.length) result.push({ idx: i, side, score, evidence, trendOk, confluenceSignal, freshDivergences, price: close[i], ema: trend[i] });
    }
  }
  return result;
}

export function buildConfluence(candles, p) {
  const { high, low, close } = candles;
  const n = close.length;
  const rsi = rsiWilder(close, p.rsiLen);
  const { crossover: buy } = crossEvents(rsi, p.buyLevel);
  const { crossunder: sell } = crossEvents(rsi, p.sellLevel);
  const { val, sqzOn } = computeSqueezeMomentum(high, low, close, p.sqz);
  const empty = () => Object.fromEntries(Object.keys(COMPONENT_LABELS).map(name => [name, Array(n).fill(false)]));
  const bull = empty(), bear = empty();
  bull.rsi_trigger = buy; bear.rsi_trigger = sell;
  for (let i = 2; i < n; i++) {
    if (![val[i], val[i - 1], val[i - 2]].every(Number.isFinite)) continue;
    const release = sqzOn[i - 1] && !sqzOn[i];
    bull.sqz_event[i] = val[i] < 0 && val[i] > val[i - 1] && val[i - 1] <= val[i - 2]
      || release && val[i] > 0 && val[i] > val[i - 1];
    bear.sqz_event[i] = val[i] > 0 && val[i] < val[i - 1] && val[i - 1] >= val[i - 2]
      || release && val[i] < 0 && val[i] < val[i - 1];
  }
  const momentum = findDivergences(findPivots(val, p.pivotLen, p.pivotLen), { highPrices: high, lowPrices: low }, p);
  const rsiDivs = rsiPriceDivergences(high, low, rsi, p);
  const pivotDetails = { bull: new Map(), bear: new Map() };
  for (const [side, target, key] of [['bullish', bull, 'bull'], ['bearish', bear, 'bear']]) {
    for (const [name, list] of [['mom_div', momentum[side]], ['rsi_div', rsiDivs[side]]]) {
      for (const d of list) {
        const confirmedIdx = d.idx + p.pivotLen;
        target[name][confirmedIdx] = true;
        if (!pivotDetails[key].has(confirmedIdx)) pivotDetails[key].set(confirmedIdx, []);
        pivotDetails[key].get(confirmedIdx).push({ name, pivotIdx: d.idx, prevIdx: d.prevIdx });
      }
    }
  }
  return scoreConfluence({ close, trend: ema(close, p.emaLength), bull, bear }, p).map(e => ({ ...e, rsi: rsi[e.idx], pivots: pivotDetails[e.side].get(e.idx) ?? [] }));
}

export function selectImportant(events, tf, policy) {
  const rule = policy[tf];
  if (!rule) return [];
  return events.filter(e => {
    const divergenceRecent = e.evidence.some(c => c.name === 'mom_div' || c.name === 'rsi_div');
    return rule.standaloneDivergences && e.freshDivergences.length > 0
      || e.confluenceSignal && e.score >= rule.minimumScore && (!rule.requireDivergence || divergenceRecent);
  });
}
