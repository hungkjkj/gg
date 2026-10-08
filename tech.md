# Phân tích kỹ thuật & Công thức Chỉ báo (tech.md)

Dưới đây là 100% mã nguồn (code) sao chép nguyên bản từ lõi `backend/main.py` để bạn dễ dàng rà soát lại toàn bộ công thức tính các chỉ báo.

---

### 1. VWAP & SD Bands
```python
    # --- 1. VWAP & SD Bands ---
    df['hlc3'] = (df['high'] + df['low'] + df['close']) / 3
    df['vwap_vol'] = df['hlc3'] * df['value']
    
    vol_sum = df['value'].rolling(window=vwap_window, min_periods=1).sum()
    df['vwap'] = df['vwap_vol'].rolling(window=vwap_window, min_periods=1).sum() / vol_sum
    
    variance = ( ((df['hlc3'] - df['vwap'])**2) * df['value'] ).rolling(window=vwap_window, min_periods=1).sum() / vol_sum
    df['stdev'] = np.where((variance.notnull()) & (variance > 0), np.sqrt(variance), 0)
    
    df['upper_band'] = df['vwap'] + (df['stdev'] * vwapMult)
    df['lower_band'] = df['vwap'] - (df['stdev'] * vwapMult)
```

### 2. Giá HL2 (Sử dụng Volume-Weighted dựa trên V_Target thay vì hlc3)
```python
    # --- Money Flow: Constant-VWMA thay cho hl2 ---
    if len(df) > 0:
        lookback_sec = dvpLookbackDays * 24 * 3600
        last_time_val = df['time'].iloc[-1]
        start_time_val = last_time_val - lookback_sec
        df_lookback = df[df['time'] >= start_time_val]
        
        timeout_candles = max(1, int(mfTimeoutCandles))
        rolling_vols = df_lookback['value'].rolling(timeout_candles, min_periods=timeout_candles).sum().dropna()
        
        if len(rolling_vols) > 0:
            V = np.percentile(rolling_vols, mfTargetPct)
        else:
            V = 1.0
        V = max(V, 1.0)
        
        cum_vol = df['value'].cumsum().values
        cum_vwap_vol = df['vwap_vol'].cumsum().values
        
        target_v_raw = cum_vol - V
        target_v = np.maximum(target_v_raw, 0)
        j_arr = np.searchsorted(cum_vol, target_v, side='right')
        
        # Fractional interpolation
        marginal_vol = cum_vol[j_arr] - target_v
        price_array = df['hlc3'].values
        
        sum_vwap_vol = (cum_vwap_vol - cum_vwap_vol[j_arr]) + price_array[j_arr] * marginal_vol
        sum_vol = cum_vol - target_v
        
        safe_sum_vol = np.where(sum_vol > 0, sum_vol, 1.0)
        hl2_vals = np.where(sum_vol > 0, sum_vwap_vol / safe_sum_vol, df['hlc3'].values)
        
        df['hl2'] = hl2_vals
    else:
        df['hl2'] = df['hlc3']
```

### 3. ATR (Độ biến động trung bình)
```python
    # Window ATR calculation for Main Chart Momentum
    high_win = df['high'].rolling(window=mom_window, min_periods=1).max()
    low_win = df['low'].rolling(window=mom_window, min_periods=1).min()
    prev_close_win = df['close'].shift(mom_window).bfill()
    
    h_m_l = high_win - low_win
    h_m_pc = (high_win - prev_close_win).abs()
    l_m_pc = (low_win - prev_close_win).abs()
    tr_win = np.maximum(h_m_l, np.maximum(h_m_pc, l_m_pc))
    atr_window = mom_window
    df['atr'] = tr_win.ewm(alpha=1.0/atr_window, adjust=False).mean()
```

