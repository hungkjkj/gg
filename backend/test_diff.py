import pandas as pd
from mt5_service import initialize_mt5, get_historical_data

initialize_mt5()
pair = "USDJPY"
df = get_historical_data(pair, "H1", 50, 0, "Europe/Athens", False)
df['hlc3'] = (df['high'] + df['low'] + df['close']) / 3
df['vwap_vol'] = df['hlc3'] * df['tick_volume']
V = df['tick_volume'].iloc[-24:].sum()
cum_vol = df['tick_volume'].cumsum().values
cum_vwap_vol = df['vwap_vol'].cumsum().values
target_v = cum_vol - V
import numpy as np
idx_start_minus_1 = np.searchsorted(cum_vol, target_v, side='right') - 1
vwma_vals = np.zeros(len(df))
for i in range(len(df)):
    idx = idx_start_minus_1[i]
    if idx >= 0:
        sum_vol = cum_vol[i] - cum_vol[idx]
        sum_vwap_vol = cum_vwap_vol[i] - cum_vwap_vol[idx]
    else:
        sum_vol = cum_vol[i]
        sum_vwap_vol = cum_vwap_vol[i]
    vwma_vals[i] = sum_vwap_vol / sum_vol if sum_vol > 0 else df['hlc3'].iloc[i]
df['vwma'] = vwma_vals

n_hours = 24
current_vwma = df['vwma'].iloc[-1]
past_hlc3 = df['hlc3'].iloc[-n_hours]
diff_pct_current = ((current_vwma - past_hlc3) / past_hlc3) * 100
df['diff_pct'] = (df['vwma'] - df['hlc3'].shift(n_hours)) / df['hlc3'].shift(n_hours) * 100
diff_array = df['diff_pct'].fillna(0).values

print("diff_pct_current:", diff_pct_current)
print("diff_array[-1]:", diff_array[-1])
print("diff_array[-2]:", diff_array[-2])
