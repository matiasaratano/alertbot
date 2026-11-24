import test from 'node:test';
import assert from 'node:assert/strict';
import { rsiWilder, crossEvents, findPivots } from './indicators.mjs';
import { buildSignals, pendingEvents, deliverEvents, signalMessage, weeklySummary, trendSentence } from './signals.mjs';
import { scanMarkets, pruneState } from './scan.mjs';
import { aggregateCryptoWeeks, fetchTwelveDataSeries, normalizeCandles } from './data-sources.mjs';
import { latestCryptoClose, latestStockClose, stockBarTimes, stockWeekTimes } from './market-calendar.mjs';
import { sendTelegram } from './telegram.mjs';
import { TF_MS } from './config.mjs';

const DAY = TF_MS['1d'];
const NOW = Date.parse('2026-11-21T00:30:00Z');
const LAST_CLOSE = Date.parse('2026-11-21T00:00:00Z');
function candles(close, tf = '1d', lastClose = LAST_CLOSE) {
  const n = close.length, ms = TF_MS[tf];
  return {
    close, high: close.map(x => x + 1), low: close.map(x => x - 1),
    closeTime: close.map((_, i) => lastClose - (n - 1 - i) * ms),
    openTime: close.map((_, i) => lastClose - (n - i) * ms),
  };
}
// Lateral, caída sostenida y rebote final: RSI baja de 30 y de 20, y en la última vela vuelve sobre 30.
const decline = () => { const c = []; for (let i = 0; i < 20; i++) c.push(100 + (i % 2)); for (let i = 0; i < 25; i++) c.push(c.at(-1) - 1); return c; };
const rebound = () => { const c = decline(); c.push(c.at(-1) + 12); return c; };

test('Wilder RSI matches reference seed and first smoothing step', () => {
  const r = rsiWilder([1, 2, 1, 2, 3], 2);
  assert.equal(r[2], 50);
  assert.ok(Math.abs(r[3] - 75) < 1e-9);
  assert.ok(Math.abs(r[4] - 87.5) < 1e-9);
});
test('crosses follow Pine boundaries', () => {
  const { crossover, crossunder } = crossEvents([29, 30, 31, 30, 29], 30);
  assert.deepEqual(crossover, [false, false, true, false, false]);
  assert.deepEqual(crossunder, [false, false, false, false, true]);
});
test('pivot only exists after right-hand confirmation bars', () => {
  assert.deepEqual(findPivots([5, 4, 1, 4], 2, 2).lows, []);
  assert.deepEqual(findPivots([5, 4, 1, 4, 5], 2, 2).lows, [{ idx: 2, value: 1 }]);
});

test('signals: extreme entry on the way down and oversold exit on rebound', () => {
  const { events } = buildSignals(candles(rebound()));
  const kinds = events.map(e => e.signal);
  assert.ok(kinds.includes('rsi_extreme_low'));
  const last = events.at(-1);
  assert.equal(last.signal, 'rsi_buy');
  assert.equal(last.idx, 45);
  assert.ok(last.previousRsi <= 30 && last.rsi > 30);
  assert.deepEqual(Object.keys(last.emas), [], 'sin 50/200 velas no hay medias');
  // Mirror: subida sostenida da sobrecompra extrema y luego salida bajo 70.
  const up = rebound().map(x => 200 - x);
  const bear = buildSignals(candles(up)).events;
  assert.ok(bear.some(e => e.signal === 'rsi_extreme_high'));
  assert.equal(bear.at(-1).signal, 'rsi_sell');
});
test('signals are causal: adding a future bar does not change past events', () => {
  const base = candles(rebound());
  const more = candles([...rebound(), rebound().at(-1) + 1], '1d', LAST_CLOSE + DAY);
  const strip = e => ({ ...e, confirmedTime: 0, divergence: undefined });
  assert.deepEqual(buildSignals(more).events.filter(e => e.idx <= 45).map(strip), buildSignals(base).events.map(strip));
});
test('bullish RSI divergence is attached to the oversold exit', () => {
  // Caída fuerte a un mínimo, rebote, caída suave a un mínimo más bajo (RSI más alto), rebote.
  const c = [];
  for (let i = 0; i < 20; i++) c.push(100 + (i % 2));
  for (let i = 0; i < 10; i++) c.push(c.at(-1) - 3);
  for (let i = 0; i < 8; i++) c.push(c.at(-1) + 2);
  for (let i = 0; i < 10; i++) c.push(c.at(-1) - 1.8);
  for (let i = 0; i < 10; i++) c.push(c.at(-1) + 2);
  const { events } = buildSignals(candles(c));
  assert.deepEqual(events.map(e => [e.signal, e.idx, Boolean(e.divergence)]),
    [['rsi_extreme_low', 25, false], ['rsi_buy', 33, false], ['rsi_buy', 48, true]]);
  const div = events.at(-1).divergence, t = candles(c).openTime;
  assert.deepEqual([div.prevTime, div.pivotTime], [t[29], t[47]]);
  assert.match(signalMessage('NVDA', '1d', events.at(-1), NOW), /⭐ Divergencia alcista: el precio hizo un mínimo más bajo, pero el RSI no\./);
});

