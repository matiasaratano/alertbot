import {
  rsiWilder,
  crossEvents,
  computeSqueezeMomentum,
  findPivots,
  findDivergences,
} from "./indicators.mjs";

// Generamos 200 velas sintéticas con una onda + ruido, para tener
// movimiento suficiente como para disparar cruces de RSI y pivots.
const n = 200;
const closes = [];
const highs = [];
const lows = [];
let price = 100;
for (let i = 0; i < n; i++) {
  const wave = Math.sin(i / 8) * 5;
  const noise = (Math.sin(i * 12.9) * 0.5); // determinístico, no random
  price = 100 + wave + noise + i * 0.02;
  closes.push(price);
  highs.push(price + 0.8);
  lows.push(price - 0.8);
}

const rsi = rsiWilder(closes, 14);
const { crossover, crossunder } = crossEvents(rsi, 30);
const { crossover: crossOver70, crossunder: crossUnder70 } = crossEvents(rsi, 70);

console.log("RSI últimos 5:", rsi.slice(-5).map((v) => v?.toFixed(2)));
console.log("Cruces BUY (RSI>30):", crossover.filter(Boolean).length);
console.log("Cruces SELL (RSI<70):", crossUnder70.filter(Boolean).length);

const { val, sqzOn, sqzOff } = computeSqueezeMomentum(highs, lows, closes, {
  length: 20, mult: 2.0, lengthKC: 20, multKC: 1.5,
});
console.log("val últimos 5:", val.slice(-5).map((v) => v?.toFixed(3)));
console.log("sqzOn en algún punto:", sqzOn.includes(true), "sqzOff en algún punto:", sqzOff.includes(true));

const pivots = findPivots(val, 5, 5);
console.log("Pivots altos encontrados:", pivots.highs.length, "Pivots bajos:", pivots.lows.length);

const divs = findDivergences(pivots, { highPrices: highs, lowPrices: lows }, { divRangeMin: 5, divRangeMax: 60 });
console.log("Divergencias bajistas:", divs.bearish.length, "Divergencias alcistas:", divs.bullish.length);

console.log("\nOK: todas las funciones corrieron sin errores.");
