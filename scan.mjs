import fs from "fs";
import {
  rsiWilder,
  crossEvents,
  computeSqueezeMomentum,
  findPivots,
  findDivergences,
} from "./indicators.mjs";
import { fetchBinanceKlines, fetchTwelveDataSeries, isStockTimeframeDue } from "./data-sources.mjs";
import { sendTelegram } from "./telegram.mjs";

// ============================================================
// CONFIGURÁ ACÁ TUS SÍMBOLOS Y TEMPORALIDADES
// ============================================================
const CRYPTO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]; // ticker de Binance
const STOCK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "MELI", "GOOGL", "AMZN"]; // ticker de Twelve Data
const TIMEFRAMES = ["15m", "1h", "4h", "1d"];

// mismos parámetros que el Pine Script original
const RSI_LEN = 14;
const BUY_LEVEL = 30;
const SELL_LEVEL = 70;
const SQZ = { length: 20, mult: 2.0, lengthKC: 20, multKC: 1.5 };
const PIVOT_LEN = 5;
const DIV_RANGE_MIN = 5;
const DIV_RANGE_MAX = 60;

const STATE_PATH = new URL("./state.json", import.meta.url);

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function stateKey(symbol, tf, signal) {
  return `${symbol}:${tf}:${signal}`;
}

async function analyzeSymbol(symbol, tf, candles) {
  const { openTime, high, low, close } = candles;
  if (close.length < SQZ.lengthKC + PIVOT_LEN * 2 + DIV_RANGE_MAX) {
    console.warn(`  ${symbol} ${tf}: historial insuficiente (${close.length} velas), se salta`);
    return [];
  }

  const events = [];
  const lastIdx = close.length - 1;

  // --- RSI buy/sell ---
  const rsi = rsiWilder(close, RSI_LEN);
  const { crossover: rsiBuy } = crossEvents(rsi, BUY_LEVEL);
  const { crossunder: rsiSell } = crossEvents(rsi, SELL_LEVEL);
  if (rsiBuy[lastIdx]) {
    events.push({ signal: "rsi_buy", idx: lastIdx, text: `🟢 BUY (RSI) — cruzó por encima de ${BUY_LEVEL}. RSI=${rsi[lastIdx].toFixed(1)}` });
  }
  if (rsiSell[lastIdx]) {
    events.push({ signal: "rsi_sell", idx: lastIdx, text: `🔴 SELL (RSI) — cruzó por debajo de ${SELL_LEVEL}. RSI=${rsi[lastIdx].toFixed(1)}` });
  }

  // --- SQZMOM + divergencias ---
  const { val } = computeSqueezeMomentum(high, low, close, SQZ);
  const pivots = findPivots(val, PIVOT_LEN, PIVOT_LEN);
  const { bullish, bearish } = findDivergences(
    pivots,
    { highPrices: high, lowPrices: low },
    { divRangeMin: DIV_RANGE_MIN, divRangeMax: DIV_RANGE_MAX }
  );

  // una divergencia queda "confirmada" recién PIVOT_LEN velas después del
  // pivot, así que solo nos interesan las que caen dentro de esa ventana
  // reciente (si no, ya la habríamos alertado en una corrida anterior)
  const recentBullish = bullish.filter((d) => d.idx >= lastIdx - PIVOT_LEN);
  const recentBearish = bearish.filter((d) => d.idx >= lastIdx - PIVOT_LEN);

  for (const d of recentBullish) {
    events.push({ signal: "div_bull", idx: d.idx, text: `📈 Divergencia ALCISTA de Momentum` });
  }
  for (const d of recentBearish) {
    events.push({ signal: "div_bear", idx: d.idx, text: `📉 Divergencia BAJISTA de Momentum` });
  }

  return events.map((e) => ({ ...e, barTime: openTime[e.idx] }));
}

async function run() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("Faltan TELEGRAM_TOKEN / TELEGRAM_CHAT_ID en las variables de entorno");
  }

  const state = loadState();
  const now = new Date();
  const messages = [];

  for (const symbol of CRYPTO_SYMBOLS) {
    for (const tf of TIMEFRAMES) {
      try {
        const candles = await fetchBinanceKlines(symbol, tf, 300);
        const events = await analyzeSymbol(symbol, tf, candles);
        for (const ev of events) {
          const key = stateKey(symbol, tf, ev.signal);
          if (state[key] === ev.barTime) continue; // ya avisado
          state[key] = ev.barTime;
          messages.push(`${ev.text}\n<b>${symbol}</b> · ${tf}`);
        }
      } catch (err) {
        console.error(`Error con ${symbol} ${tf}:`, err.message);
      }
    }
  }

  if (TWELVEDATA_API_KEY) {
    for (const symbol of STOCK_SYMBOLS) {
      for (const tf of TIMEFRAMES) {
        if (!isStockTimeframeDue(tf, now)) continue;
        try {
          const candles = await fetchTwelveDataSeries(symbol, tf, TWELVEDATA_API_KEY, 300);
          const events = await analyzeSymbol(symbol, tf, candles);
          for (const ev of events) {
            const key = stateKey(symbol, tf, ev.signal);
            if (state[key] === ev.barTime) continue;
            state[key] = ev.barTime;
            messages.push(`${ev.text}\n<b>${symbol}</b> · ${tf}`);
          }
        } catch (err) {
          console.error(`Error con ${symbol} ${tf}:`, err.message);
        }
      }
    }
  } else {
    console.warn("TWELVEDATA_API_KEY no configurada: se salteó el chequeo de acciones");
  }

  for (const msg of messages) {
    await sendTelegram(TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, msg);
  }

  saveState(state);
  console.log(`Listo. ${messages.length} alerta(s) enviada(s).`);
}

run().catch((err) => {
  console.error("Fallo la corrida:", err);
  process.exit(1);
});
