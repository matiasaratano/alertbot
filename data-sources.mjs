// data-sources.mjs
// Devuelven siempre el mismo formato: { openTime:[], high:[], low:[], close:[] }
// y garantizan que la ÚLTIMA vela devuelta esté CERRADA (se descarta la vela
// en formación si el candle actual todavía no cerró).

const BINANCE_INTERVAL = {
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
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

export async function fetchBinanceKlines(symbol, tf, limit = 300) {
  const interval = BINANCE_INTERVAL[tf];
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${symbol} ${tf}: HTTP ${res.status}`);
  const data = await res.json();
  const openTime = data.map((k) => k[0]);
  const high = data.map((k) => parseFloat(k[2]));
  const low = data.map((k) => parseFloat(k[3]));
  const close = data.map((k) => parseFloat(k[4]));
  return dropUnclosedCandle(openTime, { high, low, close }, tf);
}

export async function fetchTwelveDataSeries(symbol, tf, apiKey, outputsize = 300) {
  const interval = TWELVEDATA_INTERVAL[tf];
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&order=ASC`;
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
// más, esta función decide si CONVIENE pedir esta temporalidad ahora mismo
// (solo cuando una vela de ese TF recién pudo haber cerrado), en vez de
// pedirla en cada corrida del cron.
export function isStockTimeframeDue(tf, now = new Date()) {
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const toleranceMin = 8; // el cron corre cada 15 min, damos margen

  if (tf === "15m") return true; // siempre, es la cadencia del propio cron
  if (tf === "1h") return minute <= toleranceMin;
  if (tf === "4h") return hour % 4 === 0 && minute <= toleranceMin;
  if (tf === "1d") return hour === 20 && minute <= toleranceMin; // ~cierre NYSE (16:00 ET)
  return true;
}
