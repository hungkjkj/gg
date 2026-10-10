# PhÃ¢n tÃ­ch ká»¹ thuáº­t & CÃ´ng thá»©c Chá»‰ bÃ¡o (tech.md)

DÆ°á»›i Ä‘Ã¢y lÃ  100% mÃ£ nguá»“n (code) sao chÃ©p nguyÃªn báº£n tá»« lÃµi `backend/main.py` ÄÃƒ ÄÆ¯á»¢C LÆ¯á»¢C Bá»Ž Táº¤T Cáº¢ ATR VÃ€ BIáº¾N NORM_LENGTH. Báº¡n dá»… dÃ ng rÃ  soÃ¡t láº¡i toÃ n bá»™ cÃ´ng thá»©c tÃ­nh cÃ¡c chá»‰ bÃ¡o.

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

### 2. GiÃ¡ HL2 (Sá»­ dá»¥ng Volume-Weighted dá»±a trÃªn V_Target thay vÃ¬ hlc3)
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

### 3. VF-Momentum (Äá»™ng lÆ°á»£ng dÃ²ng tiá»n tinh khiáº¿t trÃªn biá»ƒu Ä‘á»“ chÃ­nh)
*(ÄÃ£ XÃ“A Bá»Ž hoÃ n toÃ n ATR)*
```python
    # --- New VF-Momentum Logic directly on current timeframe ---
    # 1. TÃ­nh V = percentile mfTargetPct cá»§a tá»•ng volume N náº¿n trong cá»­a sá»• chung
    target_vol_candles = max(1, int(mfTimeoutCandles))
    rolling_vol_N = df['value'].rolling(window=target_vol_candles, min_periods=1).sum()
    V_series = np.maximum(rolling_vol_N.rolling(window=lookback_candles, min_periods=1).quantile(mfTargetPct / 100.0).fillna(1.0).values, 1.0)
    
    cum_vol = df['value'].cumsum().values
    
    # --- New User-defined Momentum Formula ---
    # Äá»™ng lÆ°á»£ng tá»©c thá»i cá»§a tá»«ng náº¿n (quy vá» % thay vÃ¬ giÃ¡ tuyá»‡t Ä‘á»‘i): ((hlc3 - hlc3_pre) / hlc3_pre) * 100 * vol
    hlc3_pre = df['hlc3'].shift(1).fillna(df['hlc3'])
    df['hlc3_diff_pct'] = np.where(hlc3_pre > 0, (df['hlc3'] - hlc3_pre) / hlc3_pre * 100, 0.0)
    df['candle_mom'] = df['hlc3_diff_pct'] * df['value']
    cum_candle_mom = df['candle_mom'].cumsum().values
    
    n = len(df)
    i_arr = np.arange(n)
    
    # V-block hiá»‡n táº¡i
    target_current = cum_vol - V_series
    j_current = np.searchsorted(cum_vol, target_current, side='right')
    j_cur_m1 = np.where(j_current > 0, j_current - 1, 0)
    has_j_cur = j_current > 0
    
    vol_cur = cum_vol - np.where(has_j_cur, cum_vol[j_cur_m1], 0)
    net_mom_cur = cum_candle_mom - np.where(has_j_cur, cum_candle_mom[j_cur_m1], 0)
    
    # N = sá»‘ lÆ°á»£ng náº¿n trong V-block
    N_candles = np.maximum(i_arr - j_current + 1, 1.0)
    
    # Trung bÃ¬nh cá»™ng Ä‘á»™ng lÆ°á»£ng trong V-block (net_mom_cur / V_series) 
    df['mom_raw_raw'] = np.where(vol_cur > 0, net_mom_cur / V_series, 0.0)
    df['abs_mom_raw'] = df['mom_raw_raw'].abs()
```

