import pandas as pd
import numpy as np

# Create dummy df
times = pd.date_range("2026-10-08", periods=1000, freq='5min')
df = pd.DataFrame({
    'time': times,
    'ma_vol': np.random.rand(1000)
})
df['day_of_week'] = df['time'].dt.dayofweek
df['time_of_day'] = df['time'].dt.time

res = df.groupby(['day_of_week', 'time_of_day'])['ma_vol'].rolling(window=5, min_periods=1).mean().reset_index(level=[0,1], drop=True).sort_index()

df['mean_ma_vol'] = res
print("NaN count:", df['mean_ma_vol'].isna().sum())
print(df.tail())