### 4. VF-Momentum (Động lượng dòng tiền tinh khiết trên biểu đồ chính)
```python
    # --- New VF-Momentum Logic directly on current timeframe ---
    # 1. Tính V = percentile mfTargetPct của tổng volume N nến (mom_window) trong cửa sổ chung
    target_vol_candles = max(1, int(mfTimeoutCandles))
    rolling_vol_N = df['value'].rolling(window=target_vol_candles, min_periods=1).sum()
    V_series = np.maximum(rolling_vol_N.rolling(window=lookback_candles, min_periods=1).quantile(mfTargetPct / 100.0).fillna(1.0).values, 1.0)
    
    cum_vol = df['value'].cumsum().values
    
    # --- New User-defined Momentum Formula ---
    # Động lượng tức thời của từng nến: ((hlc3 - hlc3_pre) / atr) * vol
    df['hlc3_diff'] = df['hlc3'] - df['hlc3'].shift(1).fillna(df['hlc3'])
    safe_atr = np.where(df['atr'].values > 0, df['atr'].values, 1e-9)
    df['candle_mom'] = (df['hlc3_diff'] / safe_atr) * df['value']
    cum_candle_mom = df['candle_mom'].cumsum().values
    
    n = len(df)
    i_arr = np.arange(n)
    
    # V-block hiện tại
    target_current = cum_vol - V_series
    j_current = np.searchsorted(cum_vol, target_current, side='right')
    j_cur_m1 = np.where(j_current > 0, j_current - 1, 0)
    has_j_cur = j_current > 0
    
    vol_cur = cum_vol - np.where(has_j_cur, cum_vol[j_cur_m1], 0)
    net_mom_cur = cum_candle_mom - np.where(has_j_cur, cum_candle_mom[j_cur_m1], 0)
    
    # N = số lượng nến trong V-block
    N_candles = np.maximum(i_arr - j_current + 1, 1.0)
    
    # Trung bình cộng động lượng trong V-block (net_mom_cur / V_series) đã tương đương với (Displacement / N)
    # Không nhân thêm mom_window, giữ nguyên giá trị nguyên bản
    df['mom_raw_raw'] = np.where((vol_cur > 0) & (df['atr'].values > 0), (net_mom_cur / V_series), 0.0)
    df['abs_mom_raw'] = df['mom_raw_raw'].abs()
```

### 5. Mom Flip (Phân phối và Lọc khối lượng để tìm điểm bứt phá)
```python
    # Tính median động lượng trong chu kỳ N giờ
    rolling_median_mom = df['abs_mom_raw'].rolling(window=lookback_candles, min_periods=1).median().replace(0, np.nan).fillna(1e-9)
    
    # --- Momentum Flip ---
    # SMA Moment: trung bình cộng độ lớn momentum của N nến gần nhất (không tính nến hiện tại)
    sma_mom_window = max(1, smaMomLength)
    sma_mom = df['abs_mom_raw'].shift(1).rolling(window=sma_mom_window, min_periods=1).mean().replace(0, np.nan).fillna(1e-9)
    # hệ số flip = động lượng hiện tại / SMA moment (so sánh với trung bình N nến thay vì chỉ 1 nến trước)
    flip_ratio = df['abs_mom_raw'] / sma_mom
    # Theo chuẩn của bạn: Flip Metric chỉ đơn giản là gia tốc bứt phá so với sự ỳ ạch gần nhất
    mom_flip_metric = flip_ratio
    
    # --- Khối lượng trung bình của V-block ---
    df['vblock_avg_vol'] = vol_cur / np.maximum(i_arr - j_current + 1, 1.0)
    
    # 1. Tính ngưỡng lọc flip dựa trên phần trăm mom người dùng chọn
    filter_threshold = df['abs_mom_raw'].rolling(window=lookback_candles, min_periods=1).quantile(momFlipFilterPct / 100.0)
    mom_valid_mask = df['abs_mom_raw'] >= filter_threshold
    
    # 2. Tạo Series volume chỉ chứa những nến thoả mãn mom (Dùng khối lượng trung bình của V-block)
    vol_valid = df['vblock_avg_vol'].where(mom_valid_mask, np.nan)
    
    # 3. Tính ngưỡng lọc volume trên chính nhóm đã lọc mom
    vol_filter_threshold = vol_valid.rolling(window=lookback_candles, min_periods=1).quantile(momFlipVolFilterPct / 100.0)
    
    # 4. Valid mask cuối cùng là thoả mãn cả hai
    valid_mask = mom_valid_mask & (df['vblock_avg_vol'] >= vol_filter_threshold)

    mom_flip_metric_valid = mom_flip_metric.where(valid_mask, np.nan)
    
    df['mom_flip'] = mom_flip_metric_valid.rolling(window=lookback_candles, min_periods=1).rank(pct=True, method='max') * 100.0
```

