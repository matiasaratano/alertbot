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
const CRYPTO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]; // ticker de Binance
const STOCK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "MELI", "GOOGL", "AMZN", "META"]; // ticker de Twelve Data
const TIMEFRAMES = ["1h", "4h", "1d"];

// mismos parámetros que el Pine Script original
const RSI_LEN = 14;
const BUY_LEVEL = 30;
const SELL_LEVEL = 70;
const SQZ = { length: 20, mult: 2.0, lengthKC: 20, multKC: 1.5 };
const PIVOT_LEN = 5;
const DIV_RANGE_MIN = 5;
const DIV_RANGE_MAX = 60;

// Señales más antiguas que esto se descartan siempre, sin importar el watermark.
// Evita que señales de hace meses lleguen si el state.json quedó desactualizado.
const MAX_AGE_BY_TF = {
  "1h":  7 * 24 * 60 * 60 * 1000,  //  7 días
  "4h": 14 * 24 * 60 * 60 * 1000,  // 14 días
  "1d": 30 * 24 * 60 * 60 * 1000,  // 30 días
};

// Duración de cada vela en ms (para calcular cuántas barras mirar atrás en RSI)
const TF_MS_SCAN = {
  "1h":      60 * 60 * 1000,
  "4h":  4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

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

  // --- RSI buy/sell: revisamos el historial reciente (dentro de MAX_AGE_BY_TF),
  // con un margen extra de barras para que el RMA de Wilder esté estabilizado.
  // Seguimos calculando el RSI sobre todo el array para que el warmup sea correcto,
  // pero solo buscamos cruces en la ventana temporal relevante.
  const rsi = rsiWilder(close, RSI_LEN);
  const { crossover: rsiBuy } = crossEvents(rsi, BUY_LEVEL);
  const { crossunder: rsiSell } = crossEvents(rsi, SELL_LEVEL);

  const maxAgeBars = MAX_AGE_BY_TF[tf]
    ? Math.ceil(MAX_AGE_BY_TF[tf] / (TF_MS_SCAN[tf] || 60 * 60 * 1000)) + 5
    : close.length;
  const rsiStart = Math.max(RSI_LEN + 1, close.length - maxAgeBars);

  for (let i = rsiStart; i < close.length; i++) {
    if (rsiBuy[i]) {
      events.push({ signal: "rsi_buy", idx: i, text: `🟢 BUY (RSI) — cruzó por encima de ${BUY_LEVEL}. RSI=${rsi[i].toFixed(1)}` });
    }
    if (rsiSell[i]) {
      events.push({ signal: "rsi_sell", idx: i, text: `🔴 SELL (RSI) — cruzó por debajo de ${SELL_LEVEL}. RSI=${rsi[i].toFixed(1)}` });
    }
  }

  // --- SQZMOM + divergencias: calculamos sobre todo el historial para que los
  // pivots sean correctos, pero solo emitimos eventos dentro de MAX_AGE_BY_TF
  // (consistente con el filtro RSI y con processEvents).
  const { val } = computeSqueezeMomentum(high, low, close, SQZ);
  const pivots = findPivots(val, PIVOT_LEN, PIVOT_LEN);
  const { bullish, bearish } = findDivergences(
    pivots,
    { highPrices: high, lowPrices: low },
    { divRangeMin: DIV_RANGE_MIN, divRangeMax: DIV_RANGE_MAX }
  );

  const maxAge = MAX_AGE_BY_TF[tf] ?? Infinity;
  const nowMs = Date.now();

  for (const d of bullish) {
    const barTime = openTime[d.idx];
    if (nowMs - barTime <= maxAge)
      events.push({ signal: "div_bull", idx: d.idx, text: `📈 Divergencia ALCISTA de Momentum` });
  }
  for (const d of bearish) {
    const barTime = openTime[d.idx];
    if (nowMs - barTime <= maxAge)
      events.push({ signal: "div_bear", idx: d.idx, text: `📉 Divergencia BAJISTA de Momentum` });
  }

  return events
    .map((e) => ({ ...e, barTime: openTime[e.idx] }))
    .sort((a, b) => a.barTime - b.barTime);
}

const MAX_ALERTS_PER_KEY_PER_RUN = 3; // tope de seguridad anti-inundación

function processEvents(state, symbol, tf, events) {
  // snapshot: qué claves ya existían ANTES de esta corrida (bootstrap real)
  const wasKnown = {};
  const maxSeen = {};

  for (const ev of events) {
    const key = stateKey(symbol, tf, ev.signal);
    if (!(key in wasKnown)) wasKnown[key] = state[key] !== undefined;
    maxSeen[key] = Math.max(maxSeen[key] ?? -Infinity, ev.barTime);
  }

  const sentThisRun = {};
  const accepted = [];
  const now = Date.now();
  const maxAge = MAX_AGE_BY_TF[tf] ?? Infinity;

  for (const ev of events) {
    const key = stateKey(symbol, tf, ev.signal);
    const barIso = new Date(ev.barTime).toISOString();

    // Filtro 1: señal demasiado antigua — descartamos sin importar el watermark
    const age = now - ev.barTime;
    if (age > maxAge) {
      console.log(`[SKIP OLD]  ${key} barTime=${barIso} age=${Math.round(age / 86400000)}d`);
      continue;
    }

    // Filtro 2: clave nueva (primer bootstrap) — no mandamos historial, solo marcamos
    if (!wasKnown[key]) {
      console.log(`[SKIP NEW]  ${key} barTime=${barIso} (clave nueva, sin historial previo)`);
      continue;
    }

    // Filtro 3: ya avisada en una corrida anterior
    const watermark = state[key];
    const wmIso = watermark != null ? new Date(watermark).toISOString() : "ninguno";
    if (ev.barTime <= watermark) {
      console.log(`[SKIP DUP]  ${key} barTime=${barIso} watermark=${wmIso}`);
      continue;
    }

    // Filtro 4: tope de seguridad anti-inundación
    sentThisRun[key] = (sentThisRun[key] ?? 0) + 1;
    if (sentThisRun[key] > MAX_ALERTS_PER_KEY_PER_RUN) {
      console.log(`[SKIP FLOOD] ${key} barTime=${barIso} (límite ${MAX_ALERTS_PER_KEY_PER_RUN}/corrida)`);
      continue;
    }

    console.log(`[SEND]      ${key} barTime=${barIso} watermark=${wmIso}`);
    accepted.push(ev);
  }

  for (const key of Object.keys(maxSeen)) {
    state[key] = Math.max(state[key] ?? -Infinity, maxSeen[key]);
  }

  return accepted;
}

