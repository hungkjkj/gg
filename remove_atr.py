import re

with open("backend/main.py", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove momLength parameter
content = re.sub(r'peakVolLookbackDays:\s*int\s*=\s*60,\s*momLength:\s*int\s*=\s*20,\s*matrixLookbackHours', 'peakVolLookbackDays: int = 60,\n              matrixLookbackHours', content)

# 2. Remove mom_window and mom_ma_window
content = re.sub(r'\s*mom_window\s*=\s*max\(1,\s*int\(\(momLength\s*\*\s*3600\)\s*/\s*tf_seconds\)\)', '', content)
content = re.sub(r'\s*mom_ma_window\s*=\s*mom_window', '', content)

# 3. Remove ATR block in get_ohlcv
atr_block_pattern = r'\s*# Window ATR calculation for Main Chart Momentum.*?df\[\'atr\'\]\s*=\s*tr_win\.ewm\(alpha=1\.0/atr_window,\s*adjust=False\)\.mean\(\)'
content = re.sub(atr_block_pattern, '', content, flags=re.DOTALL)

# 4. Remove safe_atr and change candle_mom
content = re.sub(r'\s*safe_atr\s*=\s*np\.where\(df\[\'atr\'\]\.values\s*>\s*0,\s*df\[\'atr\'\]\.values,\s*1e-9\)', '', content)
content = re.sub(r'df\[\'candle_mom\'\]\s*=\s*\(df\[\'hlc3_diff\'\]\s*/\s*safe_atr\)\s*\*\s*df\[\'value\'\]', 'df[\'candle_mom\'] = df[\'hlc3_diff\'] * df[\'value\']', content)

# 5. Change mom_raw_raw condition
content = re.sub(r'df\[\'mom_raw_raw\'\]\s*=\s*np\.where\(\(vol_cur\s*>\s*0\)\s*&\s*\(df\[\'atr\'\]\.values\s*>\s*0\),\s*\(net_mom_cur\s*/\s*V_series\),\s*0\.0\)', 'df[\'mom_raw_raw\'] = np.where(vol_cur > 0, net_mom_cur / V_series, 0.0)', content)

# 6. Remove mom_ma
content = re.sub(r'\s*df\[\'mom_ma\'\]\s*=\s*pd\.Series\(df\[\'abs_mom\'\]\)\.rolling\(window=mom_ma_window,\s*min_periods=1\)\.mean\(\)', '', content)

# 7. Remove ATR block in get_currency_matrix
matrix_atr_pattern = r'\s*# Window ATR calculation.*?df\[\'atr\'\]\s*=\s*tr_win\.ewm\(alpha=1\.0/atr_window,\s*adjust=False\)\.mean\(\)'
content = re.sub(matrix_atr_pattern, '', content, flags=re.DOTALL)

# 8. Change matrix diff_pct condition
content = re.sub(r'df\[\'diff_pct\'\]\s*=\s*np\.where\(\(vol_cur\s*>\s*0\)\s*&\s*\(df\[\'atr\'\]\.values\s*>\s*0\),\s*\(net_mom_cur\s*/\s*V_series\)\s*\*\s*window_size,\s*0\.0\)', 'df[\'diff_pct\'] = np.where(vol_cur > 0, (net_mom_cur / V_series) * window_size, 0.0)', content)

with open("backend/main.py", "w", encoding="utf-8") as f:
    f.write(content)
print("Updated backend/main.py")
