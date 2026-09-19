// Estos valores deben coincidir con los inputs del Pine y con el gráfico.
export const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD'];
export const STOCK_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'MELI', 'GOOGL', 'AMZN', 'META'];
export const TIMEFRAMES = ['4h', '1d', '1w'];
export const TF_MS = { '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000 };
export const SIGNALS = ['rsi_buy', 'rsi_sell', 'div_bull', 'div_bear', 'pre_bull', 'pre_bear', 'important_bull', 'important_bear', 'early_bull', 'early_bear', 'setup_bull', 'setup_bear'];
export const INDICATOR = {
  rsiLen: 14, buyLevel: 30, sellLevel: 70,
  sqz: { length: 20, mult: 2, lengthKC: 20, multKC: 1.5 },
  pivotLen: 5, divRangeMin: 5, divRangeMax: 60,
  // Parámetros de v7 conservados para la auditoría; v8 usa SETUP en setups.mjs.
  confluenceWindow: 8, minimumScore: 2, signalCooldown: 8,
  useEmaFilter: true, emaLength: 200,
};
export const HISTORY = 700;
// Margen para que el proveedor publique la vela cerrada.
export const SETTLEMENT_MS = 60000;
// Recuperación: tres horas entre ejecuciones más una hora de margen.
export function maxAlertDelayMs() {
  const minutes = Number(process.env.MAX_ALERT_DELAY_MINUTES ?? 240);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('MAX_ALERT_DELAY_MINUTES inválido');
  return minutes * 60000;
}

// Política v7 conservada para auditorías y regresiones. v8 usa selectSetups.
export const ALERT_POLICY = {
  '1h': { minimumScore: 3, requireDivergence: true, standaloneDivergences: false },
  '4h': { minimumScore: 2, requireDivergence: true, standaloneDivergences: false },
  '1d': { minimumScore: 2, requireDivergence: false, standaloneDivergences: false },
};
export const NOTIFICATION_COOLDOWN_BARS = 8;

export const EARLY_TIMEFRAMES = ['4h', '1d'];

// Telegram v9: 4h, diario y semanal. Marcos menores solo para auditorías.
