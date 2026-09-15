# Volumen descriptivo de avisos

BTC/ETH de Kraken, últimas 700 velas cerradas y 249 de calentamiento. Simula por separado mantener seguimiento LONG o SHORT durante toda la ventana, procesando cada cierre; no representa tus trades ni evalúa rentabilidad. Cuenta escaladas y rearme tras dos cierres de recuperación del impulso. La muestra se usó para revisar el volumen y mejorar la regla que evita repeticiones; no es una validación independiente ni se optimizó rentabilidad.

| Activo | TF | Marcas individuales | Setups v8 | Seguimiento LONG | Seguimiento SHORT |
|---|---|---:|---:|---:|---:|
| BTCUSD | 15m | 71 | 20 | 13 | 12 |
| BTCUSD | 1h | 70 | 18 | 14 | 12 |
| BTCUSD | 4h | 72 | 23 | 12 | 11 |
| ETHUSD | 15m | 65 | 16 | 9 | 12 |
| ETHUSD | 1h | 67 | 14 | 12 | 14 |
| ETHUSD | 4h | 77 | 15 | 14 | 9 |

Las ventanas difieren por el límite de historia; sus fechas están en results.json. Los setups no incluyen el cooldown adicional del envío, el monitoreo sí usa sus episodios. Durante un seguimiento se silencian las oportunidades de ese activo/marco. Las columnas LONG/SHORT son escenarios alternativos, no sumarlas como mensajes simultáneos. La recuperación del impulso rearma el monitor, así que un seguimiento largo puede producir varios episodios. Esto mide volumen potencial, no calidad ni latencia de Telegram.
