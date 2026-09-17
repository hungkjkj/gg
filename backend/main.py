import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, ORJSONResponse
from pydantic import BaseModel
import pandas as pd
from typing import List, Optional
import concurrent.futures

# Nhập các hàm từ service MT5
from mt5_service import initialize_mt5, get_historical_data, shutdown_mt5, get_tick, _get_real_symbol

app = FastAPI(title="Quant Trading Dashboard API")

@app.middleware("http")
async def add_cache_control_header(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Cấu hình CORS để Frontend (React) có thể gọi API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import alert_service
import asyncio

@app.on_event("startup")
def startup_event():
    # Khởi tạo kết nối MT5 khi server chạy
    if not initialize_mt5():
        print("WARNING: Could not initialize MT5 on startup.")
    
    # Khởi động trình quét cảnh báo ngầm
    asyncio.create_task(alert_service.alert_worker())

@app.on_event("shutdown")
def shutdown_event():
    # Đóng kết nối khi tắt server
    shutdown_mt5()

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import json

CONFIG_FILE = "app_configs.json"

@app.get("/api/v1/configs")
def get_configs():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except:
            pass
    return {}

@app.post("/api/v1/configs")
def save_configs(config: dict):
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AlertModel(BaseModel):
    id: int
    symbol: str
    price: float
    note: str
    status: str

@app.get("/api/v1/alerts")
def get_alerts():
    return alert_service.get_alerts()

@app.post("/api/v1/alerts")
def create_alert(alert: AlertModel):
    return alert_service.add_alert(alert.dict())

@app.delete("/api/v1/alerts/{alert_id}")
def delete_alert(alert_id: int):
    alert_service.delete_alert(alert_id)
    return {"status": "success"}

import news_service

@app.get("/api/v1/catalyst")
def get_catalyst():
    """
    Lấy toàn bộ tin tức kinh tế trong tuần cho tab Catalyst.
    """
    try:
        events = news_service.get_weekly_news()
        return events
    except Exception as e:
        print("Lỗi lấy news catalyst:", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/catalyst/refresh")
def refresh_catalyst():
    """
    Xoá cache và cào lại toàn bộ tin tức từ ForexFactory.
    Dùng khi người dùng muốn cập nhật thủ công.
    """
    try:
        # Reset toàn bộ cache: xóa checked flag, xóa last_fetch
        news_service.NEWS_CACHE["data"] = []
        news_service.NEWS_CACHE["last_fetch"] = 0
        events = news_service.get_weekly_news()
        return {"status": "success", "count": len(events)}
    except Exception as e:
        print("Lỗi refresh catalyst:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/news")
def get_news(symbol: str):
    """
    Lấy tin tức kinh tế từ Forex Factory liên quan đến cặp tiền.
    """
    import time
    try:
        events = news_service.get_news_for_symbol(symbol)
        return {"status": "success", "data": events}
    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}

@app.get("/api/v1/symbols")
def get_all_symbols():
    """Lấy toàn bộ danh sách tài sản (symbols) từ MT5"""
    try:
        symbols = mt5_service.get_all_symbols()
        return {"status": "success", "data": symbols}
    except Exception as e:
        return {"status": "error", "message": str(e), "data": {}}

@app.get("/api/v1/news/backtest")
def get_backtest_news(symbol: str, timestamp: int):
    """
    Lấy tin tức lịch sử cho chế độ Backtest.
    Trả về tin tức của tuần chứa timestamp đã cho, lọc theo cặp tiền.
    """
    import time as time_mod
    try:
        all_events = news_service.get_backtest_news(timestamp)
        
        # Lọc theo cặp tiền
        currencies = []
        if len(symbol) >= 6:
            currencies = [symbol[0:3].upper(), symbol[3:6].upper()]
        else:
            currencies = [symbol.upper()]
            
        filtered = []
        for ev in all_events:
            country = ev["country"].upper()
            if country in currencies or country == "ALL":
                impact = ev["impact"].strip()
                if impact in ["High", "Medium", "Holiday"]:
                    filtered.append(ev.copy())
                    
        return {"status": "success", "data": filtered}
    except Exception as e:
        print(f"Backtest news error: {e}")
        return {"status": "error", "message": str(e), "data": []}

@app.get("/api/v1/ticks")
def get_ticks(symbols: str):
    """Lấy giá hiện tại của một danh sách symbols (phân tách bằng dấu phẩy)"""
    sym_list = [s.strip() for s in symbols.split(',') if s.strip()]
    if not sym_list:
        return {"status": "success", "data": {}}
        
    try:
        data = {}
        for sym in sym_list:
            tick = get_tick(sym)
            if tick:
                data[sym] = tick
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/ohlcv", response_class=ORJSONResponse)
def get_ohlcv(symbol: str, timeframe: str, count: int = 10000, 
              end_time: int = 0, latest_only: bool = False,
              pct1: float = 75.0, pct2: float = 85.0, 
              gridMode: str = "auto", fixedPips: float = 10.0,
              rowCount: int = 50, timeoutHours: float = 1.0, dvpLookbackHours: float = 120.0,
              vwapLength: int = 89, vwapMult: float = 2.0,
              rvolLookbackDays: int = 10, peakVolLookbackDays: int = 60,
              momLength: int = 20, matrixLookbackHours: float = 89.0,
              momPct1: float = 85.0, momPct2: float = 75.0, momPct3: float = 50.0,
              maVolLength: int = 2, momMaLength: int = 3,
              volPct1: float = 85.0, volPct2: float = 75.0, volPct3: float = 50.0, volPct4: float = 15.0,
              timeShiftHours: float = 0.0, browserOffsetHours: float = 7.0, autoDst: bool = True,
              asiaStart: str = "07:00", asiaEnd: str = "10:00",
              euroStart: str = "13:00", euroEnd: str = "16:00",
              usStart: str = "18:30", usEnd: str = "23:00",
              brokerTimezone: str = "Europe/Athens"):
    """
    Lấy dữ liệu OHLCV từ MT5 và tính toán Chỉ báo Nâng cao (D-VP & Momentum).
    """
    import numpy as np
    import pandas as pd
    
    df = get_historical_data(symbol, timeframe, count, end_time, brokerTimezone)
    
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for {symbol} on {timeframe}")
        
    # Chuẩn hoá giờ MT5 (giả định EET/EEST) về UTC 0 chuẩn
    broker_naive = pd.to_datetime(df['time'], unit='s')
    try:
        broker_aware = broker_naive.dt.tz_localize(brokerTimezone, nonexistent='shift_forward', ambiguous='NaT')
    except Exception as e:
        # Fallback to UTC if timezone is invalid
        broker_aware = broker_naive.dt.tz_localize('UTC')
    utc_aware = broker_aware.dt.tz_convert('UTC')
    df['broker_time'] = df['time'] # Lưu lại để fetch M1 nếu cần
    df['time'] = (utc_aware - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta('1s')
    df['time'] = df['time'].astype(int)
        
    tf_mapping = {
        'M1': 60,
        'M5': 300,
        'M15': 900,
        'M30': 1800,
        'H1': 3600,
        'H4': 14400,
        'D1': 86400
    }
    tf_seconds = tf_mapping.get(timeframe.upper(), 3600)
    
    vwap_window = max(1, int((vwapLength * 3600) / tf_seconds))
    mom_window = max(1, int((momLength * 3600) / tf_seconds))
    ma_vol_window = max(1, int((maVolLength * 3600) / tf_seconds))
    mom_ma_window = max(1, int((momMaLength * 3600) / tf_seconds))
    
    # --- 1. VWAP & SD Bands ---
    df['hlc3'] = (df['high'] + df['low'] + df['close']) / 3
    df['vwap_vol'] = df['hlc3'] * df['value']
    
    vol_sum = df['value'].rolling(window=vwap_window, min_periods=1).sum()
    df['vwap'] = df['vwap_vol'].rolling(window=vwap_window, min_periods=1).sum() / vol_sum
    
    variance = ( ((df['hlc3'] - df['vwap'])**2) * df['value'] ).rolling(window=vwap_window, min_periods=1).sum() / vol_sum
    df['stdev'] = variance.apply(lambda x: x**0.5 if pd.notnull(x) and x > 0 else 0)
    
    df['upper_band'] = df['vwap'] + (df['stdev'] * vwapMult)
    df['lower_band'] = df['vwap'] - (df['stdev'] * vwapMult)
    
    df['hl2'] = (df['high'] + df['low']) / 2.0
    
    # --- 2. Momentum & Normalized Volume (indi2.txt) ---
    df['body_mom'] = df['close'] - df['open']
    
    # TR calculation for ATR
    h_m_l = df['high'] - df['low']
    h_m_pc = (df['high'] - df['close'].shift(1)).abs()
    l_m_pc = (df['low'] - df['close'].shift(1)).abs()
    df['tr'] = np.maximum(h_m_l, np.maximum(h_m_pc.fillna(0), l_m_pc.fillna(0)))
    df['atr'] = df['tr'].rolling(window=mom_window, min_periods=1).mean()
    
    df['norm_body'] = np.where(df['atr'] > 0, df['body_mom'] / df['atr'], 0)
    
    df['sma_vol'] = df['value'].rolling(window=mom_window, min_periods=1).mean()
    df['rvol_mom'] = np.where(df['sma_vol'] > 0, df['value'] / df['sma_vol'], 0)
    
    df['mom_raw'] = df['norm_body'] * df['rvol_mom']
    
    # Tính toán các đường xác suất Momentum
    df['abs_mom'] = df['mom_raw'].abs()
    df['mom_ma'] = pd.Series(df['mom_raw']).rolling(window=mom_ma_window, min_periods=1).mean()
    
    lookback_candles = max(1, int((matrixLookbackHours * 3600) / tf_seconds))
    
    df['mom_lvl1'] = df['abs_mom'].rolling(window=lookback_candles, min_periods=1).quantile(momPct1 / 100.0)
    df['mom_lvl2'] = df['abs_mom'].rolling(window=lookback_candles, min_periods=1).quantile(momPct2 / 100.0)
    df['mom_lvl3'] = df['abs_mom'].rolling(window=lookback_candles, min_periods=1).quantile(momPct3 / 100.0)
    
    # --- Tính toán Normalized Volume ---
    df['vol_median'] = df['value'].rolling(window=lookback_candles, min_periods=1).median()
    df['norm_vol'] = np.where(df['vol_median'] > 0, df['value'] / df['vol_median'], 0)
    df['ma_vol'] = pd.Series(df['norm_vol']).rolling(window=ma_vol_window, min_periods=1).mean()
    
    df['vol_lvl1_raw'] = df['value'].rolling(window=lookback_candles, min_periods=1).quantile(volPct1 / 100.0)
    df['vol_lvl2_raw'] = df['value'].rolling(window=lookback_candles, min_periods=1).quantile(volPct2 / 100.0)
    df['vol_lvl3_raw'] = df['value'].rolling(window=lookback_candles, min_periods=1).quantile(volPct3 / 100.0)
    df['vol_lvl4_raw'] = df['value'].rolling(window=lookback_candles, min_periods=1).quantile(volPct4 / 100.0)
    
    df['vol_lvl1'] = np.where(df['vol_median'] > 0, df['vol_lvl1_raw'] / df['vol_median'], 0)
    df['vol_lvl2'] = np.where(df['vol_median'] > 0, df['vol_lvl2_raw'] / df['vol_median'], 0)
    df['vol_lvl3'] = np.where(df['vol_median'] > 0, df['vol_lvl3_raw'] / df['vol_median'], 0)
    df['vol_lvl4'] = np.where(df['vol_median'] > 0, df['vol_lvl4_raw'] / df['vol_median'], 0)
    
    # --- Tính toán RVol (Relative Volume theo cùng khung giờ) ---
    df['time_of_day'] = pd.to_datetime(df['broker_time'], unit='s').dt.time
    df['rvol_mean'] = df.groupby('time_of_day')['value'].transform(lambda x: x.rolling(window=rvolLookbackDays, min_periods=1).mean())
    df['rvol'] = np.where(df['rvol_mean'] > 0, df['value'] / df['rvol_mean'], 0)
    
    # --- Fetch M1 data BEFORE shifting df['time'] ---
    try:
        start_ts = int(df['broker_time'].min())
        end_ts = int(df['broker_time'].max()) + 3600
        real_sym = _get_real_symbol(symbol)
        m1_rates = mt5.copy_rates_range(real_sym, mt5.TIMEFRAME_M1, start_ts, end_ts)
        has_m1 = m1_rates is not None and len(m1_rates) > 0
        if has_m1:
            df_m1 = pd.DataFrame(m1_rates)
            # Chuẩn hoá M1 time về UTC
            m1_broker_naive = pd.to_datetime(df_m1['time'], unit='s')
            try:
                m1_broker_aware = m1_broker_naive.dt.tz_localize(brokerTimezone, nonexistent='shift_forward', ambiguous='NaT')
            except Exception:
                m1_broker_aware = m1_broker_naive.dt.tz_localize('UTC')
            m1_utc_aware = m1_broker_aware.dt.tz_convert('UTC')
            df_m1['time'] = (m1_utc_aware - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta('1s')
            df_m1['time'] = df_m1['time'].astype(int)
    except:
        has_m1 = False

    # Manual Time Shift requested by user
    df['time'] = df['time'] + (timeShiftHours * 3600)
    
    # --- Tính toán Background Sessions (Á, Âu, Mỹ) ---
    # true_utc_series is the actual UTC time of the candle
    true_utc_series = pd.to_datetime(df['time'] - (timeShiftHours * 3600), unit='s', utc=True)
    # user_local_series is the user's physical local time (based on browserOffsetHours)
    user_local_series = true_utc_series + pd.Timedelta(hours=browserOffsetHours)
    
    summer_offsets = {
        'America/New_York': pd.Timedelta(hours=-4),
        'Europe/London': pd.Timedelta(hours=1),
        'Asia/Tokyo': pd.Timedelta(hours=9)
    }
    
    def get_session_mask(start_str, end_str, tz_name):
        sh, sm = map(int, start_str.split(':'))
        eh, em = map(int, end_str.split(':'))
        start_min = sh * 60 + sm
        end_min = eh * 60 + em
        
        candle_min = user_local_series.dt.hour * 60 + user_local_series.dt.minute
        
        if autoDst and tz_name in summer_offsets:
            tz_series = true_utc_series.dt.tz_convert(tz_name)
            # Calculate utcoffset by subtracting naive UTC time from naive local time
            utcoffset = tz_series.dt.tz_localize(None) - true_utc_series.dt.tz_localize(None)
            dst_shift_mins = (utcoffset - summer_offsets[tz_name]).dt.total_seconds() / 60
        else:
            dst_shift_mins = pd.Series(0, index=df.index)
            
        target_start = (start_min - dst_shift_mins) % 1440
        target_end = (end_min - dst_shift_mins) % 1440
        
        cond_straight = (candle_min >= target_start) & (candle_min < target_end)
        cond_cross = (candle_min >= target_start) | (candle_min < target_end)
        
        result = np.where(target_start <= target_end, cond_straight, cond_cross)
        if tz_name == 'Asia/Tokyo':
            print(f"ASIA DEBUG:")
            print(f"start_min: {start_min}, end_min: {end_min}")
            print(f"target_start (first 5): {target_start.head().tolist()}")
            print(f"target_end (first 5): {target_end.head().tolist()}")
            print(f"dst_shift_mins (first 5): {dst_shift_mins.head().tolist() if isinstance(dst_shift_mins, pd.Series) else dst_shift_mins}")
            
            # Print the first candle that gets colored!
            colored_idx = np.where(result)[0]
            if len(colored_idx) > 0:
                first_idx = colored_idx[0]
                print(f"First colored candle at index {first_idx}:")
                print(f"df['time']: {df['time'].iloc[first_idx]}")
                print(f"user_local_time: {user_local_series.iloc[first_idx]}")
                print(f"candle_min: {candle_min.iloc[first_idx]}")
                
        return result

    in_asia = get_session_mask(asiaStart, asiaEnd, 'Asia/Tokyo')
    in_euro = get_session_mask(euroStart, euroEnd, 'Europe/London')
    in_us = get_session_mask(usStart, usEnd, 'America/New_York')
    
    df['session_color'] = None
    df.loc[in_asia, 'session_color'] = 'rgba(139, 69, 19, 0.18)' # Brown/Orange
    df.loc[in_euro, 'session_color'] = 'rgba(139, 0, 139, 0.18)' # Dark Purple
    df.loc[in_us, 'session_color'] = 'rgba(0, 0, 139, 0.18)' # Dark Blue
    
    # --- Thống kê Đỉnh/Đáy Vol theo Phase ---
    try:
        df_hm = user_local_series.dt.strftime('%H:%M')
        df_date = user_local_series.dt.date
    
        phase_s = pd.Series(0, index=df.index)
        phase_s.loc[in_asia] = 1
        phase_s.loc[in_euro] = 3
        phase_s.loc[in_us] = 5
        
        last_active = phase_s.replace(0, pd.NA).ffill()
        phase_s = phase_s.where(phase_s != 0, last_active + 1)
        phase_s = phase_s.fillna(6)
    
        try:
            lookback_ago = df_date.max() - pd.Timedelta(days=peakVolLookbackDays)
        except:
            lookback_ago = df_date.min()
            
        def get_mode_time(p_id, find_max=True):
            mask = (phase_s == p_id) & (df_date >= lookback_ago)
            if not mask.any(): return None
            subset = df[mask]
            if find_max:
                daily_idx = subset.groupby(df_date[mask])['value'].idxmax()
            else:
                daily_idx = subset.groupby(df_date[mask])['value'].idxmin()
                
            daily_idx = daily_idx.dropna()
            if daily_idx.empty: return None
            
            times = df_hm.loc[daily_idx]
            if times.empty: return None
            
            mode_val = times.mode()
            return mode_val.iloc[0] if not mode_val.empty else None
    
        vol_stats = {
            "aPeak": get_mode_time(1, True),
            "aeBtm": get_mode_time(2, False),
            "ePeak": get_mode_time(3, True),
            "euBtm": get_mode_time(4, False),
            "uPeak": get_mode_time(5, True),
            "uaBtm": get_mode_time(6, False)
        }
    except Exception as e:
        print(f"Error calculating vol_stats: {e}")
        vol_stats = {}
    
    # --- 3. Dynamic Volume Profile (D-VP State Machine) ---
    if gridMode == 'fixed':
        pip_size = 0.0001
        avg_price = df['close'].mean() if len(df) > 0 else 0
        
        if "JPY" in symbol or "GLOBAL_INDEX" in symbol or "XAG" in symbol:
            pip_size = 0.01
        elif "XAU" in symbol or "GOLD" in symbol:
            pip_size = 0.1
        elif "BTC" in symbol or "ETH" in symbol or "SOL" in symbol:
            pip_size = 1.0
        elif avg_price > 10000:
            pip_size = 1.0
        elif avg_price > 50:
            pip_size = 0.01
            
        bin_size = fixedPips * pip_size
        
        # Ngăn chặn việc bin_size quá nhỏ (gây lag nếu số lượng hộp > 1000)
        recent_min = df['low'].min()
        recent_max = df['high'].max()
        if recent_max - recent_min > 0 and bin_size > 0:
            if (recent_max - recent_min) / bin_size > 1000:
                bin_size = (recent_max - recent_min) / 1000
    else:
        lookback_bars = min(120, len(df))
        recent_df = df.tail(max(1, lookback_bars))
        recent_min = recent_df['low'].min()
        recent_max = recent_df['high'].max()
        bin_size = (recent_max - recent_min) / max(1, rowCount)
        
    if bin_size <= 0:
        bin_size = 0.0001
    tf_sec_map = { "M1": 60, "M5": 300, "M15": 900, "H1": 3600, "H4": 14400, "D1": 86400 }
    tf_seconds = tf_sec_map.get(timeframe.upper(), 3600)
    timeout_sec = max(timeoutHours * 3600, tf_seconds * 3)
    
    # --- Calculate D-VP Cutoff Time ---
    if dvpLookbackHours > 0 and len(df) > 0:
        last_time = df['time'].iloc[-1]
        dvp_cutoff_time = last_time - (dvpLookbackHours * 3600)
    else:
        dvp_cutoff_time = 0
        
    # --- Fetch M1 data for Precise D-VP ---
    if has_m1:
        df_m1['time'] = df_m1['time'] + (timeShiftHours * 3600)
        df_m1_filtered = df_m1[df_m1['time'] >= dvp_cutoff_time]
        times = df_m1_filtered['time'].values
        highs = df_m1_filtered['high'].values
        lows = df_m1_filtered['low'].values
        vols = df_m1_filtered['tick_volume'].values
    else:
        df_filtered = df[df['time'] >= dvp_cutoff_time]
        times = df_filtered['time'].values
        highs = df_filtered['high'].values
        lows = df_filtered['low'].values
        try:
            vols = df_filtered['value'].values
        except:
            vols = df_filtered['tick_volume'].values
    
    active_bins = {}
    completed_boxes = []
    
    for i in range(len(times)):
        t = times[i]
        h = highs[i]
        l = lows[i]
        v = vols[i]
        
        min_bin_idx = int(l / bin_size)
        max_bin_idx = int(h / bin_size)
        num_bins = max_bin_idx - min_bin_idx + 1
        vol_per_bin = v / num_bins
        
        for bin_idx in range(min_bin_idx, max_bin_idx + 1):
            if bin_idx not in active_bins:
                active_bins[bin_idx] = {'vol': vol_per_bin, 'start': t, 'end': t, 'last_touch': t}
            else:
                b = active_bins[bin_idx]
                if (t - b['last_touch']) > timeout_sec:
                    # Close old box, extend end to current time t
                    completed_boxes.append({
                        'bin_idx': bin_idx,
                        'price': bin_idx * bin_size + bin_size/2,
                        'vol': b['vol'],
                        'start': b['start'],
                        'end': t
                    })
                    # Start new box
                    active_bins[bin_idx] = {'vol': vol_per_bin, 'start': t, 'end': t, 'last_touch': t}
                else:
                    b['vol'] += vol_per_bin
                    b['end'] = t
                    b['last_touch'] = t
                    
    # Flush remaining active bins, extending them to the right edge of the chart
    last_time = times[-1] if len(times) > 0 else 0
    for bin_idx, b in active_bins.items():
        completed_boxes.append({
            'bin_idx': bin_idx,
            'price': bin_idx * bin_size + bin_size/2,
            'vol': b['vol'],
            'start': b['start'],
            'end': last_time # Active boxes extend to the right edge
        })
        
    all_vols = [b['vol'] for b in completed_boxes]
    if len(all_vols) > 0:
        val_95 = np.percentile(all_vols, 95)
        val_pct1 = np.percentile(all_vols, pct1)
        val_pct2 = np.percentile(all_vols, pct2)
    else:
        val_95 = val_pct1 = val_pct2 = 0
    
    main_times_sorted = np.sort(df['time'].values)
    
    vp_boxes = []
    for b in completed_boxes:
        if b['vol'] >= val_pct1:
            ratio = 0.0
            if val_95 > val_pct1:
                ratio = (b['vol'] - val_pct1) / (val_95 - val_pct1)
                ratio = max(0.0, min(1.0, ratio))
            
            # G (Green) value decreases from 180 to 0 as volume increases
            # This makes the color transition from Yellow-Orange to Pure Red
            g_val = int(180 * (1.0 - ratio))
            
            # Opacity increases from 0.35 to 0.75 as volume increases
            a_val = 0.35 + (0.4 * ratio)
            
            color = f"rgba(255, {g_val}, 0, {a_val:.2f})"
            level = f"Heat: {int(ratio*100)}%"
            
            # Map M1 timestamps to the closest available timestamp in the main series
            idx_start = np.searchsorted(main_times_sorted, b['start'], side='right') - 1
            if idx_start < 0: idx_start = 0
            mapped_start = main_times_sorted[idx_start]
            
            idx_end = np.searchsorted(main_times_sorted, b['end'], side='left')
            if idx_end >= len(main_times_sorted): idx_end = len(main_times_sorted) - 1
            mapped_end = main_times_sorted[idx_end]
                
            vp_boxes.append({
                'price': float(b['price']),
                'vol': float(b['vol']),
                'start': int(mapped_start),
                'end': int(mapped_end),
                'level': level,
                'color': color,
                'height': float(bin_size)
            })
            
    # No hack needed, df['time'] is already True UTC
    
    # Generate vertical lines for Volume Peaks/Bottoms
    v_lines = []
    if not df.empty:
        unique_dates_local = user_local_series.dt.strftime('%Y-%m-%d').unique()
        
        for date_str in unique_dates_local:
            for k, is_peak in [('aPeak', True), ('aeBtm', False), ('ePeak', True), ('euBtm', False), ('uPeak', True), ('uaBtm', False)]:
                hm = vol_stats.get(k)
                if hm:
                    dt_str = f"{date_str} {hm}:00"
                    local_dt = pd.to_datetime(dt_str)
                    true_utc_dt = local_dt - pd.Timedelta(hours=browserOffsetHours)
                    true_utc_ts = int(true_utc_dt.tz_localize('UTC').timestamp())
                    chart_ts = true_utc_ts + int(timeShiftHours * 3600)
                    v_lines.append({"time": chart_ts, "type": "peak" if is_peak else "btm"})
                
    vol_stats['v_lines'] = v_lines
    
    if latest_only:
        df = df.tail(2)
        
    cols_to_keep = ['time', 'open', 'high', 'low', 'close', 'value', 'vwap', 'upper_band', 'lower_band', 'hl2', 'mom_raw', 'mom_lvl1', 'mom_lvl2', 'mom_lvl3', 'norm_vol', 'rvol', 'ma_vol', 'mom_ma', 'vol_lvl1', 'vol_lvl2', 'vol_lvl3', 'vol_lvl4', 'session_color', 'spread']
    existing_cols = [c for c in cols_to_keep if c in df.columns]
    df = df[existing_cols]
        
    # Chuyển Dataframe sang dictionary (Thay thế NaN bằng None để JSON tương thích)
    df = df.replace({np.nan: None})
    records = df.to_dict(orient="records")
    
    return ORJSONResponse(content={
        "symbol": symbol, 
        "timeframe": timeframe, 
        "data": records,
        "indicators": {
            "vp_boxes": vp_boxes,
            "vol_stats": vol_stats
        }
    })

MATRIX_PROGRESS = {"currency": 0.0, "crypto": 0.0, "metals": 0.0}

@app.get("/api/v1/matrix/progress")
def get_matrix_progress(matrix_type: str = "currency"):
    return {"progress": MATRIX_PROGRESS.get(matrix_type, 0.0)}

@app.get("/api/v1/matrix")
async def get_currency_matrix(n_hours: int = 24, vol_days: int = 30, matrix_type: str = "currency", end_time: int = 0, brokerTimezone: str = "Europe/Athens"):
    if matrix_type == "crypto":
        currencies = ["BTC", "ETH", "SOL", "USD"]
        pairs = ["BTCUSD", "ETHUSD", "SOLUSD", "ETHBTC", "SOLBTC"]
    elif matrix_type == "metals":
        currencies = ["XAU", "XAG", "USD"]
        pairs = ["XAUUSD", "XAGUSD", "XAUXAG"]
    else:
        currencies = ["EUR", "GBP", "AUD", "NZD", "JPY", "USD"]
        pairs = [
            "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY",
            "EURGBP", "EURAUD", "EURNZD", "EURJPY",
            "GBPAUD", "GBPNZD", "GBPJPY",
            "AUDNZD", "AUDJPY",
            "NZDJPY"
        ]
    
    scores = {c: 0.0 for c in currencies}
    matrix_data = []
    total_pairs = len(pairs)
    
    MATRIX_PROGRESS[matrix_type] = 0.0
    count = max(n_hours + 25, vol_days * 24 + n_hours) # Lấy nến tuỳ thuộc vào N days volume hoặc chu kỳ matrix
    
    def process_pair(pair):
        df = get_historical_data(pair, "H1", count, end_time, brokerTimezone)
        if df is None or df.empty or len(df) < n_hours:
            return None
            
        df['vwma'] = (df['close'] * df['tick_volume']).rolling(window=20, min_periods=1).sum() / df['tick_volume'].rolling(window=20, min_periods=1).sum()
        df['vol_rolling'] = df['tick_volume'].rolling(window=n_hours, min_periods=1).sum()
        
        if len(df) > n_hours:
            current_vwma = df['vwma'].iloc[-1]
            past_vwma = df['vwma'].iloc[-n_hours]
            
            if pd.isna(current_vwma) or pd.isna(past_vwma) or past_vwma == 0:
                return None
                
            diff_pct = ((current_vwma - past_vwma) / past_vwma) * 100
            
            base_currency = pair[:3]
            quote_currency = pair[3:]
            
            hist_vol = df['vol_rolling'].iloc[-(vol_days * 24):].values
            
            return (pair, diff_pct, base_currency, quote_currency, hist_vol)
        return None

    # Chạy song song đa luồng để lấy dữ liệu 15 cặp siêu tốc
    with concurrent.futures.ThreadPoolExecutor(max_workers=total_pairs) as executor:
        results = list(executor.map(process_pair, pairs))
        
    vol_series_by_currency = {c: [] for c in currencies}
    
    for res in results:
        if res:
            pair, diff_pct, base_currency, quote_currency, hist_vol = res
            if base_currency in scores:
                scores[base_currency] += diff_pct
                if len(vol_series_by_currency[base_currency]) == 0:
                    vol_series_by_currency[base_currency] = hist_vol.copy()
                else:
                    length = min(len(vol_series_by_currency[base_currency]), len(hist_vol))
                    vol_series_by_currency[base_currency][-length:] += hist_vol[-length:]
                    
            if quote_currency in scores:
                scores[quote_currency] -= diff_pct
                if len(vol_series_by_currency[quote_currency]) == 0:
                    vol_series_by_currency[quote_currency] = hist_vol.copy()
                else:
                    length = min(len(vol_series_by_currency[quote_currency]), len(hist_vol))
                    vol_series_by_currency[quote_currency][-length:] += hist_vol[-length:]
                
            matrix_data.append({
                "pair": pair,
                "change_pct": round(diff_pct, 4)
            })

    # Xếp hạng currencies và tính Vol Percentile
    import numpy as np
    ranked_currencies = []
    for c in currencies:
        vol_arr = vol_series_by_currency[c]
        vol_percentile = 0.0
        if len(vol_arr) > 0:
            current_vol = vol_arr[-1]
            # Tính phần trăm số nến trong lịch sử nhỏ hơn khối lượng hiện tại
            percentile = np.mean(vol_arr < current_vol) * 100
            vol_percentile = round(percentile, 2)
            
        ranked_currencies.append({
            "currency": c,
            "score": round(scores[c], 4),
            "vol_percentile": vol_percentile
        })
        
    ranked_currencies = sorted(ranked_currencies, key=lambda x: x["score"], reverse=True)
    
    MATRIX_PROGRESS[matrix_type] = 100.0
    return {
        "n_hours": n_hours,
        "ranking": ranked_currencies,
        "pairs_data": matrix_data
    }

# Serve Frontend SPA
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
if os.path.exists(FRONTEND_DIST):
    # Phục vụ thư mục assets (CSS, JS)
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    # Phục vụ index.html cho các route còn lại
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