### 4. Mom Flip (PhÃ¢n phá»‘i vÃ  Lá»c khá»‘i lÆ°á»£ng Ä‘á»ƒ tÃ¬m Ä‘iá»ƒm bá»©t phÃ¡)
```python
    # TÃ­nh median Ä‘á»™ng lÆ°á»£ng trong chu ká»³ N giá»
    rolling_median_mom = df['abs_mom_raw'].rolling(window=lookback_candles, min_periods=1).median().replace(0, np.nan).fillna(1e-9)
    
    # --- Momentum Flip ---
    # SMA Moment: trung bÃ¬nh cá»™ng Ä‘á»™ lá»›n momentum cá»§a N náº¿n gáº§n nháº¥t (khÃ´ng tÃ­nh náº¿n hiá»‡n táº¡i)
    sma_mom_window = max(1, smaMomLength)
    sma_mom = df['abs_mom_raw'].shift(1).rolling(window=sma_mom_window, min_periods=1).mean().replace(0, np.nan).fillna(1e-9)
    # há»‡ sá»‘ flip = Ä‘á»™ng lÆ°á»£ng hiá»‡n táº¡i / SMA moment (so sÃ¡nh vá»›i trung bÃ¬nh N náº¿n thay vÃ¬ chá»‰ 1 náº¿n trÆ°á»›c)
    flip_ratio = df['abs_mom_raw'] / sma_mom
    # Theo chuáº©n cá»§a báº¡n: Flip Metric chá»‰ Ä‘Æ¡n giáº£n lÃ  gia tá»‘c bá»©t phÃ¡ so vá»›i sá»± á»³ áº¡ch gáº§n nháº¥t
    mom_flip_metric = flip_ratio
    
    # --- Khá»‘i lÆ°á»£ng trung bÃ¬nh cá»§a V-block ---
    df['vblock_avg_vol'] = vol_cur / np.maximum(i_arr - j_current + 1, 1.0)
    
    # 1. TÃ­nh ngÆ°á»¡ng lá»c flip dá»±a trÃªn pháº§n trÄƒm mom ngÆ°á»i dÃ¹ng chá»n
    filter_threshold = df['abs_mom_raw'].rolling(window=lookback_candles, min_periods=1).quantile(momFlipFilterPct / 100.0)
    mom_valid_mask = df['abs_mom_raw'] >= filter_threshold
    
    # 2. Táº¡o Series volume chá»‰ chá»©a nhá»¯ng náº¿n thoáº£ mÃ£n mom (DÃ¹ng khá»‘i lÆ°á»£ng trung bÃ¬nh cá»§a V-block)
    vol_valid = df['vblock_avg_vol'].where(mom_valid_mask, np.nan)
    
    # 3. TÃ­nh ngÆ°á»¡ng lá»c volume trÃªn chÃ­nh nhÃ³m Ä‘Ã£ lá»c mom
    vol_filter_threshold = vol_valid.rolling(window=lookback_candles, min_periods=1).quantile(momFlipVolFilterPct / 100.0)
    
    # 4. Valid mask cuá»‘i cÃ¹ng lÃ  thoáº£ mÃ£n cáº£ hai
    valid_mask = mom_valid_mask & (df['vblock_avg_vol'] >= vol_filter_threshold)

    mom_flip_metric_valid = mom_flip_metric.where(valid_mask, np.nan)
    
    df['mom_flip'] = mom_flip_metric_valid.rolling(window=lookback_candles, min_periods=1).rank(pct=True, method='max') * 100.0
```

### 5. Normalized Volume (Khá»‘i lÆ°á»£ng chuáº©n hÃ³a theo Median hiá»‡n táº¡i)
```python
    # --- TÃ­nh toÃ¡n Normalized Volume ---
    df['vol_median'] = df['value'].rolling(window=lookback_candles, min_periods=1).median()
    df['norm_vol'] = np.where(df['vol_median'] > 0, df['value'] / df['vol_median'], 0)
    df['ma_vol'] = pd.Series(df['norm_vol']).rolling(window=ma_vol_window, min_periods=1).mean()
```

### 6. RVOL (Khá»‘i lÆ°á»£ng tÆ°Æ¡ng Ä‘á»‘i xÃ©t theo NgÃ y & Giá»)
```python
    # --- TÃ­nh toÃ¡n RVol (Relative Volume theo cÃ¹ng khung giá» & cÃ¹ng thá»© trong tuáº§n) ---
    df['broker_dt'] = pd.to_datetime(df['broker_time'], unit='s')
    df['time_of_day'] = df['broker_dt'].dt.time
    df['day_of_week'] = df['broker_dt'].dt.dayofweek
    df['rvol_mean'] = df.groupby(['day_of_week', 'time_of_day'])['value'].transform(lambda x: x.rolling(window=rvolLookbackDays, min_periods=1).mean())
    df['rvol'] = np.where(df['rvol_mean'] > 0, df['value'] / df['rvol_mean'], 0)
```