### 6. Normalized Volume (Khối lượng chuẩn hóa theo Median hiện tại)
```python
    # --- Tính toán Normalized Volume ---
    df['vol_median'] = df['value'].rolling(window=lookback_candles, min_periods=1).median()
    df['norm_vol'] = np.where(df['vol_median'] > 0, df['value'] / df['vol_median'], 0)
    df['ma_vol'] = pd.Series(df['norm_vol']).rolling(window=ma_vol_window, min_periods=1).mean()
```

### 7. RVOL (Khối lượng tương đối xét theo Ngày & Giờ)
```python
    # --- Tính toán RVol (Relative Volume theo cùng khung giờ & cùng thứ trong tuần) ---
    df['broker_dt'] = pd.to_datetime(df['broker_time'], unit='s')
    df['time_of_day'] = df['broker_dt'].dt.time
    df['day_of_week'] = df['broker_dt'].dt.dayofweek
    df['rvol_mean'] = df.groupby(['day_of_week', 'time_of_day'])['value'].transform(lambda x: x.rolling(window=rvolLookbackDays, min_periods=1).mean())
    df['rvol'] = np.where(df['rvol_mean'] > 0, df['value'] / df['rvol_mean'], 0)
```

### 8. Hệ thống Xếp hạng Tiền tệ (Matrix)
*(Đây là khối mã đã được cách ly hoàn toàn, dùng window_size thuần túy không nhân thêm timeout hay mom_length)*
```python
        # Window ATR calculation
        high_win = df['high'].rolling(window=window_size, min_periods=1).max()
        low_win = df['low'].rolling(window=window_size, min_periods=1).min()
        prev_close_win = df['close'].shift(window_size).bfill()
        
        h_m_l = high_win - low_win
        h_m_pc = (high_win - prev_close_win).abs()
        l_m_pc = (low_win - prev_close_win).abs()
        
        tr_win = np.maximum(h_m_l, np.maximum(h_m_pc, l_m_pc))
        atr_window = window_size
        df['atr'] = tr_win.ewm(alpha=1.0/atr_window, adjust=False).mean()

        # VF-Momentum Logic
        lookback_candles = int(vol_days * 24 * candles_per_hour)
        target_pct = config.get('mfTargetPct', 75) / 100.0
        rolling_vol_N = df['value'].rolling(window=window_size, min_periods=1).sum()
        V_series = np.maximum(rolling_vol_N.rolling(window=lookback_candles, min_periods=1).quantile(target_pct).fillna(1.0).values, 1.0)
        
        cum_vol = df['value'].cumsum().values
        df['hlc3_diff'] = df['hlc3'] - df['hlc3'].shift(1).fillna(df['hlc3'])
        safe_atr = np.where(df['atr'].values > 0, df['atr'].values, 1e-9)
        df['candle_mom'] = (df['hlc3_diff'] / safe_atr) * df['value']
        cum_candle_mom = df['candle_mom'].cumsum().values
        
        n = len(df)
        i_arr = np.arange(n)
        
        target_current = cum_vol - V_series
        j_current = np.searchsorted(cum_vol, target_current, side='right')
        j_cur_m1 = np.where(j_current > 0, j_current - 1, 0)
        has_j_cur = j_current > 0
        
        vol_cur = cum_vol - np.where(has_j_cur, cum_vol[j_cur_m1], 0)
        net_mom_cur = cum_candle_mom - np.where(has_j_cur, cum_candle_mom[j_cur_m1], 0)
        
        N_candles = np.maximum(i_arr - j_current + 1, 1.0)
        
        # Scale lại bằng chính window_size (thuần túy theo khung thời gian người dùng cấu hình)
        df['diff_pct'] = np.where((vol_cur > 0) & (df['atr'].values > 0), (net_mom_cur / V_series) * window_size, 0.0)
```
