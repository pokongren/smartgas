import pandas as pd
import sys

# 设置输出编码
sys.stdout.reconfigure(encoding='utf-8')

# 读取CSV文件
df = pd.read_csv(r'C:\Users\Administrator\Desktop\印度各城市空气指数.csv', encoding='utf-8')

# 计算每个城市的AQI平均值
city_aqi_mean = df.groupby('city')['aqi'].mean().reset_index()

# 按AQI从低到高排序（AQI越低越好）
city_aqi_mean = city_aqi_mean.sort_values('aqi', ascending=True)

# 添加排名列
city_aqi_mean['rank'] = range(1, len(city_aqi_mean) + 1)

# 打印结果
print('=' * 70)
print('         印度各城市空气质量指数(AQI)平均值排名')
print('              (按AQI从低到高排序，AQI越低空气质量越好)')
print('=' * 70)
print()
print(f'{"排名":<8} {"城市":<15} {"平均AQI":<15} {"空气质量评价"}')
print('-' * 70)

for idx, row in city_aqi_mean.iterrows():
    rank = row['rank']
    city = row['city']
    aqi = row['aqi']
    
    # 根据AQI判断空气质量等级
    if aqi <= 50:
        level = "Good (良好)"
    elif aqi <= 100:
        level = "Satisfactory (满意)"
    elif aqi <= 200:
        level = "Moderate (中等)"
    elif aqi <= 300:
        level = "Poor (差)"
    elif aqi <= 400:
        level = "Very Poor (很差)"
    else:
        level = "Severe (严重)"
    
    print(f'{rank:<8} {city:<15} {aqi:.2f}         {level}')

print('-' * 70)
print()
print('数据统计：')
print(f'  - 分析城市数量：{len(city_aqi_mean)} 个')
print(f'  - 数据总记录数：{len(df)} 条')
print(f'  - 空气质量最好：{city_aqi_mean.iloc[0]["city"]} (AQI: {city_aqi_mean.iloc[0]["aqi"]:.2f})')
print(f'  - 空气质量最差：{city_aqi_mean.iloc[-1]["city"]} (AQI: {city_aqi_mean.iloc[-1]["aqi"]:.2f})')
print(f'  - 平均AQI值：{city_aqi_mean["aqi"].mean():.2f}')
print()
print('=' * 70)
print('AQI等级参考:')
print('  0-50   : Good (良好)')
print('  51-100 : Satisfactory (满意)')
print('  101-200: Moderate (中等)')
print('  201-300: Poor (差)')
print('  301-400: Very Poor (很差)')
print('  401-500: Severe (严重)')
print('=' * 70)
