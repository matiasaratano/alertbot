# Alertbot: avisos RSI diarios y semanales por Telegram

Revisa una vez por día velas **diarias y semanales** de 4 cripto (Kraken) y 24 acciones/ETFs (Twelve Data). Avisa cuando el RSI(14) marca un evento. Sirve para fijarse en un activo y analizarlo por tu cuenta; no es una señal para operar.

## Avisos

| Aviso | Regla (vela cerrada) |
|---|---|
| 🟢 RSI sale de sobreventa | RSI cruza 30 hacia arriba |
| 🟠 RSI sale de sobrecompra | RSI cruza 70 hacia abajo |
| 🔵 Sobreventa extrema | RSI baja de 20 |
| 🔴 Sobrecompra extrema | RSI supera 80 |

- ⭐ **Con divergencia**: el aviso lo indica si el extremo de precio de las últimas 10 velas es más bajo (o más alto) que el pivot anterior y el RSI no lo acompaña. Solo usa velas ya cerradas.
- **Formato breve**: una línea con el evento, una frase sobre la tendencia, la divergencia si la hay, el cierre con el precio y el link a TradingView. Ejemplo:
  ```
  🟢 SOLUSD · diario · sale de sobreventa (RSI 31.5)
  Tendencia bajista: 24% debajo de la EMA200, que sigue bajando.
  Cierre 23/11 · 71.95 USD
  ```
- **Tendencia**: la frase sale de la distancia a la EMA200 y de si la media sube o baja respecto de 20 velas atrás. 📍 marca que el precio está a menos de 3% de la EMA200. Sin historial para la EMA200 (semanal cripto), usa la EMA50.
- Cada cruce se avisa una sola vez.

**Resumen semanal** (lunes ~10:20 ART): muestra los avisos de la semana y los activos con RSI ≤ 35 o ≥ 65 en diario o semanal, ordenados por extremo, con la distancia a la EMA200 diaria.

## Activos

Se configuran en [config.mjs](config.mjs).

- **Cripto**: BTCUSD, ETHUSD, SOLUSD, BNBUSD.
- **Acciones/ETFs**: NU, MELI, NFLX, MSFT, GOOGL, TSLA, NVDA, AVGO, KO, MSTR, MU, AMD, INTC, AAPL, AMZN, META, TSM, PLTR, JPM, V, LLY, COST, SPY y QQQ.

## Horario

El GitHub Action corre a las 13:17 UTC (10:17 ART). A esa hora ya cerraron la vela diaria cripto (00:00 UTC) y la de Nueva York del día anterior. GitHub puede demorar el cron.

- **Semanal de acciones**: se revisa el sábado, después del cierre del viernes.
- **Semanal cripto y resumen**: se revisan el lunes.
- **Recuperación**: si una corrida falla, se recuperan cierres de hasta 72 h (`MAX_ALERT_DELAY_MINUTES`).
- **Prueba manual**: botón "Run workflow" en Actions.

## Uso

Requiere Node.js 22 o posterior. No tiene dependencias.

```sh
npm test
npm run dry-run   # consulta precios y muestra los mensajes sin enviarlos ni guardar estado
```

Secrets de GitHub (o `.env` local, ver `.env.example`):

- `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID`.
- `TWELVEDATA_API_KEY`: sin esta key solo se revisan cripto. El plan gratis alcanza: unas 30–50 requests por día.

## Archivos

- `config.mjs`: activos, niveles RSI y parámetros.
- `indicators.mjs`: RSI de Wilder, cruces, EMA y pivots.
- `signals.mjs`: detección de avisos, divergencia, mensajes y resumen semanal.
- `scan.mjs`: recorre los activos, deduplica, envía y guarda `state.json`.
- `data-sources.mjs`: Kraken y Twelve Data. La semana cripto se arma de lunes a domingo UTC, igual que TradingView.
- `market-calendar.mjs` y `us-sessions.json`: sesiones NYSE 2020–2030 con feriados y cierres anticipados. Se regeneran con `scripts/generate-calendar.py`.
- `tradingview/hybrid-v9.pine`: indicador para el gráfico.
