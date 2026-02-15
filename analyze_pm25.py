import pandas as pd
import sys

# 设置输出编码
sys.stdout.reconfigure(encoding='utf-8')

# 读取CSV文件
df = pd.read_csv(r'C:\Users\Administrator\Desktop\印度各城市空气指数.csv', encoding='utf-8')

# 查看数据基本信息
print('=' * 70)
print('                    印度各城市PM2.5平均值排名')
print('=' * 70)
print()
print('=== 数据概览 ===')
print(f'总行数: {len(df)}')
print(f'城市列表: {list(df["city"].unique())}')
print(f'城市数量: {df["city"].nunique()}')
print()

# 计算每个城市的PM2.5平均值，按从低到高排序（越低越好）
city_pm25_mean = df.groupby('city')['pm25'].mean().reset_index()
city_pm25_mean.columns = ['城市', 'PM2.5平均值']
city_pm25_mean = city_pm25_mean.sort_values('PM2.5平均值', ascending=True)
city_pm25_mean['排名'] = range(1, len(city_pm25_mean) + 1)

# 重新排列列顺序
city_pm25_mean = city_pm25_mean[['排名', '城市', 'PM2.5平均值']]

print('=== 各城市PM2.5平均值排名（从好到差，PM2.5越低空气质量越好）===')
print()
print(f'{"排名":<6} {"城市":<15} {"PM2.5平均值":<15}')
print('-' * 40)
for _, row in city_pm25_mean.iterrows():
    print(f'{int(row["排名"]):<6} {row["城市"]:<15} {row["PM2.5平均值"]:<15.2f}')
print()

# 显示各城市数据样本数
print('=== 各城市数据样本数 ===')
print()
sample_count = df['city'].value_counts().reset_index()
sample_count.columns = ['城市', '样本数']
print(f'{"城市":<15} {"样本数":<10}')
print('-' * 30)
for _, row in sample_count.iterrows():
    print(f'{row["城市"]:<15} {row["样本数"]:<10}')
print()
print('=' * 70)
