import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, ORJSONResponse
from pydantic import BaseModel
import pandas as pd
import numpy as np
from typing import List, Optional
import concurrent.futures

# Nhập các hàm từ service MT5
import mt5_service
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
    asyncio.create_task(strategy_worker())

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
    type: str = "price"
    timeframe: str = ""

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

class StrategyModel(BaseModel):
    id: str
    symbol: str
    timeframe: str
    steps: list
    expiration_hours: float
    current_step_index: int = 0
    status: str = "active"
    configs: dict = {}

@app.get("/api/v1/strategies")
def get_strategies():
    return alert_service.get_strategies()

@app.post("/api/v1/strategies")
def create_strategy(strategy: StrategyModel):
    s_dict = strategy.dict()
    import time
    s_dict['created_at'] = time.time()
    return alert_service.add_strategy(s_dict)

@app.delete("/api/v1/strategies/{strategy_id}")
def delete_strategy(strategy_id: str):
    alert_service.delete_strategy(strategy_id)
    return {"status": "success"}

@app.put("/api/v1/strategies/{strategy_id}/reset")
def reset_strategy(strategy_id: str):
    return alert_service.update_strategy(strategy_id, {"current_step_index": 0, "status": "active"})


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
        currencies = news_service.extract_currencies(symbol)
            
        filtered = []
        for ev in all_events:
            country = ev["country"].upper()
            if country in currencies or country == "ALL" or country == "USD":
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
              rowCount: int = 50, timeoutHours: float = 1.0, dvpLookbackDays: float = 5.0, mfTargetPct: float = 50.0, mfTimeoutMins: float = 120.0,
              vwapLength: int = 89, vwapMult: float = 2.0,
              rvolLookbackDays: int = 10, peakVolLookbackDays: int = 60,
              momLength: int = 20, matrixLookbackHours: float = 89.0,
              momPct1: float = 85.0, momPct2: float = 75.0, momPct3: float = 50.0,
              maVolLength: int = 2, momMaLength: int = 3, smaMomLength: int = 10, momFlipFilterPct: float = 75.0, momFlipVolFilterPct: float = 50.0,
              volPct1: float = 85.0, volPct2: float = 75.0, volPct3: float = 50.0, volPct4: float = 15.0,
              timeShiftHours: float = 0.0, browserOffsetHours: float = 7.0, autoDst: bool = True,
              asiaStart: str = "07:00", asiaEnd: str = "10:00",
              euroStart: str = "13:00", euroEnd: str = "16:00",
              usStart: str = "18:30", usEnd: str = "23:00",
              brokerTimezone: str = "Europe/Athens"):
    """
    Lấy dữ liệu OHLCV từ MT5 và tính toán Chỉ báo Nâng cao (D-VP & Momentum).
    """    
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
    df = df.dropna(subset=['time']).copy()
    df['time'] = df['time'].astype(int)
        
    tf_mapping = {
        'M1': 60,
        'M5': 300,
        'M15': 900,
        'M30': 1800,
        'H1': 3600,
        'H4': 14400,
        'D1': 86400,
        'W1': 604800,
        'MN1': 2592000
    }
    tf_seconds = tf_mapping.get(timeframe.upper(), 3600)
    
    vwap_window = max(1, int((vwapLength * 3600) / tf_seconds))
    mom_window = max(1, int((momLength * 3600) / tf_seconds))
    ma_vol_window = max(1, int((maVolLength * 60) / tf_seconds))
    mom_ma_window = mom_window

    
    # --- 1. VWAP & SD Bands ---
    df['hlc3'] = (df['high'] + df['low'] + df['close']) / 3
    df['vwap_vol'] = df['hlc3'] * df['value']
    
    vol_sum = df['value'].rolling(window=vwap_window, min_periods=1).sum()
    df['vwap'] = df['vwap_vol'].rolling(window=vwap_window, min_periods=1).sum() / vol_sum
    
    variance = ( ((df['hlc3'] - df['vwap'])**2) * df['value'] ).rolling(window=vwap_window, min_periods=1).sum() / vol_sum
    df['stdev'] = np.where((variance.notnull()) & (variance > 0), np.sqrt(variance), 0)
    
    df['upper_band'] = df['vwap'] + (df['stdev'] * vwapMult)
    df['lower_band'] = df['vwap'] - (df['stdev'] * vwapMult)
    
    # --- Money Flow: Constant-VWMA thay cho hl2 ---
    if len(df) > 0:
        lookback_sec = dvpLookbackDays * 24 * 3600
        last_time_val = df['time'].iloc[-1]
        start_time_val = last_time_val - lookback_sec
        df_lookback = df[df['time'] >= start_time_val]
        
        timeout_candles = max(1, int(mfTimeoutMins))
        rolling_vols = df_lookback['value'].rolling(timeout_candles, min_periods=timeout_candles).sum().dropna()
        
        if len(rolling_vols) > 0:
            V = np.percentile(rolling_vols, mfTargetPct)
        else:
            V = 1.0
        V = max(V, 1.0)
        
        cum_vol = df['value'].cumsum().values
        cum_vwap_vol = df['vwap_vol'].cumsum().values
        target_v = cum_vol - V
        
        idx_start_minus_1 = np.searchsorted(cum_vol, target_v, side='right') - 1
        
        hl2_vals = np.zeros(len(df))
        for i in range(len(df)):
            idx = idx_start_minus_1[i]
            if idx >= 0:
                sum_vol = cum_vol[i] - cum_vol[idx]
                sum_vwap_vol = cum_vwap_vol[i] - cum_vwap_vol[idx]
            else:
                sum_vol = cum_vol[i]
                sum_vwap_vol = cum_vwap_vol[i]
                
            if sum_vol > 0:
                hl2_vals[i] = sum_vwap_vol / sum_vol
            else:
                hl2_vals[i] = df['hlc3'].iloc[i]
        df['hl2'] = hl2_vals
    else:
        df['hl2'] = (df['high'] + df['low']) / 2.0
    
    # Window ATR calculation for Main Chart Momentum
    high_win = df['high'].rolling(window=mom_window, min_periods=1).max()
    low_win = df['low'].rolling(window=mom_window, min_periods=1).min()
    prev_close_win = df['close'].shift(mom_window).bfill()
    
    h_m_l = high_win - low_win
    h_m_pc = (high_win - prev_close_win).abs()
    l_m_pc = (low_win - prev_close_win).abs()
    tr_win = np.maximum(h_m_l, np.maximum(h_m_pc, l_m_pc))
    atr_window = max(1, int(momLength * mom_window))
    df['atr'] = tr_win.rolling(window=atr_window, min_periods=1).mean()
    
    lookback_candles = max(1, int((matrixLookbackHours * 3600) / tf_seconds))
    
    # --- New VF-Momentum Logic directly on current timeframe ---
    sma_mom_window = max(1, smaMomLength)
    # 1. Tính V = percentile mfTargetPct của tổng volume N nến (sma_mom_window) trong cửa sổ chung
    rolling_vol_N = df['value'].rolling(window=sma_mom_window, min_periods=1).sum()
    V_series = np.maximum(rolling_vol_N.rolling(window=lookback_candles, min_periods=1).quantile(mfTargetPct / 100.0).fillna(1.0).values, 1.0)
    
    cum_vol = df['value'].cumsum().values
    cum_vwap_vol = (df['hl2'] * df['value']).cumsum().values
    n = len(df)
    i_arr = np.arange(n)
    
    # 2. V-block hiện tại
    target_current = cum_vol - V_series
    j_current = np.searchsorted(cum_vol, target_current, side='right')
    j_cur_m1 = np.where(j_current > 0, j_current - 1, 0)
    has_j_cur = j_current > 0
    vol_cur = cum_vol - np.where(has_j_cur, cum_vol[j_cur_m1], 0)
    vwap_cur_vol = cum_vwap_vol - np.where(has_j_cur, cum_vwap_vol[j_cur_m1], 0)
    safe_vol_cur = np.where(vol_cur > 0, vol_cur, 1.0)
    vwap_cur = np.where(vol_cur > 0, vwap_cur_vol / safe_vol_cur, df['hl2'].values)
    
    # 3. V-block trước đó (không chồng lấn)
    prev_end = j_current - 1
    valid_prev_end = prev_end >= 0
    prev_end_safe = np.where(valid_prev_end, prev_end, 0)
    
    target_prev = np.where(valid_prev_end, cum_vol[prev_end_safe] - V_series, -1)
    valid_prev = target_prev >= 0
    j_prev = np.searchsorted(cum_vol, target_prev, side='right')
    j_prev_m1 = np.where(j_prev > 0, j_prev - 1, 0)
    has_j_prev = j_prev > 0
    
    vol_prev = np.where(valid_prev_end, cum_vol[prev_end_safe] - np.where(has_j_prev, cum_vol[j_prev_m1], 0), 0)
    vwap_prev_vol = np.where(valid_prev_end, cum_vwap_vol[prev_end_safe] - np.where(has_j_prev, cum_vwap_vol[j_prev_m1], 0), 0)
    safe_vol_prev = np.where(vol_prev > 0, vol_prev, 1.0)
    vwap_prev = np.where(vol_prev > 0, vwap_prev_vol / safe_vol_prev, df['hl2'].values)
    
    full_valid = valid_prev_end & valid_prev & (vol_cur > 0) & (vol_prev > 0) & (df['atr'].values > 0)
    
    displacement = np.where(full_valid, vwap_cur - vwap_prev, 0)
    time_span = np.maximum(i_arr - j_current + 1, 1.0) / mom_window
    
    # 4. Độ dịch chuyển / atr / thời gian chuẩn hóa * Hệ số khuyếch đại Vol (vol_cur / V_series)
    vol_ratio = vol_cur / V_series
    df['mom_raw_raw'] = np.where(full_valid, ((displacement / df['atr'].values) / time_span) * vol_ratio, 0.0)
    df['abs_mom_raw'] = df['mom_raw_raw'].abs()
    
    # Tính median động lượng trong chu kỳ N giờ
    rolling_median_mom = df['abs_mom_raw'].rolling(window=lookback_candles, min_periods=1).median().replace(0, np.nan).fillna(1e-9)
    
    # --- Momentum Flip ---
    # SMA Moment: trung bình cộng độ lớn momentum của N nến gần nhất (không tính nến hiện tại)
    sma_mom_window = max(1, smaMomLength)
    sma_mom = df['abs_mom_raw'].shift(1).rolling(window=sma_mom_window, min_periods=1).mean().replace(0, np.nan).fillna(1e-9)
    # hệ số flip = động lượng hiện tại / SMA moment (so sánh với trung bình N nến thay vì chỉ 1 nến trước)
    flip_ratio = df['abs_mom_raw'] / sma_mom
    # nhân động lượng hiện tại / median động lượng, rồi nhân với hệ số flip
    mom_flip_metric = (df['abs_mom_raw'] / rolling_median_mom) * flip_ratio
    
    # 1. Tính ngưỡng lọc flip dựa trên phần trăm mom người dùng chọn
    filter_threshold = df['abs_mom_raw'].rolling(window=lookback_candles, min_periods=1).quantile(momFlipFilterPct / 100.0)
    mom_valid_mask = df['abs_mom_raw'] >= filter_threshold
    
    # 2. Tạo Series volume chỉ chứa những nến thoả mãn mom
    vol_valid = df['value'].where(mom_valid_mask, np.nan)
    
    # 3. Tính ngưỡng lọc volume trên chính nhóm đã lọc mom
    vol_filter_threshold = vol_valid.rolling(window=lookback_candles, min_periods=1).quantile(momFlipVolFilterPct / 100.0)
    
    # 4. Valid mask cuối cùng là thoả mãn cả hai
    valid_mask = mom_valid_mask & (df['value'] >= vol_filter_threshold)

    mom_flip_metric_valid = mom_flip_metric.where(valid_mask, np.nan)
    
    df['mom_flip'] = mom_flip_metric_valid.rolling(window=lookback_candles, min_periods=1).rank(pct=True, method='max') * 100.0
    
    # Tính toán các đường xác suất Momentum (Momentum đã chuẩn hóa theo median)
    df['mom_raw'] = df['mom_raw_raw'] / rolling_median_mom
    df['abs_mom'] = df['abs_mom_raw'] / rolling_median_mom
    df['mom_ma'] = pd.Series(df['abs_mom']).rolling(window=mom_ma_window, min_periods=1).mean()
    
    df['mom_lvl1'] = df['abs_mom'].rolling(window=lookback_candles, min_periods=1).quantile(momPct1 / 100.0)
    df['mom_lvl2'] = df['abs_mom'].rolling(window=lookback_candles, min_periods=1).quantile(momPct2 / 100.0)
    df['mom_lvl3'] = df['abs_mom'].rolling(window=lookback_candles, min_periods=1).quantile(momPct3 / 100.0)
    
    # Tính xếp hạng phần trăm của Động lượng (có dấu: -100% đến 100%)
    df['mom_percent_rank'] = df['abs_mom'].rolling(window=lookback_candles, min_periods=1).rank(pct=True, method='max') * 100.0 * np.sign(df['mom_raw_raw'])

    
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
    
    # --- Tính toán Mean MA Vol (Trung bình của ma_vol cùng giờ trong chu kỳ matrixLookbackHours) ---
    mean_vol_lookback_days = max(1, int(matrixLookbackHours / 24.0))
    df['mean_ma_vol'] = df.groupby('time_of_day')['ma_vol'].transform(lambda x: x.rolling(window=mean_vol_lookback_days, min_periods=1).mean())
    df['mean_vol_lvl1'] = df['mean_ma_vol'].rolling(window=lookback_candles, min_periods=1).quantile(volPct1 / 100.0)
    df['mean_vol_lvl2'] = df['mean_ma_vol'].rolling(window=lookback_candles, min_periods=1).quantile(volPct2 / 100.0)
    df['mean_vol_lvl3'] = df['mean_ma_vol'].rolling(window=lookback_candles, min_periods=1).quantile(volPct3 / 100.0)
    df['mean_vol_lvl4'] = df['mean_ma_vol'].rolling(window=lookback_candles, min_periods=1).quantile(volPct4 / 100.0)
    
    # --- Fetch M1 data BEFORE shifting df['time'] ---
    try:
        end_ts = int(df['broker_time'].max()) + 3600
        if dvpLookbackDays > 0:
            start_ts = max(int(df['broker_time'].min()), int(df['broker_time'].max()) - int(dvpLookbackDays * 24 * 3600))
        else:
            start_ts = int(df['broker_time'].min())
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
    is_macro_tf = timeframe.upper() in ['D1', 'W1', 'MN1']
    if not is_macro_tf:
        df['time'] = df['time'] + (timeShiftHours * 3600)
    
    # --- Tính toán Background Sessions (Á, Âu, Mỹ) ---
    # true_utc_series is the actual UTC time of the candle
    if not is_macro_tf:
        true_utc_series = pd.to_datetime(df['time'] - (timeShiftHours * 3600), unit='s', utc=True)
    else:
        true_utc_series = pd.to_datetime(df['time'], unit='s', utc=True)
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
        avg_price = df['close'].mean() if len(df) > 0 else 0
        if avg_price > 0:
            import math
            # Dynamic pip size based on EURUSD ratio
            ratio_pip = avg_price * (0.0001 / 1.10)
            pip_size = 10 ** math.floor(math.log10(ratio_pip))
        else:
            pip_size = 0.0001
            
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
        
    # BẢO VỆ CHỐNG TRÀN VÒNG LẶP D-VP DO QUÁ NHIỀU BINS
    global_min = df['low'].min()
    global_max = df['high'].max()
    if global_max - global_min > 0 and bin_size > 0:
        pass # Bỏ giới hạn số lượng hộp VP vì giao diện đã được vá lỗi hiệu năng đồ hoạ

    if bin_size <= 0:
        bin_size = 0.0001
    # Dùng lại tf_seconds đã tính ở trên (dòng 250) để tránh ghi đè và thiếu M30
    timeout_sec = max(timeoutHours * 3600, tf_seconds * 3)
    
    # --- Calculate D-VP Cutoff Time ---
    if dvpLookbackDays > 0 and len(df) > 0:
        last_time = df['time'].iloc[-1]
        dvp_cutoff_time = last_time - (dvpLookbackDays * 24 * 3600)
    else:
        dvp_cutoff_time = 0
        
    # --- Fetch M1 data for Precise D-VP ---
    if has_m1:
        # Chỉ shift M1 time trên TF thường, macro TF (D1/W1/MN1) không shift
        if not is_macro_tf:
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
                    local_dt = pd.to_datetime(dt_str, format="%Y-%m-%d %H:%M:%S")
                    true_utc_dt = local_dt - pd.Timedelta(hours=browserOffsetHours)
                    true_utc_ts = int(true_utc_dt.tz_localize('UTC').timestamp())
                    chart_ts = true_utc_ts + int(timeShiftHours * 3600)
                    v_lines.append({"time": chart_ts, "type": "peak" if is_peak else "btm"})
                
    vol_stats['v_lines'] = v_lines
    
    if latest_only:
        df = df.tail(2)
        
    future_records_to_append = []
    # Dự đoán tương lai (Append extra records for mean_vol mode until the end of the day)
    if not df.empty and not latest_only:
        last_broker_time = int(df['broker_time'].max())
        last_time = int(df['time'].max())
        
        next_broker_time = last_broker_time + tf_seconds
        next_time = last_time + tf_seconds
        
        # Tìm giá trị mean_ma_vol mới nhất cho mỗi time_of_day từ toàn bộ lịch sử (để tránh sót gap)
        latest_mean_vol = df.drop_duplicates(subset=['time_of_day'], keep='last').set_index('time_of_day')['mean_ma_vol'].to_dict()
        last_mean_vol_lvl1 = float(df['mean_vol_lvl1'].iloc[-1]) if not df.empty else None
        last_mean_vol_lvl2 = float(df['mean_vol_lvl2'].iloc[-1]) if not df.empty else None
        last_mean_vol_lvl3 = float(df['mean_vol_lvl3'].iloc[-1]) if not df.empty else None
        last_mean_vol_lvl4 = float(df['mean_vol_lvl4'].iloc[-1]) if not df.empty else None
        last_dt = pd.to_datetime(last_broker_time, unit='s')
        
        while True:
            dt = pd.to_datetime(next_broker_time, unit='s')
            if dt.day != last_dt.day:
                break
                
            tod = dt.time()
            mean_val = latest_mean_vol.get(tod)
            
            if mean_val is not None and not pd.isna(mean_val):
                future_records_to_append.append({
                    "time": next_time,
                    "mean_ma_vol": float(mean_val),
                    "mean_vol_lvl1": last_mean_vol_lvl1,
                    "mean_vol_lvl2": last_mean_vol_lvl2,
                    "mean_vol_lvl3": last_mean_vol_lvl3,
                    "mean_vol_lvl4": last_mean_vol_lvl4
                })
            else:
                # Phải thêm time rỗng để biểu đồ không bị nhảy quãng thời gian
                future_records_to_append.append({
                    "time": next_time
                })
            
            next_broker_time += tf_seconds
            next_time += tf_seconds

    cols_to_keep = ['time', 'open', 'high', 'low', 'close', 'value', 'vwap', 'upper_band', 'lower_band', 'hl2', 'mom_raw', 'mom_percent_rank', 'mom_lvl1', 'mom_lvl2', 'mom_lvl3', 'norm_vol', 'rvol', 'ma_vol', 'mean_ma_vol', 'mean_vol_lvl1', 'mean_vol_lvl2', 'mean_vol_lvl3', 'mean_vol_lvl4', 'mom_ma', 'mom_flip', 'vol_lvl1', 'vol_lvl2', 'vol_lvl3', 'vol_lvl4', 'session_color', 'spread']
    existing_cols = [c for c in cols_to_keep if c in df.columns]
    df = df[existing_cols]
        
    # Chuyển Dataframe sang dictionary (Thay thế NaN, Inf bằng None để JSON tương thích)
    for col in df.columns:
        if pd.api.types.is_numeric_dtype(df[col]):
            df[col] = df[col].replace([np.inf, -np.inf], np.nan)
    df = df.replace({np.nan: None})
    records = df.to_dict(orient="records")
    records.extend(future_records_to_append)
    
    # Save the latest mom_flip for alert checking
    if len(records) > 0 and 'mom_flip' in records[-1] and records[-1]['mom_flip'] is not None:
        import alert_service
        alert_service.LATEST_MOM_FLIP_DATA[f"{symbol}_{timeframe}"] = {
            'value': round(records[-1]['mom_flip'], 2),
            'time': records[-1]['time'],
            'prev_value': round(records[-2]['mom_flip'], 2) if len(records) > 1 and records[-2].get('mom_flip') is not None else round(records[-1]['mom_flip'], 2)
        }
        

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
_MATRIX_CACHE = {}
_MATRIX_CACHE_TIME = {}

