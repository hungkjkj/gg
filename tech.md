# Phân tích kỹ thuật & Công thức Chỉ báo (tech.md)

Dưới đây là 100% mã nguồn (code) sao chép nguyên bản từ lõi `backend/main.py` ĐÃ ĐƯỢC LƯỢC BỎ TẤT CẢ ATR VÀ BIẾN NORM_LENGTH. Bạn dễ dàng rà soát lại toàn bộ công thức tính các chỉ báo.

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

### 3. VF-Momentum (Động lượng dòng tiền tinh khiết trên biểu đồ chính)
*(Đã XÓA BỎ hoàn toàn ATR)*
```python
    # --- New VF-Momentum Logic directly on current timeframe ---
    # 1. Tính V = percentile mfTargetPct của tổng volume N nến trong cửa sổ chung
    target_vol_candles = max(1, int(mfTimeoutCandles))
    rolling_vol_N = df['value'].rolling(window=target_vol_candles, min_periods=1).sum()
    V_series = np.maximum(rolling_vol_N.rolling(window=lookback_candles, min_periods=1).quantile(mfTargetPct / 100.0).fillna(1.0).values, 1.0)
    
    cum_vol = df['value'].cumsum().values
    
    # --- New User-defined Momentum Formula ---
    # Động lượng tức thời của từng nến (quy về % thay vì giá tuyệt đối): ((hlc3 - hlc3_pre) / hlc3_pre) * 100 * vol
    hlc3_pre = df['hlc3'].shift(1).fillna(df['hlc3'])
    df['hlc3_diff_pct'] = np.where(hlc3_pre > 0, (df['hlc3'] - hlc3_pre) / hlc3_pre * 100, 0.0)
    df['candle_mom'] = df['hlc3_diff_pct'] * df['value']
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
    
    # Trung bình cộng động lượng trong V-block (net_mom_cur / V_series) 
    df['mom_raw_raw'] = np.where(vol_cur > 0, net_mom_cur / V_series, 0.0)
    df['abs_mom_raw'] = df['mom_raw_raw'].abs()
```

### 4. Mom Flip (Phân phối và Lọc khối lượng để tìm điểm bứt phá)
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

### 5. Normalized Volume (Khối lượng chuẩn hóa theo Median hiện tại)
```python
    # --- Tính toán Normalized Volume ---
    df['vol_median'] = df['value'].rolling(window=lookback_candles, min_periods=1).median()
    df['norm_vol'] = np.where(df['vol_median'] > 0, df['value'] / df['vol_median'], 0)
    df['ma_vol'] = pd.Series(df['norm_vol']).rolling(window=ma_vol_window, min_periods=1).mean()
```

### 6. RVOL (Khối lượng tương đối xét theo Ngày & Giờ)
```python
    # --- Tính toán RVol (Relative Volume theo cùng khung giờ & cùng thứ trong tuần) ---
    df['broker_dt'] = pd.to_datetime(df['broker_time'], unit='s')
    df['time_of_day'] = df['broker_dt'].dt.time
    df['day_of_week'] = df['broker_dt'].dt.dayofweek
    df['rvol_mean'] = df.groupby(['day_of_week', 'time_of_day'])['value'].transform(lambda x: x.rolling(window=rvolLookbackDays, min_periods=1).mean())
    df['rvol'] = np.where(df['rvol_mean'] > 0, df['value'] / df['rvol_mean'], 0)
```

