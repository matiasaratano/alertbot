// data-sources.mjs
// Devuelven siempre el mismo formato: { openTime:[], high:[], low:[], close:[] }
// y garantizan que la ÚLTIMA vela devuelta esté CERRADA (se descarta la vela
// en formación si el candle actual todavía no cerró).

const KRAKEN_INTERVAL = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

// Kraken usa nombres de par propios (XBT en vez de BTC, cotizado en USD).
// Si sumás más cryptos a CRYPTO_SYMBOLS en scan.mjs, agregá su par acá.
const KRAKEN_PAIR = {
  BTCUSDT: "XBTUSD",
  ETHUSDT: "ETHUSD",
  SOLUSDT: "SOLUSD",
  BNBUSDT: "BNBUSD",
};

const TWELVEDATA_INTERVAL = {
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};

// cuánto dura cada vela en ms, para saber si la última está cerrada
const TF_MS = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

function dropUnclosedCandle(openTimes, arrays, tf) {
  const n = openTimes.length;
  if (n === 0) return { openTime: openTimes, ...arrays };
  const lastOpen = openTimes[n - 1];
  const lastClose = lastOpen + TF_MS[tf];
  if (lastClose > Date.now()) {
    // la última vela todavía no cerró: la recortamos
    const trimmed = { openTime: openTimes.slice(0, -1) };
    for (const k of Object.keys(arrays)) trimmed[k] = arrays[k].slice(0, -1);
    return trimmed;
  }
  return { openTime: openTimes, ...arrays };
}

export async function fetchKrakenKlines(symbol, tf, limit = 300) {
  const pair = KRAKEN_PAIR[symbol] || symbol;
  const interval = KRAKEN_INTERVAL[tf];
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kraken ${symbol} ${tf}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error && data.error.length) {
    throw new Error(`Kraken ${symbol} ${tf}: ${data.error.join(", ")}`);
  }
  const resultKey = Object.keys(data.result).find((k) => k !== "last");
  const rows = (data.result[resultKey] || []).slice(-limit);
  const openTime = rows.map((r) => r[0] * 1000); // Kraken da segundos, pasamos a ms
  const high = rows.map((r) => parseFloat(r[2]));
  const low = rows.map((r) => parseFloat(r[3]));
  const close = rows.map((r) => parseFloat(r[4]));
  return dropUnclosedCandle(openTime, { high, low, close }, tf);
}

export async function fetchTwelveDataSeries(symbol, tf, apiKey, outputsize = 300) {
  const interval = TWELVEDATA_INTERVAL[tf];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&outputsize=${outputsize}&timezone=UTC&apikey=${apiKey}&order=ASC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData ${symbol} ${tf}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === "error") {
    throw new Error(`TwelveData ${symbol} ${tf}: ${data.message}`);
  }
  const values = data.values || [];
  const openTime = values.map((v) => new Date(v.datetime + "Z").getTime());
  const high = values.map((v) => parseFloat(v.high));
  const low = values.map((v) => parseFloat(v.low));
  const close = values.map((v) => parseFloat(v.close));
  return dropUnclosedCandle(openTime, { high, low, close }, tf);
}

// Twelve Data free tier: 800 créditos/día, 8 req/min. Para no gastarlos de
// más, en vez de atarnos al minuto exacto del reloj (frágil si el cron de
// GitHub arranca con atraso), guardamos en el estado CUÁNDO fue la última
// vez que efectivamente chequeamos cada temporalidad, y disparamos apenas
// pasó suficiente tiempo real — sin importar en qué minuto cae el tick.
const STOCK_CHECK_INTERVAL_MS = {
  "1h": 55 * 60 * 1000, // ~55 min: se dispara en cuanto puede, con margen
  "4h": (4 * 60 - 10) * 60 * 1000,
  "1d": (24 * 60 - 10) * 60 * 1000,
};

export function isStockTimeframeDue(tf, state, now = Date.now()) {
  const interval = STOCK_CHECK_INTERVAL_MS[tf];
  if (!interval) return true; // temporalidad sin límite especial (ej. 15m)

  const key = `_stockCheck:${tf}`;
  const lastCheck = state[key] ?? 0;
  if (now - lastCheck < interval) return false;

  state[key] = now; // se marca al decidir que sí toca, no al terminar
  return true;
}
