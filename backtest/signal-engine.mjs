import {
  rsiWilder,
  crossEvents,
  computeSqueezeMomentum,
  findPivots,
  findDivergences,
} from "../indicators.mjs";

const RSI_LEN = 14;
const BUY_LEVEL = 30;
const SELL_LEVEL = 70;

const SQZ = { length: 20, mult: 2, lengthKC: 20, multKC: 1.5 };
const PIVOT_LEN = 5;
const DIV_RANGE_MIN = 5;
const DIV_RANGE_MAX = 60;

export function findSignals(candles) {
  console.log("Llaves del objeto candles:", Object.keys(candles));
  const { high, low, close } = candles;
  
  // Extrae el array de tiempo sin importar cómo lo devuelva el proveedor de datos
  const timeArray =
    candles.openTime ||
    candles.time ||
    candles.timestamp ||
    candles.timestamps ||
    candles.datetime ||
    [];

  // Helper para obtener el tiempo o el índice si no hay array de tiempo
  const getBarTime = (i) => (timeArray && timeArray[i] !== undefined ? timeArray[i] : i);

  const signals = [];

  // 1. RSI
  const rsi = rsiWilder(close, RSI_LEN);
  const { crossover: rsiBuy } = crossEvents(rsi, BUY_LEVEL);
  const { crossunder: rsiSell } = crossEvents(rsi, SELL_LEVEL);

  for (let i = 0; i < close.length; i++) {
    if (rsiBuy[i]) {
      signals.push({ signal: "rsi_buy", side: "LONG", idx: i, barTime: getBarTime(i) });
    }
    if (rsiSell[i]) {
      signals.push({ signal: "rsi_sell", side: "SHORT", idx: i, barTime: getBarTime(i) });
    }
  }

  // 2. Squeeze Momentum Divergences
  const { val } = computeSqueezeMomentum(high, low, close, SQZ);
  const pivots = findPivots(val, PIVOT_LEN, PIVOT_LEN);

  const { bullish, bearish } = findDivergences(
    pivots,
    { highPrices: high, lowPrices: low },
    { divRangeMin: DIV_RANGE_MIN, divRangeMax: DIV_RANGE_MAX }
  );

  for (const d of bullish) {
    const signalIdx = d.idx + PIVOT_LEN;
    if (signalIdx < close.length) {
      signals.push({
        signal: "div_bull",
        side: "LONG",
        idx: signalIdx,
        barTime: getBarTime(signalIdx),
      });
    }
  }

  for (const d of bearish) {
    const signalIdx = d.idx + PIVOT_LEN;
    if (signalIdx < close.length) {
      signals.push({
        signal: "div_bear",
        side: "SHORT",
        idx: signalIdx,
        barTime: getBarTime(signalIdx),
      });
    }
  }

  return signals.sort((a, b) => a.barTime - b.barTime);
}