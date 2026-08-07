import fs from "fs";
import {
  rsiWilder,
  crossEvents,
  computeSqueezeMomentum,
  findPivots,
  findDivergences,
} from "./indicators.mjs";
import { fetchKrakenKlines, fetchTwelveDataSeries, isStockTimeframeDue } from "./data-sources.mjs";
import { sendTelegram } from "./telegram.mjs";

// ============================================================
// CONFIGURÁ ACÁ TUS SÍMBOLOS Y TEMPORALIDADES
// ============================================================
const CRYPTO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]; // ticker de Binance
const STOCK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "MELI", "GOOGL", "AMZN"]; // ticker de Twelve Data
const TIMEFRAMES = ["1h", "4h", "1d"];

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

  // --- RSI buy/sell: revisamos TODO el historial, no solo la última vela,
  // para no perder cruces que hayan ocurrido mientras el bot no corrió ---
  const rsi = rsiWilder(close, RSI_LEN);
  const { crossover: rsiBuy } = crossEvents(rsi, BUY_LEVEL);
  const { crossunder: rsiSell } = crossEvents(rsi, SELL_LEVEL);
  for (let i = 0; i < close.length; i++) {
    if (rsiBuy[i]) {
      events.push({ signal: "rsi_buy", idx: i, text: `🟢 BUY (RSI) — cruzó por encima de ${BUY_LEVEL}. RSI=${rsi[i].toFixed(1)}` });
    }
    if (rsiSell[i]) {
      events.push({ signal: "rsi_sell", idx: i, text: `🔴 SELL (RSI) — cruzó por debajo de ${SELL_LEVEL}. RSI=${rsi[i].toFixed(1)}` });
    }
  }

  // --- SQZMOM + divergencias: idem, tomamos TODAS las confirmadas en el
  // historial disponible; el filtro de "ya avisada" lo hace el estado ---
  const { val } = computeSqueezeMomentum(high, low, close, SQZ);
  const pivots = findPivots(val, PIVOT_LEN, PIVOT_LEN);
  const { bullish, bearish } = findDivergences(
    pivots,
    { highPrices: high, lowPrices: low },
    { divRangeMin: DIV_RANGE_MIN, divRangeMax: DIV_RANGE_MAX }
  );

  for (const d of bullish) {
    events.push({ signal: "div_bull", idx: d.idx, text: `📈 Divergencia ALCISTA de Momentum` });
  }
  for (const d of bearish) {
    events.push({ signal: "div_bear", idx: d.idx, text: `📉 Divergencia BAJISTA de Momentum` });
  }

  return events
    .map((e) => ({ ...e, barTime: openTime[e.idx] }))
    .sort((a, b) => a.barTime - b.barTime);
}

const MAX_ALERTS_PER_KEY_PER_RUN = 3; // tope de seguridad anti-inundación

function processEvents(state, symbol, tf, events, messages) {
  // snapshot: qué claves ya existían ANTES de esta corrida (bootstrap real)
  const wasKnown = {};
  const maxSeen = {};

  for (const ev of events) {
    const key = stateKey(symbol, tf, ev.signal);
    if (!(key in wasKnown)) wasKnown[key] = state[key] !== undefined;
    maxSeen[key] = Math.max(maxSeen[key] ?? -Infinity, ev.barTime);
  }

  const sentThisRun = {};

  for (const ev of events) {
    const key = stateKey(symbol, tf, ev.signal);

    if (!wasKnown[key]) continue; // clave nueva: no mandamos historial, solo marcamos

    const watermark = state[key];
    if (ev.barTime <= watermark) continue; // ya avisada en una corrida anterior

    sentThisRun[key] = (sentThisRun[key] ?? 0) + 1;
    if (sentThisRun[key] > MAX_ALERTS_PER_KEY_PER_RUN) continue; // tope de seguridad

    messages.push(`${ev.text}\n<b>${symbol}</b> · ${tf}`);
  }

  for (const key of Object.keys(maxSeen)) {
    state[key] = Math.max(state[key] ?? -Infinity, maxSeen[key]);
  }
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
        const candles = await fetchKrakenKlines(symbol, tf, 300);
        const events = await analyzeSymbol(symbol, tf, candles);
        processEvents(state, symbol, tf, events, messages);
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
          processEvents(state, symbol, tf, events, messages);
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