### 7. Hệ thống Xếp hạng Tiền tệ (Matrix)
*(Hỗ trợ đồng thời 2 chế độ: Sức mạnh Dòng tiền và Xu hướng Giá)*
```python
        # TÌM V-BLOCK (V_TARGET) DÙNG CHUNG CHO CẢ HAI CHẾ ĐỘ
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
            
            # Scale lại bằng chính window_size (chuẩn hoá)
            df['diff_pct'] = np.where(vol_cur > 0, (net_mom_cur / V_series) * window_size, 0.0)
        else:
            # TREND MODE: Delta VWAP giữa 2 cục tiền bằng nhau (V_half = V_series / 2)
            V_half = V_series / 2.0
            target_mid = np.maximum(cum_vol - V_half, 0)
            j_mid = np.searchsorted(cum_vol, target_mid, side='right')
            j_mid_m1 = np.where(j_mid > 0, j_mid - 1, 0)
            has_j_mid = j_mid > 0

            # Cục sau (Recent Half): Từ target_mid đến nến hiện tại
            vol_after = cum_vol - np.where(has_j_mid, cum_vol[j_mid_m1], 0)
            vwap_vol_after = cum_vwap_vol - np.where(has_j_mid, cum_vwap_vol[j_mid_m1], 0)
            vwap_after = np.where(vol_after > 0, vwap_vol_after / np.maximum(vol_after, 1e-9), df['hlc3'])

            # Cục trước (Earlier Half): Từ target_current đến target_mid
            vol_before = np.where(has_j_mid, cum_vol[j_mid_m1], 0) - np.where(has_j_cur, cum_vol[j_cur_m1], 0)
            vwap_vol_before = np.where(has_j_mid, cum_vwap_vol[j_mid_m1], 0) - np.where(has_j_cur, cum_vwap_vol[j_cur_m1], 0)
            vwap_before = np.where(vol_before > 0, vwap_vol_before / np.maximum(vol_before, 1e-9), df['hlc3'])

            # Quãng đường: % Delta dịch chuyển giá vốn giữa cục sau và cục trước
            distance_pct = np.where(vwap_before > 0, (vwap_after - vwap_before) / vwap_before * 100.0, 0.0)

            # Vận tốc: Quãng đường chia cho thời gian (số nến của cả V-block), nhân window_size chuẩn hoá
            df['diff_pct'] = (distance_pct / N_candles) * window_size
        
        if len(df) > window_size:
            if matrix_mode == "money_flow":
                # Đối với dòng tiền, lấy trung bình cửa sổ để giảm nhiễu cục bộ và ổn định tín hiệu
                window_diff = df['diff_pct'].iloc[-window_size:]
                diff_pct_current = window_diff.mean()
            else:
                # C-VWMA đã rất mượt (không bị nhiễu bởi 1 cây nến), lấy trực tiếp % của nến hiện tại để không bị trễ (lag)
                diff_pct_current = df['diff_pct'].iloc[-1]
```

### 8. Tối ưu Hoá Backtest (High-Speed Engine)
Hệ thống backtest được thiết kế để chịu tải hiển thị với tốc độ lên đến 100x (tương đương 100 nến/giây) mà không gây sập API hay tràn RAM, thông qua 3 cơ chế:
1. **Smart Candle Grouping:** Khi người dùng chọn tốc độ tua từ 50x trở lên, Frontend sẽ gộp số nến cần nhảy vào một bước (Tick) để giới hạn tần số gọi API tối đa ở mức 10 requests/giây. (Ví dụ tốc độ 50x = 5 nến/tick = 10 ticks/s).
2. **Payload Slicing (Backend):** Khi API `/ohlcv` nhận được tham số `latest_only = True` cùng với `end_time` ở chế độ Backtest, Backend sẽ không trả về cả lịch sử 10,000 nến. Nó chỉ trích xuất đúng 100 nến cuối cùng để Frontend nối (Append) vào bộ nhớ biểu đồ, giảm tải băng thông 99%.
3. **Matrix API Mutex Lock:** Bong bóng tương tác (Assistive Bubble) có tính năng cập nhật ma trận liên tục theo thời gian thực (Real-time). Khi Backtest tua nhanh, một vòng khóa `isFetching` được áp dụng để đảm bảo nếu máy chủ chưa tính xong 4 trục Matrix, Frontend sẽ tự động bỏ qua tín hiệu nhảy nến để không gây nghẽn hàng đợi Axios. Ngoài ra, tốc độ lấy ma trận được khống chế (Throttle) tối đa 1 lần/giây để dành CPU cho việc vẽ nến.
4. **Vectorized Pandas Engine:** Thuật toán tính toán Volume quá khứ (`mean_ma_vol`) thay vì dùng vòng lặp `apply(lambda)` (tốn 10s cho M1) đã được chuyển sang cơ chế C-compiled `groupby().rolling().mean()` của Pandas. Thời gian xử lý backend giảm từ 10s xuống còn 50ms cho 10.000 cây nến M1.
5. **Dual Volume Series (Giải pháp vẽ tương lai):** Để giải quyết lỗi `Value is not ascending` của Lightweight Charts khi vừa muốn vẽ dự báo Volume trong tương lai, vừa muốn cập nhật tick Volume hiện tại (ở cả Livechart và Backtest), hệ thống Volume đã được chia làm 2 Series độc lập chồng lên nhau: `normVolSeries` (thực tế - nhận lệnh update liên tục) và `projectedVolSeries` (tương lai - load 1 lần bằng setData).
6. **Smart Timezone Alignment:** Hệ thống loại bỏ hoàn toàn sai lệch nhảy cóc nến (gaps) do cài đặt `timeShiftHours` bằng cách lột trần thời gian hiển thị về nguyên bản Unix Timestamp (UTC tuyệt đối) trước khi tính toán nhảy cóc cuối tuần. Nhờ vậy, thị trường Forex luôn đóng cửa chuẩn xác vào `22:00 Thứ Sáu (UTC)` và mở cửa vào `21:00 Chủ Nhật (UTC)`, cắt đứt chuỗi nến thừa mà không bị lệch múi giờ của người dùng. Riêng Crypto được phép vẽ liên tục.

