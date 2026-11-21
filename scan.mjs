import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSignals, pendingEvents, deliverEvents, signalMessage, weeklySummary } from './signals.mjs';
import { fetchKrakenKlines, fetchTwelveDataSeries } from './data-sources.mjs';
import { latestStockClose, latestCryptoClose } from './market-calendar.mjs';
import { sendTelegram } from './telegram.mjs';
import { CRYPTO_SYMBOLS, STOCK_SYMBOLS, TIMEFRAMES, RSI, HISTORY, maxAlertDelayMs } from './config.mjs';

const STATE_FILE = new URL('./state.json', import.meta.url);
// Claves vigentes. El resto (versiones anteriores, 4h, activos quitados) se descarta al cargar.
const CURRENT_KEY = /^(rsi|_rsi|_rsiAt|_checked):[A-Z.]+:(1d|1w)(:|$)|^_summaryWeek$/;

export function pruneState(raw) {
  const state = {};
  for (const [key, value] of Object.entries(raw)) {
    // Migración: los cruces v9 de 1d/1w conservan su deduplicación. Los cierres revisados no:
    // así la primera corrida descarga todo y llena el RSI del resumen.
    const migrated = key.replace(/^v9:/, 'rsi:');
    if (CURRENT_KEY.test(migrated)) state[migrated] = Math.max(state[migrated] ?? -Infinity, value);
  }
  return state;
}
export function loadState(path = STATE_FILE) {
  try {
    const state = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)
      || Object.values(state).some(value => !Number.isFinite(value))) throw new Error('state.json inválido: se requiere un objeto de timestamps');
    return pruneState(state);
  } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
export function saveState(state, path = STATE_FILE) {
  const temp = new URL('./state.json.tmp', path);
  const sorted = Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(temp, JSON.stringify(sorted, null, 2) + '\n');
  fs.renameSync(temp, path);
}

export async function scanMarkets({ state, persist, send, clock = Date.now,
  cryptoFetch = fetchKrakenKlines, stockFetch = fetchTwelveDataSeries, stockKey,
  cryptoSymbols = CRYPTO_SYMBOLS, stockSymbols = STOCK_SYMBOLS, timeframes = TIMEFRAMES }) {
  const errors = [], maxDelay = maxAlertDelayMs();
  let alertsSent = 0, checked = 0;
  const targets = [];
  for (const tf of timeframes) {
    for (const symbol of cryptoSymbols) targets.push({ symbol, tf, crypto: true });
    if (stockKey) for (const symbol of stockSymbols) targets.push({ symbol, tf, crypto: false });
  }
  for (const { symbol, tf, crypto } of targets) {
    try {
      const now = clock();
      const target = crypto ? latestCryptoClose(tf, now) : latestStockClose(tf, now);
      const checkKey = `_checked:${symbol}:${tf}`;
      // Ya revisado este cierre: no hace falta pedir datos.
      if ((state[checkKey] ?? 0) >= target) continue;
      const candles = crypto ? await cryptoFetch(symbol, tf, HISTORY) : await stockFetch(symbol, tf, stockKey, HISTORY);
      if (candles.close.length < RSI.length + 2) throw new Error('Historial insuficiente para RSI');
      const { events, lastRsi } = buildSignals(candles);
      state[`_rsi:${symbol}:${tf}`] = Number(lastRsi.toFixed(2));
      state[`_rsiAt:${symbol}:${tf}`] = candles.closeTime.at(-1);
      const accepted = pendingEvents(state, symbol, tf, events, clock(), maxDelay);
      await deliverEvents(state, symbol, tf, accepted, async ev => {
        await send(signalMessage(symbol, tf, ev, clock())); alertsSent++;
      }, persist);
      // Si el proveedor todavía no publicó el cierre esperado, se reintenta en la próxima corrida.
      const actual = candles.closeTime.at(-1);
      if (actual < target) throw new Error(`Proveedor atrasado: último cierre ${new Date(actual).toISOString()}, esperado ${new Date(target).toISOString()}`);
      state[checkKey] = target; persist(state); checked++;
    } catch (error) {
      const message = `${symbol} ${tf}: ${error.message}`;
      errors.push(message); console.error(message);
    }
  }
  // Resumen una vez por semana, después del cierre semanal cripto (lunes 00:00 UTC).
  const week = latestCryptoClose('1w', clock());
  let summarySent = false;
  if ((state._summaryWeek ?? 0) < week) {
    try {
      await send(weeklySummary(state, [...cryptoSymbols, ...(stockKey ? stockSymbols : [])], clock()));
      state._summaryWeek = week; persist(state); summarySent = true;
    } catch (error) { errors.push(`Resumen semanal: ${error.message}`); console.error(error.message); }
  }
  return { alertsSent, checked, summarySent, healthy: errors.length === 0, errors };
}

export async function run() {
  const token = process.env.TELEGRAM_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun && (!token || !chat)) throw new Error('Faltan TELEGRAM_TOKEN / TELEGRAM_CHAT_ID');
  if (!process.env.TWELVEDATA_API_KEY) console.warn('Sin TWELVEDATA_API_KEY: solo se revisan cripto.');
  const state = loadState();
  const result = await scanMarkets({
    state,
    persist: dryRun ? () => {} : saveState,
    send: dryRun ? async text => console.log('[SIMULADO]\n' + text + '\n') : text => sendTelegram(token, chat, text),
    stockKey: process.env.TWELVEDATA_API_KEY,
  });
  if (!dryRun) saveState(state);
  console.log(`${dryRun ? 'Simulación' : 'Listo'}: ${result.checked} chequeos, ${result.alertsSent} alertas${result.summarySent ? ', resumen semanal enviado' : ''}.`);
  if (!result.healthy) throw new Error(`${result.errors.length} chequeos fallaron; ver logs`);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