// símbolo -> ticker de Kraken en TradingView, para armar el link directo
const TV_CRYPTO_SYMBOL = {
  BTCUSDT: "KRAKEN:BTCUSD",
  ETHUSDT: "KRAKEN:ETHUSD",
  SOLUSDT: "KRAKEN:SOLUSD",
  BNBUSDT: "KRAKEN:BNBUSD",
};
const TV_INTERVAL = { "1h": "60", "4h": "240", "1d": "D" };

function tradingViewLink(symbol, tf, isCrypto) {
  const tvSymbol = isCrypto ? TV_CRYPTO_SYMBOL[symbol] || symbol : symbol;
  const interval = TV_INTERVAL[tf] || "60";
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}&interval=${interval}`;
}

// temporalidad -> cuánto la resaltamos en el mensaje
function tfEmphasis(tf) {
  if (tf === "1d") return "🔥🔥 DIARIO — ";
  if (tf === "4h") return "⭐ ";
  return "";
}

// para dar contexto de tendencia mayor: qué temporalidad mirar por encima de cada una
const HIGHER_TF = { "1h": "4h", "4h": "1d" }; // 1d no tiene una mayor configurada

async function higherTfContext(symbol, tf, isCrypto) {
  const higherTf = HIGHER_TF[tf];
  if (!higherTf) return null;
  try {
    // Solo necesitamos el último valor del RSI: con 30 velas el RMA de Wilder
    // ya está bien estabilizado (RSI_LEN=14, warmup ~20 barras).
    const candles = isCrypto
      ? await fetchKrakenKlines(symbol, higherTf, 30)
      : await fetchTwelveDataSeries(symbol, higherTf, TWELVEDATA_API_KEY, 30);
    const rsi = rsiWilder(candles.close, RSI_LEN);
    const lastRsi = rsi[rsi.length - 1];
    if (lastRsi == null) return null;

    let bias;
    if (lastRsi >= SELL_LEVEL) bias = "sobrecomprado";
    else if (lastRsi <= BUY_LEVEL) bias = "sobrevendido";
    else if (lastRsi > 50) bias = "sesgo alcista";
    else bias = "sesgo bajista";

    return `📊 Contexto ${higherTf}: RSI=${lastRsi.toFixed(1)} (${bias})`;
  } catch (err) {
    console.error(`  No se pudo obtener contexto ${higherTf} de ${symbol}:`, err.message);
    return null;
  }
}

function formatBarDate(barTime) {
  return new Date(barTime).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function composeMessage(symbol, tf, ev, isCrypto) {
  const lines = [
    `${tfEmphasis(tf)}${ev.text}`,
    `<b>${symbol}</b> · ${tf}`,
    `🕒 Vela: ${formatBarDate(ev.barTime)} (ART)`,
    `📬 Detectada: ${formatBarDate(Date.now())} (ART)`,
  ];

  const context = await higherTfContext(symbol, tf, isCrypto);
  if (context) lines.push(context);

  lines.push(tradingViewLink(symbol, tf, isCrypto));

  return lines.join("\n");
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
        const accepted = processEvents(state, symbol, tf, events);
        for (const ev of accepted) {
          messages.push(await composeMessage(symbol, tf, ev, true));
        }
      } catch (err) {
        console.error(`Error con ${symbol} ${tf}:`, err.message);
      }
    }
  }

  if (TWELVEDATA_API_KEY) {
    console.log(`Hora UTC actual: ${now.toISOString()}`);
    for (const tf of TIMEFRAMES) {
      if (!isStockTimeframeDue(tf, state, now.getTime())) {
        console.log(`  [stocks ${tf}]: salteado (todavía no pasó el intervalo desde el último chequeo)`);
        continue;
      }
      for (const symbol of STOCK_SYMBOLS) {
        try {
          const candles = await fetchTwelveDataSeries(symbol, tf, TWELVEDATA_API_KEY, 300);
          console.log(`  ${symbol} ${tf}: ${candles.close.length} velas obtenidas`);
          const events = await analyzeSymbol(symbol, tf, candles);
          const accepted = processEvents(state, symbol, tf, events);
          if (accepted.length > 0) {
            console.log(`  ${symbol} ${tf}: ${accepted.length} señal(es) nueva(s)`);
          }
          for (const ev of accepted) {
            messages.push(await composeMessage(symbol, tf, ev, false));
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

  // heartbeat: el watchdog usa esto para saber si el bot sigue corriendo solo
  fs.writeFileSync(
    new URL("./heartbeat.json", import.meta.url),
    JSON.stringify({ lastRun: new Date().toISOString(), alertsSent: messages.length }, null, 2)
  );

  console.log(`Listo. ${messages.length} alerta(s) enviada(s).`);
}

run().catch((err) => {
  console.error("Fallo la corrida:", err);
  process.exit(1);
});
