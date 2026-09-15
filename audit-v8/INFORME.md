# Comparación descriptiva v7 / v8

BTC/USD y ETH/USD, Kraken. Solo velas cerradas; las últimas 700 disponibles, primeras 249 reservadas para calentamiento. Semanal nativo de Kraken: sus límites de semana pueden diferir de TradingView. No prueba equivalencia con el motor Pine.

Entrada hipotética en la apertura siguiente y salida al cierre de la sexta vela en 4h, quinta en diario y cuarta en semanal. Retorno direccional menos 0,10% de coste total supuesto. Las señales pueden solaparse: no son trades de una cartera ejecutable. No incorpora stops, deslizamiento variable, financiación, préstamo ni dividendos. No se ajustaron parámetros buscando mejorar esta muestra.

| Activo | TF | Versión | Lado | Señales | Maduras | Positivas netas | Media neta | Contra EMA200 |
|---|---|---|---|---|---|---|---|---|
| BTCUSD | 4h | v7 | BUY | 3 | 3 | 66.67% | -0.59% | 0 |
| BTCUSD | 4h | v7 | SELL | 5 | 5 | 60.00% | 0.07% | 0 |
| BTCUSD | 4h | v8 | BUY | 6 | 6 | 50.00% | 0.08% | 2 |
| BTCUSD | 4h | v8 | SELL | 17 | 17 | 52.94% | -0.30% | 11 |
| BTCUSD | 1d | v7 | BUY | 3 | 3 | 100.00% | 1.59% | 0 |
| BTCUSD | 1d | v7 | SELL | 2 | 2 | 50.00% | -1.40% | 0 |
| BTCUSD | 1d | v8 | BUY | 10 | 10 | 50.00% | 2.00% | 7 |
| BTCUSD | 1d | v8 | SELL | 6 | 6 | 66.67% | 0.96% | 5 |
| BTCUSD | 1w | v7 | BUY | 4 | 3 | 33.33% | -2.68% | 0 |
| BTCUSD | 1w | v7 | SELL | 0 | 0 | —% | —% | 0 |
| BTCUSD | 1w | v8 | BUY | 5 | 4 | 50.00% | -3.54% | 2 |
| BTCUSD | 1w | v8 | SELL | 11 | 11 | 45.45% | -3.37% | 11 |
| ETHUSD | 4h | v7 | BUY | 1 | 1 | 0.00% | -4.25% | 0 |
| ETHUSD | 4h | v7 | SELL | 0 | 0 | —% | —% | 0 |
| ETHUSD | 4h | v8 | BUY | 2 | 2 | 0.00% | -2.48% | 0 |
| ETHUSD | 4h | v8 | SELL | 13 | 13 | 53.85% | 0.05% | 13 |
| ETHUSD | 1d | v7 | BUY | 1 | 1 | 0.00% | -15.14% | 0 |
| ETHUSD | 1d | v7 | SELL | 2 | 2 | 50.00% | 2.05% | 0 |
| ETHUSD | 1d | v8 | BUY | 8 | 8 | 50.00% | -3.06% | 6 |
| ETHUSD | 1d | v8 | SELL | 7 | 7 | 28.57% | -1.93% | 5 |
| ETHUSD | 1w | v7 | BUY | 1 | 1 | 0.00% | -10.70% | 0 |
| ETHUSD | 1w | v7 | SELL | 0 | 0 | —% | —% | 0 |
| ETHUSD | 1w | v8 | BUY | 4 | 3 | 66.67% | 20.11% | 4 |
| ETHUSD | 1w | v8 | SELL | 5 | 5 | 60.00% | -10.34% | 5 |

## Límites de interpretación

La tasa positiva depende de la salida elegida: no es una probabilidad de acierto del cartel. Esta comparación de muestras pequeñas no establece superioridad, no tiene una prueba independiente fuera de muestra y no valida acciones como NVDA. Evaluar aciertos junto con pérdida/ganancia media y expectativa; más aciertos pueden coexistir con pérdidas netas. Los rangos de fechas y cada observación están en results.json. La política de Telegram tiene filtros y cooldown adicionales, por lo que estos conteos describen las señales del gráfico.
