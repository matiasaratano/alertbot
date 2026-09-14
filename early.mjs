import { computeSqueezeMomentum, findTurnDivergences, rsiWilder } from './indicators.mjs';
import { ema } from './confluence.mjs';

// Una notificación por referencia confirmada. No se usa información futura.
export function earlyTurns(val, high, low, p) {
  const turns = findTurnDivergences(val, high, low, p);
  const result = [];
  for (const [side, list] of [['bull', turns.bullish], ['bear', turns.bearish]]) {
    const seen = new Set();
    for (const d of list) {
      const sameLobe = side === 'bear' ? val[d.idx] > 0 && val[d.prevIdx] > 0
        : val[d.idx] < 0 && val[d.prevIdx] < 0;
      if (!sameLobe || seen.has(d.prevIdx)) continue;
      seen.add(d.prevIdx);
      result.push({ ...d, side });
    }
  }
  return result.sort((a,b) => a.confirmedIdx-b.confirmedIdx);
}
export function buildEarly(candles, p) {
  const {high,low,close}=candles;
  const {val}=computeSqueezeMomentum(high,low,close,p.sqz);
  const trend=ema(close,p.emaLength),rsi=rsiWilder(close,p.rsiLen);
  return earlyTurns(val,high,low,p).map(d=>({
    idx:d.confirmedIdx,side:d.side,kind:'early',confluenceSignal:false,
    price:close[d.confirmedIdx],ema:trend[d.confirmedIdx],rsi:rsi[d.confirmedIdx],
    evidence:[],freshDivergences:[],
    pivots:[{name:'mom_div',prevIdx:d.prevIdx,pivotIdx:d.idx}],
  }));
}
