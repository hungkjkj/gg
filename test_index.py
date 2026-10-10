import pandas as pd
import numpy as np

times = pd.date_range("2026-10-08", periods=10, freq='5min')
df = pd.DataFrame({'time': times, 'ma_vol': np.random.rand(10)})
df.index = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10]

df['day_of_week'] = df['time'].dt.dayofweek
df['time_of_day'] = df['time'].dt.time

res = df.groupby(['day_of_week', 'time_of_day'])['ma_vol'].rolling(window=5, min_periods=1).mean().reset_index(level=[0,1], drop=True).sort_index()

df['mean_ma_vol'] = res
print(df)