@app.get("/api/v1/matrix/progress")
def get_matrix_progress(matrix_type: str = "currency"):
    return {"progress": MATRIX_PROGRESS.get(matrix_type, 0.0)}

@app.get("/api/v1/matrix")
async def get_currency_matrix(n_hours: int = 24, vol_days: int = 30, matrix_type: str = "fx", end_time: int = 0, brokerTimezone: str = "Europe/Athens"):
    import time
    cache_key = f"{n_hours}_{vol_days}_{matrix_type}_{end_time}_{brokerTimezone}"
    current_time = time.time()
    
    # Cache for 10 seconds to prevent concurrent overlap and UI progress reset
    if cache_key in _MATRIX_CACHE and current_time - _MATRIX_CACHE_TIME.get(cache_key, 0) < 10:
        return _MATRIX_CACHE[cache_key]
        
    import json
    config_path = os.path.join(os.path.dirname(__file__), "app_configs.json")
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
    except:
        config = {}
        
    if matrix_type == "fx" or matrix_type == "currency":
        currencies = ["EUR", "GBP", "AUD", "NZD", "JPY", "USD", "GI"]
        pairs = [
            "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY",
            "EURGBP", "EURAUD", "EURNZD", "EURJPY",
            "GBPAUD", "GBPNZD", "GBPJPY",
            "AUDNZD", "AUDJPY",
            "NZDJPY",
            "GLOBAL_INDEX"
        ]
    else:
        # Load from config for other groups
        group_symbols = config.get("matrix_groups", {}).get(matrix_type, [])
        if not group_symbols:
            return {"progress": 100.0, "ranking": [], "pairs_data": [], "matrix_type": matrix_type}
        
        gi_symbol = f"{matrix_type.upper()}_GI"
        currencies = group_symbols + [gi_symbol]
        pairs = group_symbols + [gi_symbol]
    
    scores = {c: 0.0 for c in currencies}
    matrix_data = []
    total_pairs = len(pairs)
    
    MATRIX_PROGRESS[matrix_type] = 0.0
    candles_per_hour = 12 # M5
    window_size = n_hours * candles_per_hour
    count = max(window_size + 25, int(vol_days * 24 * candles_per_hour * 1.5))
    
    def process_pair(pair):
        df = get_historical_data(pair, "M5", count, end_time, brokerTimezone, fallback_ea=False)
        if df is None or df.empty or len(df) < window_size:
            return None
            
        df['hlc3'] = (df['high'] + df['low'] + df['close']) / 3
        df['vwap_vol'] = df['hlc3'] * df['tick_volume']
        
        # Window ATR calculation
        high_win = df['high'].rolling(window=window_size, min_periods=1).max()
        low_win = df['low'].rolling(window=window_size, min_periods=1).min()
        prev_close_win = df['close'].shift(window_size).bfill()
        
        h_m_l = high_win - low_win
        h_m_pc = (high_win - prev_close_win).abs()
        l_m_pc = (low_win - prev_close_win).abs()
        
        tr_win = np.maximum(h_m_l, np.maximum(h_m_pc, l_m_pc))
        mom_length = config.get('momLength', 20)
        atr_window = int(mom_length * window_size)
        df['atr'] = tr_win.rolling(window=atr_window, min_periods=1).mean()

        # VF-Momentum Logic
        lookback_candles = int(vol_days * 24 * candles_per_hour)
        rolling_vol_N = df['value'].rolling(window=window_size, min_periods=1).sum()
        target_pct = config.get('mfTargetPct', 75) / 100.0
        V_series = np.maximum(rolling_vol_N.rolling(window=lookback_candles, min_periods=1).quantile(target_pct).fillna(1.0).values, 1.0)
        
        cum_vol = df['value'].cumsum().values
        cum_vwap_vol = (df['hlc3'] * df['value']).cumsum().values
        n = len(df)
        i_arr = np.arange(n)
        
        target_current = cum_vol - V_series
        j_current = np.searchsorted(cum_vol, target_current, side='right')
        j_cur_m1 = np.where(j_current > 0, j_current - 1, 0)
        has_j_cur = j_current > 0
        vol_cur = cum_vol - np.where(has_j_cur, cum_vol[j_cur_m1], 0)
        vwap_cur_vol = cum_vwap_vol - np.where(has_j_cur, cum_vwap_vol[j_cur_m1], 0)
        safe_vol_cur = np.where(vol_cur > 0, vol_cur, 1.0)
        vwap_cur = np.where(vol_cur > 0, vwap_cur_vol / safe_vol_cur, df['hlc3'].values)
        
        prev_end = j_current - 1
        valid_prev_end = prev_end >= 0
        prev_end_safe = np.where(valid_prev_end, prev_end, 0)
        
        target_prev = np.where(valid_prev_end, cum_vol[prev_end_safe] - V_series, -1)
        valid_prev = target_prev >= 0
        j_prev = np.searchsorted(cum_vol, target_prev, side='right')
        j_prev_m1 = np.where(j_prev > 0, j_prev - 1, 0)
        has_j_prev = j_prev > 0
        
        vol_prev = np.where(valid_prev_end, cum_vol[prev_end_safe] - np.where(has_j_prev, cum_vol[j_prev_m1], 0), 0)
        vwap_prev_vol = np.where(valid_prev_end, cum_vwap_vol[prev_end_safe] - np.where(has_j_prev, cum_vwap_vol[j_prev_m1], 0), 0)
        safe_vol_prev = np.where(vol_prev > 0, vol_prev, 1.0)
        vwap_prev = np.where(vol_prev > 0, vwap_prev_vol / safe_vol_prev, df['hlc3'].values)
        
        full_valid = valid_prev_end & valid_prev & (vol_cur > 0) & (vol_prev > 0) & (df['atr'].values > 0)
        
        displacement = np.where(full_valid, vwap_cur - vwap_prev, 0)
        time_span = np.maximum(i_arr - j_current + 1, 1.0) / window_size
        
        vol_ratio = vol_cur / V_series
        df['diff_pct'] = np.where(full_valid, ((displacement / df['atr'].values) / time_span) * vol_ratio, 0.0)
        
        df['vol_rolling'] = df['value'].rolling(window=window_size, min_periods=1).sum()
        
        if len(df) > window_size:
            # Tính diff_pct cho TOÀN BỘ cây nến (C-VWMA vs HLC3 cách window_size nến)
            
            # Score = TRUNG BÌNH toàn bộ cửa sổ (không phải 1 nến cuối)
            window_diff = df['diff_pct'].iloc[-window_size:]
            diff_pct_current = window_diff.mean()
            
            if pd.isna(diff_pct_current):
                return None
            
            if pair == "GLOBAL_INDEX":
                base_currency = "GI"
                quote_currency = "NONE"
            elif matrix_type != "fx" and matrix_type != "currency":
                base_currency = pair
                quote_currency = "NONE"
            else:
                base_currency = pair[:3]
                quote_currency = pair[3:]
            
            diff_array_len = vol_days * 24 * candles_per_hour
            diff_array = df['diff_pct'].iloc[-diff_array_len:].fillna(0).values
            vol_array = df['vol_rolling'].iloc[-diff_array_len:].fillna(0).values
            
            return (pair, diff_pct_current, base_currency, quote_currency, diff_array, vol_array)
        return None


    # Chạy song song đa luồng để lấy dữ liệu 15 cặp siêu tốc
    with concurrent.futures.ThreadPoolExecutor(max_workers=total_pairs) as executor:
        results = list(executor.map(process_pair, pairs))
        
    scores_hist = {c: [] for c in currencies}
    vol_hist = {c: [] for c in currencies}
    
    for res in results:
        if res:
            pair, diff_pct_current, base_currency, quote_currency, diff_array, vol_array = res
            
            if base_currency in scores:
                scores[base_currency] += diff_pct_current
                if len(scores_hist[base_currency]) == 0:
                    scores_hist[base_currency] = diff_array.copy()
                    vol_hist[base_currency] = vol_array.copy()
                else:
                    length = min(len(scores_hist[base_currency]), len(diff_array))
                    scores_hist[base_currency][-length:] += diff_array[-length:]
                    vol_hist[base_currency][-length:] += vol_array[-length:]
                    
            if quote_currency in scores:
                scores[quote_currency] -= diff_pct_current
                if len(scores_hist[quote_currency]) == 0:
                    scores_hist[quote_currency] = -diff_array.copy()
                    vol_hist[quote_currency] = vol_array.copy()
                else:
                    length = min(len(scores_hist[quote_currency]), len(diff_array))
                    scores_hist[quote_currency][-length:] -= diff_array[-length:]
                    vol_hist[quote_currency][-length:] += vol_array[-length:]
                
            matrix_data.append({
                "pair": pair,
                "change_pct": round(diff_pct_current, 4) if not pd.isna(diff_pct_current) else 0
            })

    # Xếp hạng currencies và tính Vol Percentile & Mom Percentile
    ranked_currencies = []
    for c in currencies:
        vol_arr = vol_hist[c]
        scores_arr = scores_hist[c]
        
        vol_percentile = 0.0
        mom_percentile = 0.0
        if len(vol_arr) > 0 and len(scores_arr) > 0:
            # Tính Vol Percentile — trung bình cửa sổ
            ws_vol = min(window_size, len(vol_arr))
            current_vol = np.mean(vol_arr[-ws_vol:]) if ws_vol > 0 else vol_arr[-1]
            
            # So sánh vol trung bình cửa sổ với rolling mean lịch sử
            if len(vol_arr) >= ws_vol:
                vol_rolling_means = pd.Series(vol_arr).rolling(ws_vol, min_periods=max(1, ws_vol//2)).mean().dropna().values
            else:
                vol_rolling_means = vol_arr
            percentile = np.mean(vol_rolling_means < current_vol) * 100
            vol_percentile = round(percentile, 2)
            
            # Tính Mom Percentile (Nhân điểm sức mạnh với RVOL — trung bình cửa sổ)
            scores_np = np.array(scores_arr)
            vol_np = np.array(vol_arr)
            
            mean_vol = np.mean(vol_np)
            rvol = vol_np / mean_vol if mean_vol > 0 else np.ones_like(vol_np)
            weighted_scores = scores_np * rvol
            
            # Lấy trung bình cửa sổ thay vì 1 nến cuối
            ws = min(window_size, len(weighted_scores))
            current_weighted = np.mean(weighted_scores[-ws:]) if ws > 0 else weighted_scores[-1]
            
            # Tính phân phối theo cửa sổ trượt (rolling mean) thay vì từng nến
            if len(weighted_scores) >= ws:
                rolling_means = pd.Series(weighted_scores).rolling(ws, min_periods=max(1, ws//2)).mean().dropna().values
            else:
                rolling_means = weighted_scores
            
            all_abs = np.abs(rolling_means)
            current_abs = np.abs(current_weighted)
            
            if len(all_abs) > 0:
                pct = np.mean(all_abs <= current_abs) * 100
                mom_percentile = round(pct, 2)
                if current_weighted < 0:
                    mom_percentile = -mom_percentile
            
        ranked_currencies.append({
            "currency": c,
            "score": round(scores[c], 4),
            "vol_percentile": vol_percentile,
            "mom_percentile": mom_percentile
        })
        
    ranked_currencies = sorted(ranked_currencies, key=lambda x: (x["mom_percentile"], x["score"]), reverse=True)
    
    # Tính ma trận tương quan (Correlation Matrix)
    corr_matrix = []
    if len(currencies) > 1:
        # Tìm chiều dài tối thiểu để tránh lỗi chênh lệch độ dài mảng
        min_len = min([len(scores_hist[c]) for c in currencies if len(scores_hist[c]) > 0], default=0)
        if min_len > 0:
            hist_dict = {c: scores_hist[c][-min_len:] for c in currencies if len(scores_hist[c]) >= min_len}
            df_corr = pd.DataFrame(hist_dict).corr()
            
            for c1 in df_corr.index:
                row = {"currency": c1}
                for c2 in df_corr.columns:
                    val = df_corr.loc[c1, c2]
                    row[c2] = round(val, 2) if not pd.isna(val) else 0.0
                corr_matrix.append(row)

    MATRIX_PROGRESS[matrix_type] = 100.0
    result = {
        "n_hours": n_hours,
        "ranking": ranked_currencies,
        "pairs_data": matrix_data,
        "corr_matrix": corr_matrix,
        "currencies": currencies
    }
            
    if len(_MATRIX_CACHE) > 100:
        _MATRIX_CACHE.clear()
        _MATRIX_CACHE_TIME.clear()
        
    _MATRIX_CACHE[cache_key] = result
    _MATRIX_CACHE_TIME[cache_key] = current_time
    return result

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

async def strategy_worker():
    print("Started Strategy Worker")
    import time
    while True:
        try:
            strategies = alert_service.get_strategies()
            active_strategies = [s for s in strategies if s.get("status") == "active"]
            if not active_strategies:
                await asyncio.sleep(10)
                continue
                
            targets = {}
            for strat in active_strategies:
                key = (strat.get('symbol'), strat.get('timeframe'))
                if key not in targets:
                    targets[key] = []
                targets[key].append(strat)
                
            for (symbol, timeframe), strats in targets.items():
                try:
                    if not symbol or not timeframe: continue
                    configs = strats[0].get('configs', {})
                    if not configs:
                        configs = get_configs()
                        
                    allowed_keys = ['pct1', 'pct2', 'gridMode', 'fixedPips', 'rowCount', 'timeoutHours', 'dvpLookbackDays', 'mfTargetPct', 'mfTimeoutMins', 'vwapLength', 'vwapMult', 'rvolLookbackDays', 'peakVolLookbackDays', 'momLength', 'matrixLookbackHours', 'momPct1', 'momPct2', 'momPct3', 'maVolLength', 'momMaLength', 'smaMomLength', 'momFlipFilterPct', 'momFlipVolFilterPct', 'volPct1', 'volPct2', 'volPct3', 'volPct4', 'timeShiftHours', 'browserOffsetHours', 'autoDst', 'asiaStart', 'asiaEnd', 'euroStart', 'euroEnd', 'usStart', 'usEnd', 'brokerTimezone']
                    kwargs = {k: v for k, v in configs.items() if k in allowed_keys}
                    
                    ohlcv_res = get_ohlcv(symbol=symbol, timeframe=timeframe, count=1000, latest_only=True, **kwargs)
                    
                    if not ohlcv_res: continue
                    records = ohlcv_res.get("data", [])
                    indicators = ohlcv_res.get("indicators", {})
                    vp_boxes = indicators.get("vp_boxes", [])
                    
                    if not records: continue
                    
                    for strat in strats:
                        latest_candle = records[-1]
                        current_forming_time = latest_candle.get("time")
                        
                        if strat.get("bar_close_only"):
                            if strat.get("last_forming_time") == current_forming_time:
                                continue
                            if len(records) < 2:
                                continue
                            eval_candle = records[-2]
                            strat["last_forming_time"] = current_forming_time
                            alert_service.update_strategy(strat['id'], strat)
                        else:
                            eval_candle = latest_candle
                            
                        c_close = eval_candle.get("close", 0)
                        c_high = eval_candle.get("high", 0)
                        c_low = eval_candle.get("low", 0)
                        c_hl2 = eval_candle.get("hl2", c_close)

                        steps = strat.get("steps", [])
                        current_step_index = strat.get("current_step_index", 0)
                        
                        if current_step_index >= len(steps):
                            continue
                            
                        created_at = strat.get("created_at", time.time())
                        exp_hours = strat.get("expiration_hours", 24)
                        if (time.time() - created_at) > (exp_hours * 3600):
                            strat["status"] = "expired"
                            alert_service.update_strategy(strat['id'], strat)
                            continue

                        step = steps[current_step_index]
                        step_type = step.get("type")
                        step_val = step.get("value")
                        met = False
                        
                        if step_type in ["mf_touch_dvp", "mf_exit_dvp"]:
                            target_high = c_hl2
                            target_low = c_hl2
                            if step_type == "mf_touch_dvp":
                                for box in vp_boxes:
                                    top = box['price'] + box['height']/2
                                    bottom = box['price'] - box['height']/2
                                    if target_high >= bottom and target_low <= top:
                                        met = True
                                        strat['last_touched_dvp'] = box
                                        break
                            elif step_type == "mf_exit_dvp":
                                in_any = False
                                for box in vp_boxes:
                                    top = box['price'] + box['height']/2
                                    bottom = box['price'] - box['height']/2
                                    if target_high >= bottom and target_low <= top:
                                        in_any = True
                                        break
                                if not in_any:
                                    met = True
                        elif step_type == "price_cross":
                            target_price = float(step_val if step_val else 0)
                            if c_low <= target_price <= c_high:
                                met = True
                        elif step_type == "mom_lt":
                            mom = eval_candle.get("mom_percent_rank", 0)
                            if mom <= float(step_val if step_val else 0): met = True
                        elif step_type == "mom_gt":
                            mom = eval_candle.get("mom_percent_rank", 0)
                            if mom >= float(step_val if step_val else 0): met = True
                        elif step_type == "mom_flip_gt":
                            mf = eval_candle.get("mom_flip", 0)
                            if mf >= float(step_val if step_val else 0): met = True
                        elif step_type == "mom_flip_lt":
                            mf = eval_candle.get("mom_flip", 0)
                            if mf <= float(step_val if step_val else 0): met = True
                        elif step_type == "rvol_gt":
                            rvol = eval_candle.get("rvol", 0)
                            if rvol >= float(step_val if step_val else 0): met = True
                            
                        if met:
                            strat["current_step_index"] += 1
                            if strat["current_step_index"] >= len(steps):
                                strat["status"] = "completed"
                                alert_service.send_email(strat['symbol'], c_close, f"Chiến lược '{strat.get('name', 'Strategy Builder')}' đã hoàn thành tất cả các bước ({len(steps)} bước) tại giá {c_close}!", "HOÀN THÀNH", "strategy")
                            alert_service.update_strategy(strat['id'], strat)
                            
                except Exception as e:
                    print(f"Strategy evaluate error for {symbol} {timeframe}: {e}")
                    
            await asyncio.sleep(5)
        except Exception as e:
            print(f"Strategy worker loop error: {e}")
            await asyncio.sleep(5)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
