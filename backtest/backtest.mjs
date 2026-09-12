import fs from "fs";
import { fetchKrakenKlines, fetchTwelveDataSeries } from "../data-sources.mjs";
import { findSignals } from "./signal-engine.mjs";

const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;

const CRYPTO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];
const STOCK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "MELI", "GOOGL", "AMZN", "META"];
const TIMEFRAMES = ["1h", "4h", "1d"];

// Comisiones estimadas por operación (% por lado / maker-taker promedio)
const FEE_PCT = 0.075; 

const CONFIGS = [
  { sl: 1, tp: 1 },
  { sl: 1, tp: 2 },
  { sl: 1, tp: 3 },
  { sl: 2, tp: 2 },
  { sl: 2, tp: 4 },
  { sl: 2, tp: 6 },
  { sl: 3, tp: 3 },
  { sl: 3, tp: 6 },
  { sl: 3, tp: 9 },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function simulateTrade(candles, signal, slPct, tpPct) {
  const { high, low, close } = candles;
  
  // CORRECCIÓN: Si 'open' no viene en la API, usa 'open' o 'close' como fallback
  const openPrices = candles.open || close;

  const entryIdx = signal.idx + 1;
  if (entryIdx >= close.length) return "OPEN";

  const entry = openPrices[entryIdx];
  if (!entry) return "OPEN";

  const isLong = signal.side === "LONG";

  const tp = isLong ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);
  const sl = isLong ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);

  for (let i = entryIdx; i < close.length; i++) {
    const hitTp = isLong ? high[i] >= tp : low[i] <= tp;
    const hitSl = isLong ? low[i] <= sl : high[i] >= sl;

    if (hitTp && hitSl) return "LOSS";
    if (hitSl) return "LOSS";
    if (hitTp) return "WIN";
  }

  return "OPEN";
}

function getBucket(stats, key) {
  if (!stats[key]) {
    stats[key] = {
      wins: 0,
      losses: 0,
      open: 0,
      trades: 0,
      netR: 0,
    };
  }
  return stats[key];
}

async function processSymbol(stats, symbol, tf, candles) {
  const signals = findSignals(candles);

  for (const cfg of CONFIGS) {
    for (const signal of signals) {
      const result = simulateTrade(candles, signal, cfg.sl, cfg.tp);

      const key = `${symbol}|${tf}|${signal.signal}|${cfg.sl}|${cfg.tp}`;
      const bucket = getBucket(stats, key);

      bucket.trades++;

      // Cálculo de R considerando comisiones de entrada y salida
      const totalFeePct = FEE_PCT * 2;
      const netTpPct = cfg.tp - totalFeePct;
      const netSlPct = cfg.sl + totalFeePct;

      if (result === "WIN") {
        bucket.wins++;
        bucket.netR += netTpPct / cfg.sl;
      } else if (result === "LOSS") {
        bucket.losses++;
        bucket.netR -= netSlPct / cfg.sl;
      } else {
        bucket.open++;
      }
    }
  }
}

async function run() {
  const stats = {};

  console.log("--- Iniciando Backtest Crypto (Kraken) ---");
  for (const symbol of CRYPTO_SYMBOLS) {
    for (const tf of TIMEFRAMES) {
      try {
        console.log(`Procesando Crypto: ${symbol} ${tf}`);
        const candles = await fetchKrakenKlines(symbol, tf, 1500);
        await processSymbol(stats, symbol, tf, candles);
      } catch (err) {
        console.error(`Error en Crypto ${symbol} ${tf}:`, err.message);
      }
    }
  }

  if (TWELVEDATA_API_KEY) {
    console.log("\n--- Iniciando Backtest Stocks (TwelveData) ---");
    for (const symbol of STOCK_SYMBOLS) {
      for (const tf of TIMEFRAMES) {
        try {
          console.log(`Procesando Stock: ${symbol} ${tf}`);
          const candles = await fetchTwelveDataSeries(
            symbol,
            tf,
            TWELVEDATA_API_KEY,
            5000
          );

          await processSymbol(stats, symbol, tf, candles);
          // Pausa preventiva para no exceder rate-limit de TwelveData
          await delay(8000); 
        } catch (err) {
          console.error(`Error en Stock ${symbol} ${tf}:`, err.message);
        }
      }
    }
  } else {
    console.log("\nOmitiendo Stocks: No se definió TWELVEDATA_API_KEY.");
  }

  let csv =
    "symbol,tf,signal,sl,tp,trades,wins,losses,open,winrate,netR,expectancyR\n";

  for (const [key, s] of Object.entries(stats)) {
    const [symbol, tf, signal, sl, tp] = key.split("|");

    const resolved = s.wins + s.losses;
    const winRate = resolved === 0 ? 0 : s.wins / resolved;

    const netTpPct = Number(tp) - FEE_PCT * 2;
    const netSlPct = Number(sl) + FEE_PCT * 2;
    const rewardRatio = netTpPct / Number(sl);
    const riskRatio = netSlPct / Number(sl);

    // Expectativa matemática neta por trade expresada en R
    const expectancyR = winRate * rewardRatio - (1 - winRate) * riskRatio;

    csv +=
      [
        symbol,
        tf,
        signal,
        sl,
        tp,
        s.trades,
        s.wins,
        s.losses,
        s.open,
        winRate.toFixed(4),
        s.netR.toFixed(2),
        expectancyR.toFixed(4),
      ].join(",") + "\n";
  }

  fs.writeFileSync("backtest-results.csv", csv);
  console.log("\nBacktest finalizado. Resultados exportados a 'backtest-results.csv'.");
}

run().catch(console.error);