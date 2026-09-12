import pandas as pd

# 1. Cargar el CSV generado por Node.js
try:
    df = pd.read_csv('backtest-results.csv')
    print(f" Data cargada exitosamente. Total de combinaciones evaluadas: {len(df)}\n")
except FileNotFoundError:
    print(" Error: No se encontró el archivo 'backtest-results.csv'. Checkea la ruta.")
    exit()

# 2. Filtrar ruido: Excluir muestras insignificantes
# Requerimos un mínimo de 10 trades para reducir el factor suerte
MIN_TRADES = 5  # Puedes subirlo a 10 o 15 si tu dataset es grande
df_filtrado = df[df['trades'] >= MIN_TRADES].copy()

# 3. Filtrar solo estrategias con Expectativa Matemática Positiva (expectancyR > 0)
df_rentables = df_filtrado[df_filtrado['expectancyR'] > 0].copy()

# 4. Ordenar por la mejor expectativa por trade (expectancyR)
df_top = df_rentables.sort_values(by='expectancyR', ascending=False)

# --- REPORTES EN CONSOLA ---

print("=" * 60)
print(f" TOP MEJORES SETUPS (Trades >= {MIN_TRADES} y ExpectancyR > 0)")
print("=" * 60)

cols_mostrar = ['symbol', 'tf', 'signal', 'sl', 'tp', 'trades', 'winrate', 'netR', 'expectancyR']

if not df_top.empty:
    # Formatear el winrate a porcentaje para mejor lectura
    df_top_display = df_top[cols_mostrar].copy()
    df_top_display['winrate'] = (df_top_display['winrate'] * 100).map('{:.1f}%'.format)
    print(df_top_display.to_string(index=False))
else:
    print("No se encontraron estrategias que cumplan con el filtro de mínimo de trades y expectativa positiva.")

print("\n" + "=" * 60)
print(" RESUMEN POR SÍMBOLO (Promedio de ganancia neta)")
print("=" * 60)

# Ver qué par es estructuralmente más rentable en general
resumen_simbolo = df_filtrado.groupby('symbol').agg(
    total_setups=('signal', 'count'),
    winrate_promedio=('winrate', lambda x: f"{x.mean()*100:.1f}%"),
    netR_total=('netR', 'sum'),
    expectancy_promedio=('expectancyR', 'mean')
).sort_values(by='netR_total', ascending=False)

print(resumen_simbolo.to_string())

# 5. Guardar los mejores resultados filtrados en un nuevo CSV
df_top.to_csv('mejores_estrategias.csv', index=False)
print("\n Archivo 'mejores_estrategias.csv' guardado con éxito.")