### 7. Há»‡ thá»‘ng Xáº¿p háº¡ng Tiá»n tá»‡ (Matrix)
*(Há»— trá»£ Ä‘á»“ng thá»i 2 cháº¿ Ä‘á»™: Sá»©c máº¡nh DÃ²ng tiá»n vÃ  Xu hÆ°á»›ng GiÃ¡)*
```python
        # TÃŒM V-BLOCK (V_TARGET) DÃ™NG CHUNG CHO Cáº¢ HAI CHáº¾ Äá»˜
        lookback_candles = int(vol_days * 24 * candles_per_hour)
        target_pct = config.get('mfTargetPct', 75) / 100.0
        rolling_vol_N = df['vol_rolling']
        V_series = np.maximum(rolling_vol_N.rolling(window=lookback_candles, min_periods=1).quantile(target_pct).fillna(1.0).values, 1.0)
        
        cum_vol = df['value'].cumsum().values
        cum_vwap_vol = df['vwap_vol'].cumsum().values
        
        n = len(df)
        i_arr = np.arange(n)
        
        target_current = cum_vol - V_series
        j_current = np.searchsorted(cum_vol, target_current, side='right')
        j_cur_m1 = np.where(j_current > 0, j_current - 1, 0)
        has_j_cur = j_current > 0
        
        vol_cur = cum_vol - np.where(has_j_cur, cum_vol[j_cur_m1], 0)
        N_candles = np.maximum(i_arr - j_current + 1, 1.0)

        if matrix_mode == "money_flow":
            # VF-Momentum Logic
            hlc3_pre = df['hlc3'].shift(1).fillna(df['hlc3'])
            df['hlc3_diff_pct'] = np.where(hlc3_pre > 0, (df['hlc3'] - hlc3_pre) / hlc3_pre * 100, 0.0)
            df['candle_mom'] = df['hlc3_diff_pct'] * df['value']
            cum_candle_mom = df['candle_mom'].cumsum().values
            
            net_mom_cur = cum_candle_mom - np.where(has_j_cur, cum_candle_mom[j_cur_m1], 0)
            
            # Scale láº¡i báº±ng chÃ­nh window_size (chuáº©n hoÃ¡)
            df['diff_pct'] = np.where(vol_cur > 0, (net_mom_cur / V_series) * window_size, 0.0)
        else:
            # TREND MODE (True C-VWMA Velocity dá»±a trÃªn V-block)
            vwap_vol_cur = cum_vwap_vol - np.where(has_j_cur, cum_vwap_vol[j_cur_m1], 0)
            c_vwap = np.where(vol_cur > 0, vwap_vol_cur / vol_cur, df['hlc3'])
            
            hlc3_values = df['hlc3'].values
            # Láº¥y HLC3 cá»§a cÃ¢y náº¿n liá»n trÆ°á»›c khi báº¯t Ä‘áº§u V-block
            hlc3_old = hlc3_values[j_cur_m1]
            
            # QuÃ£ng Ä‘Æ°á»ng: TÃ­nh pháº§n trÄƒm thay Ä‘á»•i
            distance_pct = np.where(hlc3_old > 0, (c_vwap - hlc3_old) / hlc3_old * 100.0, 0.0)
            
            # Váº­n tá»‘c: QuÃ£ng Ä‘Æ°á»ng chia cho thá»i gian (sá»‘ náº¿n cá»§a V-block)
            # NhÃ¢n window_size Ä‘á»ƒ scale sá»‘ lÃªn má»©c dá»… nhÃ¬n (tÆ°Æ¡ng Ä‘Æ°Æ¡ng vá»›i Money Flow)
            df['diff_pct'] = (distance_pct / N_candles) * window_size
        
        if len(df) > window_size:
            if matrix_mode == "money_flow":
                # Äá»‘i vá»›i dÃ²ng tiá»n, láº¥y trung bÃ¬nh cá»­a sá»• Ä‘á»ƒ giáº£m nhiá»…u cá»¥c bá»™ vÃ  á»•n Ä‘á»‹nh tÃ­n hiá»‡u
                window_diff = df['diff_pct'].iloc[-window_size:]
                diff_pct_current = window_diff.mean()
            else:
                # C-VWMA Ä‘Ã£ ráº¥t mÆ°á»£t (khÃ´ng bá»‹ nhiá»…u bá»Ÿi 1 cÃ¢y náº¿n), láº¥y trá»±c tiáº¿p % cá»§a náº¿n hiá»‡n táº¡i Ä‘á»ƒ khÃ´ng bá»‹ trá»… (lag)
                diff_pct_current = df['diff_pct'].iloc[-1]
```

### 8. Tối ưu Hoá Backtest (High-Speed Engine)
Hệ thống backtest được thiết kế để chịu tải hiển thị với tốc độ lên đến 100x (tương đương 100 nến/giây) mà không gây sập API hay tràn RAM, thông qua 3 cơ chế:
1. **Smart Candle Grouping:** Khi người dùng chọn tốc độ tua từ 50x trở lên, Frontend sẽ gộp số nến cần nhảy vào một bước (Tick) để giới hạn tần số gọi API tối đa ở mức 10 requests/giây. (Ví dụ tốc độ 50x = 5 nến/tick = 10 ticks/s).
2. **Payload Slicing (Backend):** Khi API \/ohlcv\ nhận được tham số \latest_only = True\ cùng với \end_time\ ở chế độ Backtest, Backend sẽ không trả về cả lịch sử 10,000 nến. Nó chỉ trích xuất đúng 100 nến cuối cùng để Frontend nối (Append) vào bộ nhớ biểu đồ, giảm tải băng thông 99%.
3. **Matrix API Mutex Lock:** Bong bóng tương tác (Assistive Bubble) có tính năng cập nhật ma trận liên tục theo thời gian thực (Real-time). Khi Backtest tua nhanh, một vòng khóa \isFetching\ được áp dụng để đảm bảo nếu máy chủ chưa tính xong 4 trục Matrix, Frontend sẽ tự động bỏ qua tín hiệu nhảy nến để không gây nghẽn hàng đợi Axios.
