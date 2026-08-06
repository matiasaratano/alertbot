# Alertbot — RSI + Squeeze Momentum (crypto + stocks) por Telegram

Replica las 4 alertas de tu indicador de TradingView (`BUY RSI`, `SELL RSI`,
`Divergencia Alcista`, `Divergencia Bajista`) para varios símbolos y
temporalidades a la vez, y te avisa por Telegram cuando aparece alguna —
vos después entrás a analizar si operás o no.

- **Cryptos**: vía API pública de Binance (gratis, sin API key).
- **Stocks**: vía Twelve Data (gratis hasta 800 requests/día).
- **Scheduler**: GitHub Actions, corre cada 15 minutos. *(Ojo: Vercel Cron
  en plan Hobby solo permite 1 corrida por día, por eso no se usó acá).*
- **Estado**: `state.json` se commitea solo en cada corrida, para no
  mandarte la misma alerta dos veces.

## 1. Crear el bot de Telegram

1. Hablale a **@BotFather** en Telegram → `/newbot` → te da un **token**.
2. Mandale cualquier mensaje a tu bot nuevo (para poder recibir mensajes).
3. Hablale a **@userinfobot** para conseguir tu **chat_id** numérico.

## 2. Conseguir API key de Twelve Data (solo si querés stocks)

Registrate gratis en https://twelvedata.com/ → Dashboard → copiás la API key.
Si no la configurás, el bot simplemente se salta el chequeo de acciones y
sigue funcionando con las cryptos.

## 3. Subir esto a un repo de GitHub

```bash
cd alertbot
git init
git add .
git commit -m "alertbot inicial"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/alertbot.git
git push -u origin main
```

## 4. Configurar los secrets del repo

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Secret               | Valor                          |
|----------------------|---------------------------------|
| `TELEGRAM_TOKEN`     | el token de @BotFather          |
| `TELEGRAM_CHAT_ID`   | tu chat_id de @userinfobot       |
| `TWELVEDATA_API_KEY` | tu API key de Twelve Data (opcional) |

## 5. Editar tus símbolos

Abrí `scan.mjs` y ajustá:

```js
const CRYPTO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const STOCK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "MELI", "GOOGL", "AMZN"];
const TIMEFRAMES = ["15m", "1h", "4h", "1d"];
```

Los tickers de `STOCK_SYMBOLS` tienen que existir en Twelve Data (los
símbolos estándar de bolsa funcionan tal cual, ej. `AAPL`, `MELI`).

## 6. Probarlo manualmente

En GitHub → pestaña **Actions** → seleccioná el workflow "Scan crypto &
stock signals" → **Run workflow**. Revisá los logs; si algo falla (símbolo
mal escrito, API key inválida) se ve ahí sin tener que esperar al cron.

Una vez andando, corre solo cada 15 minutos.

## Cómo se cuidan los créditos gratis de Twelve Data

Solo se pide una temporalidad de una acción cuando "le toca" cerrar vela
(15m: siempre que corre el cron · 1h: una vez por hora · 4h: una vez cada
4 horas · 1d: una vez al día, cerca del cierre de NYSE). Con 6 acciones x 4
temporalidades este esquema se queda bastante por debajo del límite de
800 requests/día del plan free. Si sumás más símbolos o el límite queda
justo, lo primero que conviene sacar es la temporalidad `15m` de las
acciones (para acciones rara vez importa tanto como para crypto).

## Limitaciones a tener en cuenta

- **RSI**: fórmula de Wilder, idéntica a la de TradingView — una vez que
  hay suficiente historial (se piden 300 velas) el valor prácticamente
  coincide.
- **Squeeze Momentum / divergencias**: la regresión lineal y la detección
  de pivots están reimplementadas a mano siguiendo la fórmula de LazyBear;
  el histograma y las divergencias deberían coincidir con TradingView, pero
  al no ser el motor oficial de Pine puede haber diferencias mínimas de
  redondeo en casos borde (pivots casi empatados).
- Fines de semana no hay velas nuevas de acciones — el bot no manda nada
  raro, simplemente no encuentra nada nuevo que avisar.
- Esto es un aviso, no ejecuta operaciones ni reemplaza tu análisis.
# alertbot
