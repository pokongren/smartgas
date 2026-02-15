# -*- coding: utf-8 -*-
import pandas as pd

# 读取结果
df = pd.read_csv('city_aqi_ranking.csv')

report = []
report.append('=' * 100)
report.append('印度各城市空气质量综合排名报告')
report.append('=' * 100)
report.append('')
report.append('评价指标及权重:')
report.append('  1. AQI平均值 (权重40%) - 越低越好')
report.append('  2. PM2.5平均值 (权重30%) - 越低越好')
report.append('  3. Good天数占比 (权重20%) - 越高越好')
report.append('  4. AQI中位数 (权重10%) - 越低越好')
report.append('')
report.append('标准化方法:')
report.append('  - 对各指标进行Min-Max标准化，转换为0-100分')
report.append('  - AQI相关指标和PM2.5采用反向标准化(值越低得分越高)')
report.append('  - Good天数占比采用正向标准化(值越高得分越高)')
report.append('')
report.append('=' * 100)
report.append('')
report.append('详细排名:')
report.append('-' * 100)
report.append(f"{'排名':<6}{'城市':<15}{'综合得分':<12}{'AQI均值':<12}{'PM2.5均值':<12}{'Good天数%':<12}{'AQI中位数':<10}")
report.append('-' * 100)

for _, row in df.iterrows():
    report.append(f"{int(row['rank']):<6}{row['city']:<15}{row['total_score']:<12.2f}{row['aqi_mean']:<12.2f}{row['pm25_mean']:<12.2f}{row['good_days_ratio']:<12.2f}{row['aqi_median']:<10.0f}")

report.append('-' * 100)
report.append('')
report.append('=' * 100)
report.append('各指标标准化得分详情:')
report.append('=' * 100)
report.append('')

for _, row in df.iterrows():
    report.append(f"排名 {int(row['rank'])}: {row['city']}")
    report.append(f"  综合得分: {row['total_score']:.2f}")
    report.append(f"    - AQI平均值  : {row['aqi_mean']:.2f} → 得分: {row['aqi_mean_score']:.2f} (权重40%)")
    report.append(f"    - PM2.5平均值: {row['pm25_mean']:.2f} → 得分: {row['pm25_mean_score']:.2f} (权重30%)")
    report.append(f"    - Good天数占比: {row['good_days_ratio']:.2f}% → 得分: {row['good_days_score']:.2f} (权重20%)")
    report.append(f"    - AQI中位数  : {row['aqi_median']:.0f} → 得分: {row['aqi_median_score']:.2f} (权重10%)")
    report.append('')

report.append('=' * 100)
report.append('结论:')
report.append(f"  空气质量最佳城市: {df.iloc[0]['city']} (综合得分: {df.iloc[0]['total_score']:.2f})")
report.append(f"  空气质量最差城市: {df.iloc[-1]['city']} (综合得分: {df.iloc[-1]['total_score']:.2f})")
report.append('=' * 100)

# 保存报告
with open('aqi_report.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(report))

# 同时打印
print('\n'.join(report))