test('dedup, expiry and retry of unsent events', async () => {
  const max = 3 * DAY, state = {};
  const events = [{ signal: 'rsi_buy', confirmedTime: NOW - DAY }, { signal: 'rsi_buy', confirmedTime: NOW - 1000 },
    { signal: 'rsi_sell', confirmedTime: NOW - max - 1 }, { signal: 'rsi_sell', confirmedTime: NOW + 1 }];
  assert.deepEqual(pendingEvents(state, 'BTCUSD', '1d', events, NOW, max), events.slice(0, 2));
  await assert.rejects(deliverEvents(state, 'BTCUSD', '1d', events.slice(0, 2), async e => { if (e === events[1]) throw Error('offline'); }, () => {}));
  assert.deepEqual(pendingEvents(state, 'BTCUSD', '1d', events, NOW, max), [events[1]]);
});

test('message: Spanish labels, chart link and recovered notice', () => {
  const e = { signal: 'rsi_extreme_low', level: 20, previousRsi: 21.2, rsi: 18.4, price: 12.5, emas: { 50: { pct: -8.4, rising: false }, 200: { pct: -16.7, rising: false } }, confirmedTime: NOW - 30 * 3600000 };
  const text = signalMessage('NU', '1d', e, NOW);
  assert.equal(text.split('\n').length, 4);
  assert.match(text, /^🔵 <b>NU<\/b> · diario · sobreventa extrema \(RSI 18\.4\)$/m);
  assert.match(text, /^Tendencia bajista: 17% debajo de la EMA200, que sigue bajando\.$/m);
  assert.match(text, /^Cierre \d\d\/\d\d · 12\.50 USD · 🕒 hace 30 h/m);
  assert.match(text, /symbol=NU&interval=D/);
  assert.match(signalMessage('BTCUSD', '1w', { ...e, confirmedTime: NOW }, NOW), /KRAKEN%3ABTCUSD&interval=W/);
  assert.doesNotMatch(signalMessage('BTCUSD', '1w', { ...e, confirmedTime: NOW }, NOW), /🕒/);
});

test('EMA context distinguishes a pullback in an uptrend from a reclaim in a downtrend', () => {
  assert.equal(trendSentence({ 50: { pct: -4 }, 200: { pct: 1.2, rising: true } }), '📍 Corrige hasta la EMA200 dentro de una tendencia alcista.');
  assert.equal(trendSentence({ 200: { pct: 1, rising: false } }), '📍 Está recuperando la EMA200, que todavía baja.');
  assert.equal(trendSentence({ 200: { pct: -12, rising: true } }), 'Corrección profunda: 12% debajo de la EMA200, que todavía sube.');
  assert.equal(trendSentence({ 200: { pct: 9, rising: false } }), 'Superó la EMA200 bajista por 9%: posible cambio de tendencia.');
  assert.equal(trendSentence({ 50: { pct: -6.3 } }), '6% debajo de la EMA50 (no hay historial para la EMA200).');
  assert.equal(trendSentence({}), undefined);
  // Con 250 velas en subida se calculan ambas medias y la pendiente.
  const up = buildSignals(candles(Array.from({ length: 250 }, (_, i) => 100 + i + (i % 3)))).lastEmas;
  assert.ok(up[50].pct > 0 && up[200].pct > 0 && up[200].rising === true);
});

