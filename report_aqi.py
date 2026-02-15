# -*- coding: utf-8 -*-
import pandas as pd

# Read data
df = pd.read_csv(r'C:\Users\Administrator\Desktop\印度各城市空气指数.csv')
city_stats = df.groupby('city')['aqi'].agg([
    ('max_aqi', 'max'),
    ('std_aqi', 'std'),
    ('heavy_pollution_days', lambda x: (x > 150).sum()),
    ('total_days', 'count')
]).round(2)

def normalize(series):
    min_val = series.min()
    max_val = series.max()
    if max_val == min_val:
        return pd.Series([50] * len(series), index=series.index)
    return ((series - min_val) / (max_val - min_val) * 100).round(2)

ranking_df = city_stats.copy()
ranking_df['max_norm'] = normalize(ranking_df['max_aqi'])
ranking_df['std_norm'] = normalize(ranking_df['std_aqi'])
ranking_df['days_norm'] = normalize(ranking_df['heavy_pollution_days'])
ranking_df['pollution_index'] = (ranking_df['max_norm'] * 0.4 + ranking_df['std_norm'] * 0.3 + ranking_df['days_norm'] * 0.3).round(2)
ranking_df = ranking_df.sort_values('pollution_index', ascending=False)
ranking_df['rank'] = range(1, len(ranking_df) + 1)

print('=' * 90)
print('India Cities AQI Analysis Report')
print('=' * 90)
print(f"Data Overview: {len(df)} records, {df['city'].nunique()} cities, 2015-01-01 to 2023-12-31")
print(f"Cities: {', '.join(df['city'].unique())}")

print()
print('=' * 90)
print('City AQI Statistics (Max, Std, Heavy Pollution Days)')
print('=' * 90)
for city, row in city_stats.iterrows():
    pct = row['heavy_pollution_days']/row['total_days']*100
    print(f"{city:12s} | Max AQI: {row['max_aqi']:6.1f} | Std: {row['std_aqi']:6.2f} | Days>150: {row['heavy_pollution_days']:3.0f} days ({pct:.1f}%)")

print()
print('=' * 90)
print('Pollution Severity Ranking (Lower rank = More polluted)')
print('=' * 90)
print('Formula: Pollution Index = Max(40%) + Std(30%) + HeavyDays(30%)')
print()

for idx, (city, row) in enumerate(ranking_df.iterrows(), 1):
    if row['pollution_index'] >= 70:
        level = 'SEVERE'
    elif row['pollution_index'] >= 40:
        level = 'MODERATE'
    elif row['pollution_index'] >= 20:
        level = 'MILD'
    else:
        level = 'GOOD'
    print(f"Rank {idx}: {city:12s} [{level:8s}] Index={row['pollution_index']:6.2f} | Max={row['max_aqi']:6.1f} | Std={row['std_aqi']:6.2f} | >150days={row['heavy_pollution_days']:3.0f}")

print()
print('=' * 90)
print('Summary Table')
print('=' * 90)
summary = ranking_df[['rank', 'max_aqi', 'std_aqi', 'heavy_pollution_days', 'pollution_index']].copy()
summary.columns = ['Rank', 'Max AQI', 'Std Dev', 'Days>150', 'Pollution Index']
print(summary.to_string())

print()
print('Results saved to: C:\\Users\\Administrator\\Desktop\\印度各城市AQI分析结果.csv')
