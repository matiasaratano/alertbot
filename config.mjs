// Estos valores deben coincidir con los inputs del Pine y con el gráfico.
export const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD'];
export const STOCK_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'MELI', 'GOOGL', 'AMZN', 'META'];
export const TIMEFRAMES = ['1h', '4h', '1d'];
export const TF_MS = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
export const SIGNALS = ['rsi_buy', 'rsi_sell', 'div_bull', 'div_bear', 'pre_bull', 'pre_bear'];
export const INDICATOR = {
  rsiLen: 14, buyLevel: 30, sellLevel: 70,
  sqz: { length: 20, mult: 2, lengthKC: 20, multKC: 1.5 },
  pivotLen: 5, divRangeMin: 5, divRangeMax: 60,
};
export const HISTORY = 500;
// Margen para que el proveedor publique la vela cerrada.
export const SETTLEMENT_MS = 60000;
export function maxAlertDelayMs() {
  const minutes = Number(process.env.MAX_ALERT_DELAY_MINUTES ?? 120);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('MAX_ALERT_DELAY_MINUTES inválido');
  return minutes * 60000;
}

// turn: giro de una vela cerrada; confirmed: pivots de cinco barras; both: ambos.
export const DIVERGENCE_MODE = 'turn';