test('weekly summary lists recent alerts and zones, skipping stale values', () => {
  const state = {
    'rsi:NVDA:1d:rsi_buy': NOW - 2 * DAY, 'rsi:AAPL:1d:rsi_sell': NOW - 9 * DAY,
    '_rsi:NVDA:1d': 31.5, '_rsiAt:NVDA:1d': NOW, '_ema200:NVDA:1d': -2.4, '_rsi:NVDA:1w': 18, '_rsiAt:NVDA:1w': NOW,
    '_rsi:MSTR:1d': 82, '_rsiAt:MSTR:1d': NOW, '_rsi:KO:1d': 50, '_rsiAt:KO:1d': NOW,
    '_rsi:TSLA:1d': 10, '_rsiAt:TSLA:1d': NOW - 20 * DAY,
  };
  const text = weeklySummary(state, ['NVDA', 'AAPL', 'MSTR', 'KO', 'TSLA'], NOW);
  assert.match(text, /NVDA · 1d · RSI sale de sobreventa/);
  assert.doesNotMatch(text, /AAPL/);
  assert.match(text, /🔵 NVDA · 1d 31\.5 · 1w 18\.0 · EMA200 −2\.4% 📍/);
  assert.match(text, /🔴 MSTR · 1d 82\.0$/m);
  assert.doesNotMatch(text, /KO ·|TSLA/);
});

