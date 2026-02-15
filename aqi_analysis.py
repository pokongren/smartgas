# -*- coding: utf-8 -*-
import pandas as pd
import numpy as np

# 读取CSV文件
df = pd.read_csv(r'C:\Users\Administrator\Desktop\印度各城市空气指数.csv')

# 按城市计算各项指标
city_stats = []

for city in df['city'].unique():
    city_data = df[df['city'] == city]
    
    # 1. AQI平均值
    aqi_mean = city_data['aqi'].mean()
    
    # 2. PM2.5平均值
    pm25_mean = city_data['pm25'].mean()
    
    # 3. Good天数占比
    good_days_ratio = (city_data['aqi_category'] == 'Good').sum() / len(city_data) * 100
    
    # 4. AQI中位数
    aqi_median = city_data['aqi'].median()
    
    city_stats.append({
        'city': city,
        'aqi_mean': aqi_mean,
        'pm25_mean': pm25_mean,
        'good_days_ratio': good_days_ratio,
        'aqi_median': aqi_median,
        'total_days': len(city_data)
    })

# 创建统计DataFrame
stats_df = pd.DataFrame(city_stats)

# 标准化函数 - 反向标准化（值越小越好）
def reverse_normalize(series):
    min_val = series.min()
    max_val = series.max()
    return 100 * (max_val - series) / (max_val - min_val)

# 标准化函数 - 正向标准化（值越大越好）
def normalize(series):
    min_val = series.min()
    max_val = series.max()
    return 100 * (series - min_val) / (max_val - min_val)

# 对各指标进行标准化评分
stats_df['aqi_mean_score'] = reverse_normalize(stats_df['aqi_mean'])
stats_df['pm25_mean_score'] = reverse_normalize(stats_df['pm25_mean'])
stats_df['good_days_score'] = normalize(stats_df['good_days_ratio'])
stats_df['aqi_median_score'] = reverse_normalize(stats_df['aqi_median'])

# 计算加权总分
weights = {
    'aqi_mean': 0.40,
    'pm25_mean': 0.30,
    'good_days': 0.20,
    'aqi_median': 0.10
}

stats_df['total_score'] = (
    stats_df['aqi_mean_score'] * weights['aqi_mean'] +
    stats_df['pm25_mean_score'] * weights['pm25_mean'] +
    stats_df['good_days_score'] * weights['good_days'] +
    stats_df['aqi_median_score'] * weights['aqi_median']
)

# 按总分降序排列
stats_df = stats_df.sort_values('total_score', ascending=False).reset_index(drop=True)
stats_df['rank'] = range(1, len(stats_df) + 1)

# 显示完整结果
print('=' * 100)
print('印度各城市空气质量综合排名')
print('=' * 100)
print()

for idx, row in stats_df.iterrows():
    print(f"排名 {row['rank']}: {row['city']}")
    print(f"  综合得分: {row['total_score']:.2f}")
    print(f"  - AQI平均值: {row['aqi_mean']:.2f} (得分: {row['aqi_mean_score']:.2f}, 权重40%)")
    print(f"  - PM2.5平均值: {row['pm25_mean']:.2f} (得分: {row['pm25_mean_score']:.2f}, 权重30%)")
    print(f"  - Good天数占比: {row['good_days_ratio']:.2f}% (得分: {row['good_days_score']:.2f}, 权重20%)")
    print(f"  - AQI中位数: {row['aqi_median']:.2f} (得分: {row['aqi_median_score']:.2f}, 权重10%)")
    print()

print('=' * 100)
print('标准化说明:')
print('- AQI平均值、PM2.5平均值、AQI中位数采用反向标准化（值越低得分越高）')
print('- Good天数占比采用正向标准化（值越高得分越高）')
print('- 各指标均转换为0-100分区间')
print('=' * 100)

# 保存详细结果到CSV
output_df = stats_df[['rank', 'city', 'total_score', 'aqi_mean', 'aqi_mean_score', 
                       'pm25_mean', 'pm25_mean_score', 'good_days_ratio', 'good_days_score',
                       'aqi_median', 'aqi_median_score']]
output_df.to_csv(r'f:\smartgas-grid\city_aqi_ranking.csv', index=False, encoding='utf-8-sig')
print('\n详细结果已保存到: f:\\smartgas-grid\\city_aqi_ranking.csv')
