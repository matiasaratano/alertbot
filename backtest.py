import pandas as pd

# 1. Cargar el archivo de resultados
try:
    df = pd.read_csv('backtest-results.csv')
    print(f"✅ Archivo cargado exitosamente. Total de registros: {len(df)}\n")
except Exception as e:
    print(f"❌ Error al leer el CSV: {e}")
    exit()

# Mostrar las primeras filas para entender la estructura
print("--- VISTA PREVIA DE LOS DATOS ---")
print(df.head())
print("\n" + "="*50 + "\n")

# 2. Resumen rápido si existen columnas típicas de trading
# Ajusta los nombres de columnas ('pair', 'winrate', 'expectancy', etc.) según tu CSV
if 'pair' in df.columns or 'symbol' in df.columns:
    pair_col = 'pair' if 'pair' in df.columns else 'symbol'
    print("--- TOP 5 MEJORES PARES/SETUPS ---")
    
    # Intenta ordenar por Ganancia Neta, Expectativa o Winrate si existen
    sort_col = next((col for col in ['expectancyR', 'netR', 'winrate', 'profit'] if col in df.columns), df.columns[-1])
    top_setups = df.sort_values(by=sort_col, ascending=False).head(5)
    print(top_setups.to_string(index=False))