test('scanner: sends once per close, caches RSI and sends the weekly summary once', async () => {
  const state = {}, messages = [], calls = [];
  const opts = {
    state, clock: () => NOW, persist: () => {}, send: async m => messages.push(m),
    cryptoSymbols: ['BTCUSD'], stockSymbols: [], timeframes: ['1d'],
    cryptoFetch: async (s, tf) => { calls.push(tf); return candles(rebound()); },
  };
  const result = await scanMarkets(opts);
  assert.equal(result.healthy, true);
  assert.equal(result.alertsSent, 1);
  assert.match(messages[0], /diario · sale de sobreventa/);
  assert.equal(result.summarySent, true);
  assert.match(messages[1], /Resumen semanal/);
  assert.ok(Number.isFinite(state['_rsi:BTCUSD:1d']));
  const again = await scanMarkets({ ...opts, cryptoFetch: async () => assert.fail('ya revisado') });
  assert.equal(again.alertsSent + Number(again.summarySent), 0);
  assert.equal(messages.length, 2);
});
test('scanner retries a late provider and isolates errors per symbol', async () => {
  const state = {}, messages = [];
  const result = await scanMarkets({
    state: { _summaryWeek: Infinity }, clock: () => NOW, persist: () => {}, send: async m => messages.push(m),
    cryptoSymbols: ['BTCUSD', 'ETHUSD'], stockSymbols: [], timeframes: ['1d'],
    cryptoFetch: async s => { if (s === 'BTCUSD') throw Error('caído'); return candles(decline(), '1d', LAST_CLOSE - DAY); },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[1], /Proveedor atrasado/);
  assert.equal(state['_checked:ETHUSD:1d'], undefined);
});

test('state pruning keeps only current keys and migrates v9 1d/1w dedup', () => {
  const s = pruneState({ 'v9:BTCUSD:1d:rsi_buy': 5, 'v9:BTCUSD:4h:rsi_buy': 6, '_checkedCloseV9:NU:1w': 7, '_checked:NU:1w': 4,
    'v2:BTCUSD:1d:rsi_buy': 8, 'BTCUSDT:1h:div_bear': 9, '_lastImportant:x': 1, '_summaryWeek': 3 });
  assert.deepEqual(s, { 'rsi:BTCUSD:1d:rsi_buy': 5, '_checked:NU:1w': 4, '_summaryWeek': 3 });
});

test('crypto weekly aggregation is Monday UTC and excludes partial weeks', () => {
  const open = Date.parse('2026-08-27T00:00:00Z'), n = 25;
  const c = { openTime: Array.from({ length: n }, (_, i) => open + i * DAY), closeTime: Array.from({ length: n }, (_, i) => open + (i + 1) * DAY),
    high: Array.from({ length: n }, (_, i) => 100 + i), low: Array.from({ length: n }, (_, i) => 50 + i), close: Array.from({ length: n }, (_, i) => 70 + i) };
  const w = aggregateCryptoWeeks(c, Date.parse('2026-09-19T12:00:00Z'));
  assert.equal(w.close.length, 2);
  assert.equal(new Date(w.openTime[0]).toISOString(), '2026-08-31T00:00:00.000Z');
  assert.equal(w.close[0], 80);
  const missing = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.filter((_, i) => i !== 13)]));
  assert.throws(() => aggregateCryptoWeeks(missing, Date.parse('2026-09-19T12:00:00Z')), /incompleta/);
});
test('crypto and stock close schedule: Monday UTC week, holidays, DST and early closes', () => {
  const monday = Date.parse('2026-09-21T00:00:00Z');
  assert.equal(latestCryptoClose('1w', monday + 30000), monday - 7 * DAY);
  assert.equal(latestCryptoClose('1w', monday + 60000), monday);
  assert.equal(latestCryptoClose('1d', NOW), LAST_CLOSE);
  assert.deepEqual(stockWeekTimes('2026-09-07'), { open: Date.parse('2026-09-08T13:30:00Z'), close: Date.parse('2026-09-11T20:00:00Z') });
  assert.equal(stockBarTimes('2026-11-23', '1w').close, Date.parse('2026-11-27T18:00:00Z'));
  assert.equal(stockBarTimes('2026-11-20', '1d').close, Date.parse('2026-11-20T21:00:00Z'));
  // Sábado: último cierre diario y semanal = viernes.
  const saturday = Date.parse('2026-11-21T00:23:00Z');
  assert.equal(latestStockClose('1d', saturday), Date.parse('2026-11-20T21:00:00Z'));
  assert.equal(latestStockClose('1w', saturday), Date.parse('2026-11-20T21:00:00Z'));
  assert.throws(() => stockBarTimes('2026-11-26', '1d'), /fuera de sesión/);
});
test('OHLC validation drops unclosed bars and rejects duplicates', () => {
  const rows = [{ open: 0, end: DAY, high: 2, low: 1, close: 1.5 }, { open: DAY, end: 2 * DAY, high: 2, low: 1, close: 1.5 }];
  assert.equal(normalizeCandles(rows, 2 * DAY).close.length, 1);
  assert.throws(() => normalizeCandles([rows[0], rows[0]], 3 * DAY), /duplicada/);
});
test('Twelve Data weekly request and parsing', async () => {
  const oldFetch = globalThis.fetch, oldNow = Date.now;
  try {
    Date.now = () => Date.parse('2026-09-17T12:00:00Z');
    globalThis.fetch = async url => {
      assert.equal(url.searchParams.get('interval'), '1week');
      assert.equal(url.searchParams.get('country'), 'United States');
      return { ok: true, json: async () => ({ values: [{ datetime: '2026-09-07', high: '110', low: '90', close: '100' }, { datetime: '2026-09-14', high: '120', low: '90', close: '110' }] }) };
    };
    const c = await fetchTwelveDataSeries('KO', '1w', 'fake-test-key');
    assert.equal(c.close.length, 1);
    assert.equal(c.closeTime[0], Date.parse('2026-09-11T20:00:00Z'));
  } finally { globalThis.fetch = oldFetch; Date.now = oldNow; }
});
test('Telegram requires ok=true even with HTTP 200', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error_code: 400 }) });
    await assert.rejects(sendTelegram('t', '1', 'hola'), /Telegram error/);
  } finally { globalThis.fetch = oldFetch; }
});
