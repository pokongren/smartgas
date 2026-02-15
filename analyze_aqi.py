# -*- coding: utf-8 -*-
import pandas as pd

# 读取CSV文件
df = pd.read_csv(r'C:\Users\Administrator\Desktop\印度各城市空气指数.csv')

# 统计各城市指标
city_stats = df.groupby('city')['aqi'].agg([
    ('AQI最大值', 'max'),
    ('AQI平均值', 'mean'),
    ('AQI标准差', 'std'),
    ('AQI>150天数', lambda x: (x > 150).sum()),
    ('总天数', 'count')
]).round(2)

# 标准化函数
def normalize(series):
    min_val = series.min()
    max_val = series.max()
    if max_val == min_val:
        return pd.Series([50] * len(series), index=series.index)
    return ((series - min_val) / (max_val - min_val) * 100).round(2)

# 计算综合污染指数
ranking_df = city_stats.copy()
ranking_df['max_norm'] = normalize(ranking_df['AQI最大值'])
ranking_df['std_norm'] = normalize(ranking_df['AQI标准差'])
ranking_df['days_norm'] = normalize(ranking_df['AQI>150天数'])
ranking_df['综合污染指数'] = (ranking_df['max_norm'] * 0.4 + ranking_df['std_norm'] * 0.3 + ranking_df['days_norm'] * 0.3).round(2)

# 排序
ranking_df = ranking_df.sort_values('综合污染指数', ascending=False)
ranking_df['排名'] = range(1, len(ranking_df) + 1)

# 输出结果
print('=' * 80)
print('印度各城市空气质量指数(AQI)分析报告')
print('=' * 80)
print(f'数据概览: 共{len(df)}条记录, {df["city"].nunique()}个城市')
print(f'时间范围: {df["date"].min()} 至 {df["date"].max()}')
print(f'城市列表: {", ".join(df["city"].unique())}')

print('\n' + '=' * 80)
print('各城市AQI统计指标')
print('=' * 80)
print(city_stats.to_string())

print('\n' + '=' * 80)
print('各城市污染严重程度排名')
print('=' * 80)
print('排名规则: 综合AQI最大值(40%)、标准差(30%)、重污染天数(30%)')
print('-' * 80)

for idx, (city, row) in enumerate(ranking_df.iterrows(), 1):
    level = '严重污染' if row['综合污染指数'] >= 70 else '中度污染' if row['综合污染指数'] >= 40 else '轻度污染' if row['综合污染指数'] >= 20 else '良好'
    print(f'\n第{idx}名: {city} [{level}] - 污染指数: {row["综合污染指数"]}')
    print(f'       AQI最大值={row["AQI最大值"]}, 标准差={row["AQI标准差"]}, 重污染天数={row["AQI>150天数"]}天({row["AQI>150天数"]/row["总天数"]*100:.1f}%)')

print('\n' + '=' * 80)
print('排名汇总表')
print('=' * 80)
summary = ranking_df[['排名', 'AQI最大值', 'AQI标准差', 'AQI>150天数', '综合污染指数']].copy()
summary.columns = ['排名', 'AQI最大值', '标准差', '重污染天数', '污染指数']
print(summary.to_string())

# 保存结果
output = r'C:\Users\Administrator\Desktop\印度各城市AQI分析结果.csv'
summary.to_csv(output, encoding='utf-8-sig', index=True)
print(f'\n结果已保存: {output}')