### 9. Giao di?n ngu?i d�ng (UI/UX - J.A.R.V.I.S Theme)
To�n b? h? th?ng giao di?n du?c thi?t k? theo c?m h?ng t? h? di?u h�nh **J.A.R.V.I.S** (ho?c F.R.I.D.A.Y) c?a Iron Man, v?i c�c d?c di?m:
1. **Color Palette:** N?n Radial Gradient s�u th?m (Deep Space), di k�m v?i c�c du?ng vi?n v� text m�u Neon Cyan (l�i h? quang Arc Reactor). N?n tang s? d?ng m�u Cyan ph�t s�ng, n?n gi?m s? d?ng m�u Red/Amber d? c?nh b�o.
2. **Glassmorphism & Glowing:** C�c b?ng di?u khi?n v� bong b�ng ch?c nang du?c thi?t k? d?ng k�nh m? (backdrop-filter) k?t h?p v?i hi?u ?ng d? b�ng vi?n s�ng (Box-shadow glowing). C�c n�t b?m ph?n ?ng l?i (scale + s�ng l�n) khi hover.
3. **N�t tuong t�c Arc Reactor (AssistiveTouch):** N�t g?i ch?c nang m? r?ng du?c thi?t k? d?ng l�i h? quang li�n t?c t?a ra c�c l?p s�ng nang lu?ng.
4. **J.A.R.V.I.S Trading Log (S? Nh?t K�):** H? th?ng ghi ch�p du?c t�ch h?p th?ng v�o giao di?n du?i d?ng B?ng tru?t (Slide-in Panel). D? li?u du?c qu?n l� tr?c ti?p b?ng LocalStorage c?a tr�nh duy?t, cung c?p t?c d? ph?n h?i t?c th?i (Zero-latency) m� v?n d?m b?o t�nh b?n v?ng c?a d? li?u qua c�c l?n kh?i d?ng l?i.


## Update: Trading Journal & Volume Chart Fix
- Added an interactive Journal System (TradingLogPanel.jsx) allowing users to write logs and notes per symbol.
- Styled the TradingLogPanel using glassmorphism and animated sliding panel to match the Ironman suit UI theme.
- Fixed a major bug where olumeChart failed to render during backtest playback because its isPolling update logic was structurally isolated inside a dead else block.
- Removed obsolete test files to clean up the workspace.

## Update: RR Tool Time-Anchoring & Live Polling Stabilization
- **RR Tool Time-Anchoring (RrTool.jsx & App.jsx):**
  - Refactored Risk-to-Reward (RR) position tracking to anchor directly to immutable candle timestamps (`tool.time`) via `timeScale.timeToCoordinate(tool.time)` instead of transient bar indices (`tool.logical`).
  - Solved position drift/jumping to the end of the chart when data reloads (e.g. toggling Mean Vol mode, switching timeframes, or fetching extended history).
  - Preserved box width across zoom/pan via `barsCount` (default: 20 bars) and implemented seamless backward-compatibility auto-migration for existing tools.
  - Linked `lastUpdateSignal` to instantly re-align all RR boxes whenever fresh chart data arrives.
- **Live vs Backtest Polling Separation:**
  - Scoped the clearing of projected future volume (`projectedVolSeriesRef.setData([])`) and Volume Profile boxes (`setVpBoxes([])`) exclusively to backtest playback mode (`viewMode === 'backtest'`).
  - Ensured live chart users retain projected future volume bars and active Dynamic Volume Profile boxes without disruption during periodic 3-second background polling.
- **Intraday/Scalping Correlation Matrix Upgrade:**
  - Upgraded Correlation Matrix calculation in `backend/main.py` from H1 (`1h`) to M30 (`30min`) Log Returns.
  - Doubled the sample observation density within the same timeframe window, making Pearson correlation coefficients much more responsive to intraday session flows and breaking news while preserving macro trend relationships without noise.
- **Price Trend Mode 2-Equal-Blocks Delta VWAP Upgrade:**
  - Upgraded Price Trend mode in Currency/Asset Matrix: replaced single-candle `hlc3_old` reference with a dual-block Delta VWAP mechanism ($V_{half} = V_{series} / 2$).
  - Measures the direct Cost Basis Shift between the earlier volume half ($VWAP_1$) and the recent volume half ($VWAP_2$).
  - Eliminated single-candle wick/spread noise while preserving exact momentum velocity distribution and scaling $((distance_pct / N_candles) * window_size)$.
