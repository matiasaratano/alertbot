// Activos y parámetros del scanner. Cripto: Kraken (USD). Acciones/ETFs: Twelve Data.
export const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD'];
export const STOCK_SYMBOLS = [
  // Pedidos
  'NU', 'MELI', 'NFLX', 'MSFT', 'GOOGL', 'TSLA', 'NVDA', 'AVGO', 'KO', 'MSTR', 'MU', 'AMD', 'INTC', 'AAPL',
  // Agregados: grandes del índice, semis, finanzas, salud, consumo y dos ETFs de referencia
  'AMZN', 'META', 'TSM', 'PLTR', 'JPM', 'V', 'LLY', 'COST', 'SPY', 'QQQ',
];
export const TIMEFRAMES = ['1d', '1w'];
export const TF_MS = { '1d': 86400000, '1w': 604800000 };

export const RSI = {
  length: 14,
  oversold: 30, overbought: 70, // cruce de salida de zona
  extremeLow: 20, extremeHigh: 80, // cruce de entrada a zona extrema
  nearLow: 35, nearHigh: 65, // "cerca de zona" en el resumen semanal
};
// Divergencia RSI: extremo de las últimas `lookback` velas contra el pivot de precio anterior.
export const DIVERGENCE = { pivotLen: 5, rangeMin: 5, rangeMax: 60, lookback: 10 };
// Medias de contexto. Se informa la distancia del precio y si la EMA200 sube o baja
// (comparada con 20 velas atrás). "Cerca" = a menos de EMA_NEAR_PCT %.
export const EMA_LENGTHS = [50, 200];
export const EMA_SLOPE_BARS = 20;
export const EMA_NEAR_PCT = 3;
export const HISTORY = 700;
// Margen para que el proveedor publique la vela cerrada.
export const SETTLEMENT_MS = 60000;

// Ventana de recuperación: el cron corre una vez por día; 72 h cubren un día perdido
// y el fin de semana de las acciones.
export function maxAlertDelayMs() {
  const minutes = Number(process.env.MAX_ALERT_DELAY_MINUTES ?? 4320);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('MAX_ALERT_DELAY_MINUTES inválido');
  return minutes * 60000;
}
