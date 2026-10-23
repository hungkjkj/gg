import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import pandas as pd
import time
import numpy as np
from typing import List, Optional
import concurrent.futures
import threading
from runtime_paths import get_data_file, get_data_dir, get_frontend_dist_dir

# Nháº­p cÃ¡c hÃ m tá»« service MT5
import mt5_service
from mt5_service import initialize_mt5, get_historical_data, shutdown_mt5, get_tick, _get_real_symbol

app = FastAPI(title="Quant Trading Dashboard API")
_VP_BOXES_CACHE = {}


def _json_safe(value):
    """Convert NumPy/Pandas values in API payloads to standard JSON types."""
    if isinstance(value, np.ndarray):
        return [_json_safe(item) for item in value.tolist()]
    if isinstance(value, np.generic):
        return _json_safe(value.item())
    if isinstance(value, dict):
        return {str(_json_safe(key)): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, (float, np.floating)) and not np.isfinite(value):
        return None
    return value

@app.middleware("http")
async def add_cache_control_header(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Cáº¥u hÃ¬nh CORS Ä‘á»ƒ Frontend (React) cÃ³ thá»ƒ gá»i API
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
    # Khá»Ÿi táº¡o káº¿t ná»‘i MT5 khi server cháº¡y
    if not initialize_mt5():
        print("WARNING: Could not initialize MT5 on startup.")
    
    # Khá»Ÿi Ä‘á»™ng trÃ¬nh quÃ©t cáº£nh bÃ¡o ngáº§m
    asyncio.create_task(alert_service.alert_worker())
    asyncio.create_task(strategy_worker())

@app.on_event("shutdown")
def shutdown_event():
    # ÄÃ³ng káº¿t ná»‘i khi táº¯t server
    shutdown_mt5()

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import json

@app.get("/api/v1/health")
def health_check():
    return {"status": "ok", "time": time.time()}

CONFIG_FILE = get_data_file("app_configs.json")
TRADING_LOGS_FILE = os.path.join(get_data_dir(), "trading_logs.json")
TRADING_LOGS_LOCK = threading.Lock()


@app.get("/api/v1/ohlcv/latest")
def get_latest_ohlcv(
    symbol: str,
    timeframe: str,
    timeShiftHours: float = 0.0,
    brokerTimezone: str = "Europe/Athens",
):
    """Return the last two raw candles for frequent live price updates."""
    df = get_historical_data(symbol, timeframe, 2, 0, brokerTimezone)
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for {symbol} on {timeframe}")

    broker_naive = pd.to_datetime(df["time"], unit="s")
    try:
        broker_aware = broker_naive.dt.tz_localize(
            brokerTimezone, nonexistent="shift_forward", ambiguous="NaT"
        )
    except Exception:
        broker_aware = broker_naive.dt.tz_localize("UTC")
    utc_aware = broker_aware.dt.tz_convert("UTC")
    df = df.copy()
    df["time"] = (utc_aware - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta("1s")
    df = df.dropna(subset=["time"])

    if timeframe.upper() not in {"D1", "W1", "MN1"}:
        df["time"] = df["time"] + (timeShiftHours * 3600)

    records = []
    for _, row in df.tail(2).iterrows():
        record = {"time": int(row["time"])}
        for field in ("open", "high", "low", "close", "spread"):
            if field not in df.columns:
                continue
            value = row[field]
            record[field] = None if pd.isna(value) else float(value)
        records.append(record)

    return {"symbol": symbol, "timeframe": timeframe, "data": records}

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


class TradingLogModel(BaseModel):
    id: str
    timestamp: str
    content: str
    drawing: Optional[str] = None


@app.get("/api/v1/trading-logs")
def get_trading_logs():
    with TRADING_LOGS_LOCK:
        try:
            with open(TRADING_LOGS_FILE, "r", encoding="utf-8") as log_file:
                logs = json.load(log_file)
            return {"status": "success", "logs": logs if isinstance(logs, list) else []}
        except FileNotFoundError:
            return {"status": "success", "logs": []}
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Không đọc được nhật ký: {error}")


@app.put("/api/v1/trading-logs")
def save_trading_logs(logs: List[TradingLogModel]):
    normalized_logs = [log.dict() for log in logs]
    temp_file = f"{TRADING_LOGS_FILE}.tmp"
    with TRADING_LOGS_LOCK:
        try:
            os.makedirs(os.path.dirname(TRADING_LOGS_FILE), exist_ok=True)
            with open(temp_file, "w", encoding="utf-8") as log_file:
                json.dump(normalized_logs, log_file, ensure_ascii=False, indent=2)
                log_file.flush()
                os.fsync(log_file.fileno())
            os.replace(temp_file, TRADING_LOGS_FILE)
            return {"status": "success", "count": len(normalized_logs)}
        except Exception as error:
            try:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            except OSError:
                pass
            raise HTTPException(status_code=500, detail=f"Không lưu được nhật ký: {error}")


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
    Láº¥y toÃ n bá»™ tin tá»©c kinh táº¿ trong tuáº§n cho tab Catalyst.
    """
    try:
        events = news_service.get_weekly_news()
        return events
    except Exception as e:
        print("Lá»—i láº¥y news catalyst:", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/catalyst/refresh")
def refresh_catalyst():
    """
    XoÃ¡ cache vÃ  cÃ o láº¡i toÃ n bá»™ tin tá»©c tá»« ForexFactory.
    DÃ¹ng khi ngÆ°á»i dÃ¹ng muá»‘n cáº­p nháº­t thá»§ cÃ´ng.
    """
    try:
        # Reset toÃ n bá»™ cache: xÃ³a checked flag, xÃ³a last_fetch
        news_service.NEWS_CACHE["data"] = []
        news_service.NEWS_CACHE["last_fetch"] = 0
        events = news_service.get_weekly_news()
        return {"status": "success", "count": len(events)}
    except Exception as e:
        print("Lá»—i refresh catalyst:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/news")
def get_news(symbol: str):
    """
    Láº¥y tin tá»©c kinh táº¿ tá»« Forex Factory liÃªn quan Ä‘áº¿n cáº·p tiá»n.
    """
    import time
    try:
        events = news_service.get_news_for_symbol(symbol)
        return {"status": "success", "data": events}
    except Exception as e:
        return {"status": "error", "message": str(e), "data": []}

@app.get("/api/v1/symbols")
def get_all_symbols():
    """Láº¥y toÃ n bá»™ danh sÃ¡ch tÃ i sáº£n (symbols) tá»« MT5"""
    try:
        symbols = mt5_service.get_all_symbols()
        return {"status": "success", "data": symbols}
    except Exception as e:
        return {"status": "error", "message": str(e), "data": {}}

@app.get("/api/v1/news/backtest")
def get_backtest_news(symbol: str, timestamp: int):
    """
    Láº¥y tin tá»©c lá»‹ch sá»­ cho cháº¿ Ä‘á»™ Backtest.
    Tráº£ vá» tin tá»©c cá»§a tuáº§n chá»©a timestamp Ä‘Ã£ cho, lá»c theo cáº·p tiá»n.
    """
    import time as time_mod
    try:
        all_events = news_service.get_backtest_news(timestamp)
        
        # Lá»c theo cáº·p tiá»n
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
    """Láº¥y giÃ¡ hiá»‡n táº¡i cá»§a má»™t danh sÃ¡ch symbols (phÃ¢n tÃ¡ch báº±ng dáº¥u pháº©y)"""
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


_SYMBOL_SPREAD_CACHE = {}
_SYMBOL_SPREAD_CACHE_TIME = {}


@app.get("/api/v1/symbol-info/spread")
def get_symbol_spread_comparison(
    symbol: str,
    matrix_type: str = "fx",
    brokerTimezone: str = "Europe/Athens",
    end_time: int = 0,
):
    """Compare live or replay-time spread/mean M5 range with related instruments."""
    symbol = symbol.strip()
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")

    time_bucket = int(end_time) // 300 * 300 if end_time > 0 else 0
    cache_key = (symbol.upper(), matrix_type, brokerTimezone, time_bucket)
    now = time.time()
    if cache_key in _SYMBOL_SPREAD_CACHE and now - _SYMBOL_SPREAD_CACHE_TIME.get(cache_key, 0) < 30:
        return JSONResponse(content=_json_safe(_SYMBOL_SPREAD_CACHE[cache_key]))

    try:
        with open(CONFIG_FILE, "r") as config_file:
            config = json.load(config_file)
    except Exception:
        config = {}

    if matrix_type in ("fx", "currency"):
        group_symbols = [
            "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "EURGBP", "EURAUD", "EURNZD",
            "EURJPY", "GBPAUD", "GBPNZD", "GBPJPY", "AUDNZD", "AUDJPY", "NZDJPY",
        ]
        clean_symbol = "".join(char for char in symbol.upper() if char.isalnum())
        known_currencies = {"EUR", "GBP", "AUD", "NZD", "JPY", "USD", "CAD", "CHF"}
        base, quote = clean_symbol[:3], clean_symbol[3:6]
        if len(clean_symbol) >= 6 and base in known_currencies and quote in known_currencies:
            # Compare FX pairs that share a currency with the selected pair.
            group_symbols = [
                pair for pair in group_symbols
                if pair[:3] in (base, quote) or pair[3:6] in (base, quote)
            ]
    else:
        group_symbols = config.get("matrix_groups", {}).get(matrix_type, [])

    symbols = []
    seen_symbols = set()
    for candidate in [symbol, *group_symbols]:
        normalized = "".join(char for char in candidate.upper() if char.isalnum())
        if normalized and normalized not in seen_symbols:
            symbols.append(candidate)
            seen_symbols.add(normalized)
        if len(symbols) >= 31:
            break
    peer_metrics = []
    current_metric = None
    for peer in symbols:
        try:
            history = get_historical_data(peer, "M5", 288, int(end_time or 0), brokerTimezone, fallback_ea=end_time > 0)
            if history is None or history.empty or not {"high", "low"}.issubset(history.columns):
                continue

            if end_time > 0:
                # MT5 history provides one spread value per candle (points),
                # not a full bid/ask tick stream. Convert the replay candle's
                # value into price units for the same comparison as live mode.
                if "spread" not in history.columns:
                    continue
                spread_values = pd.to_numeric(history["spread"], errors="coerce").dropna()
                if spread_values.empty:
                    continue
                real_symbol = _get_real_symbol(peer)
                symbol_info = mt5_service.mt5.symbol_info(real_symbol)
                point = float(getattr(symbol_info, "point", 0) or 0) if symbol_info else 0
                if point <= 0:
                    continue
                spread = max(0.0, float(spread_values.iloc[-1]) * point)
            else:
                tick = get_tick(peer)
                if not tick or tick.get("bid") is None or tick.get("ask") is None:
                    continue
                spread = max(0.0, float(tick["ask"]) - float(tick["bid"]))

            ranges = (
                pd.to_numeric(history["high"], errors="coerce")
                - pd.to_numeric(history["low"], errors="coerce")
            )
            ranges = ranges[np.isfinite(ranges) & (ranges > 0)]
            if ranges.empty:
                continue
            average_range = float(ranges.mean())
            metric = {
                "symbol": peer,
                "spread": spread,
                "average_range": average_range,
                "spread_to_range_pct": (spread / average_range) * 100.0,
            }
            peer_metrics.append(metric)
            if peer.upper() == symbol.upper():
                current_metric = metric
        except Exception as error:
            print(f"Spread comparison failed for {peer}: {error}")

    if current_metric is None:
        # Broker suffixes can differ between the chart symbol and configured
        # Matrix symbol. Resolve the current instrument by its alphanumeric name.
        clean_symbol = "".join(char for char in symbol.upper() if char.isalnum())
        current_metric = next((
            item for item in peer_metrics
            if "".join(char for char in item["symbol"].upper() if char.isalnum()) == clean_symbol
        ), None)

    result = {"symbol": symbol, "matrix_type": matrix_type, "current": current_metric, "peers": []}
    if current_metric:
        ratios = [item["spread_to_range_pct"] for item in peer_metrics if item["spread"] > 0]
        if ratios:
            current_ratio = current_metric["spread_to_range_pct"]
            ordered = sorted(ratios)
            rank = sum(value <= current_ratio for value in ordered)
            percentile = (rank / len(ordered)) * 100.0
            median = float(np.median(ordered))
            result.update({
                "peer_count": max(0, len(ordered) - 1),
                "rank": rank,
                "peer_total": len(ordered),
                "percentile": round(percentile, 1),
                "group_median_pct": median,
                "relative_to_group_median": (current_ratio / median) if median > 0 else None,
                "assessment": "cao" if percentile >= 75 else "thấp" if percentile <= 25 else "trung bình",
            })
            result["peers"] = sorted(peer_metrics, key=lambda item: item["spread_to_range_pct"], reverse=True)

    _SYMBOL_SPREAD_CACHE[cache_key] = result
    _SYMBOL_SPREAD_CACHE_TIME[cache_key] = now
    if len(_SYMBOL_SPREAD_CACHE) > 100:
        _SYMBOL_SPREAD_CACHE.clear()
        _SYMBOL_SPREAD_CACHE_TIME.clear()
    return JSONResponse(content=_json_safe(result))


@app.get("/api/v1/ohlcv")
def get_ohlcv(symbol: str, timeframe: str, count: int = 10000, 
              end_time: int = 0, latest_only: bool = False,
              pct1: float = 75.0, pct2: float = 85.0, 
              gridMode: str = "auto", fixedPips: float = 10.0,
              rowCount: int = 50, timeoutHours: float = 1.0, dvpLookbackDays: float = 5.0, mfTargetPct: float = 75.0, mfTimeoutCandles: float = 120.0,
              vwapLength: int = 89, vwapMult: float = 2.0,
              rvolLookbackDays: int = 10, peakVolLookbackDays: int = 60,
              matrixLookbackHours: float = 89.0,
              momPct1: float = 85.0, momPct2: float = 75.0, momPct3: float = 50.0,
              maVolLength: int = 2, momMaLength: int = 3, smaMomLength: int = 10, momFlipFilterPct: float = 75.0, momFlipVolFilterPct: float = 50.0,
              volPct1: float = 85.0, volPct2: float = 75.0, volPct3: float = 50.0, volPct4: float = 15.0,
              timeShiftHours: float = 0.0, browserOffsetHours: float = 7.0, autoDst: bool = True,
              asiaStart: str = "07:00", asiaEnd: str = "10:00",
              euroStart: str = "13:00", euroEnd: str = "16:00",
              preUsStart: str = "16:00", preUsEnd: str = "19:00",
              usStart: str = "18:30", usEnd: str = "23:00",
              brokerTimezone: str = "Europe/Athens"):
    """
    Láº¥y dá»¯ liá»‡u OHLCV tá»« MT5 vÃ  tÃ­nh toÃ¡n Chá»‰ bÃ¡o NÃ¢ng cao (D-VP & Momentum).
    """    
    df = get_historical_data(symbol, timeframe, count, end_time, brokerTimezone)
    
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for {symbol} on {timeframe}")
        
    # Chuáº©n hoÃ¡ giá» MT5 (giáº£ Ä‘á»‹nh EET/EEST) vá» UTC 0 chuáº©n
    broker_naive = pd.to_datetime(df['time'], unit='s')
    try:
        broker_aware = broker_naive.dt.tz_localize(brokerTimezone, nonexistent='shift_forward', ambiguous='NaT')
    except Exception as e:
        # Fallback to UTC if timezone is invalid
        broker_aware = broker_naive.dt.tz_localize('UTC')
    utc_aware = broker_aware.dt.tz_convert('UTC')
    df['broker_time'] = df['time'] # LÆ°u láº¡i Ä‘á»ƒ fetch M1 náº¿u cáº§n
    df['time'] = (utc_aware - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta('1s')
    df = df.dropna(subset=['time']).copy()
    df['time'] = df['time'].astype(int)
        
    tf_mapping = {
        'M1': 60,
        'M2': 120,
        'M3': 180,
        'M4': 240,
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
    ma_vol_window = max(1, int((maVolLength * 60) / tf_seconds))

    
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
    
    lookback_candles = max(1, int((matrixLookbackHours * 3600) / tf_seconds))
    
    # Momentum uses the established volume-weighted candle movement over the V-block.
    target_vol_candles = max(1, int(mfTimeoutCandles))
    rolling_vol_N = df['value'].rolling(window=target_vol_candles, min_periods=1).sum()
    V_series = np.maximum(rolling_vol_N.rolling(window=lookback_candles, min_periods=1).quantile(mfTargetPct / 100.0).fillna(1.0).values, 1.0)
    
    cum_vol = df['value'].cumsum().values
    
    # Per-candle percentage price change weighted by tick volume.
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
    
    N_candles = np.maximum(i_arr - j_current + 1, 1.0)
    df['mom_raw_raw'] = np.where(vol_cur > 0, net_mom_cur / V_series, 0.0)
    df['abs_mom_raw'] = df['mom_raw_raw'].abs()
    df['vblock_avg_vol'] = vol_cur / N_candles
    
    # TÃ­nh median Ä‘á»™ng lÆ°á»£ng trong chu ká»³ N giá»
    rolling_median_mom = df['abs_mom_raw'].rolling(window=lookback_candles, min_periods=1).median().replace(0, np.nan).fillna(1e-9)
    
    # --- Momentum Burst (legacy mom_flip output key) ---
    # SMA Moment: trung bÃ¬nh cá»™ng Ä‘á»™ lá»›n momentum cá»§a N náº¿n gáº§n nháº¥t (khÃ´ng tÃ­nh náº¿n hiá»‡n táº¡i)
    sma_mom_window = max(1, smaMomLength)
    sma_mom = df['abs_mom_raw'].shift(1).rolling(window=sma_mom_window, min_periods=1).mean().replace(0, np.nan).fillna(1e-9)
    # há»‡ sá»‘ flip = Ä‘á»™ng lÆ°á»£ng hiá»‡n táº¡i / SMA moment (so sÃ¡nh vá»›i trung bÃ¬nh N náº¿n thay vÃ¬ chá»‰ 1 náº¿n trÆ°á»›c)
    flip_ratio = df['abs_mom_raw'] / sma_mom
    # Theo chuáº©n cá»§a báº¡n: Flip Metric chá»‰ Ä‘Æ¡n giáº£n lÃ  gia tá»‘c bá»©t phÃ¡ so vá»›i sá»± á»³ áº¡ch gáº§n nháº¥t
    mom_flip_metric = flip_ratio
    
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
    
    # Normalize the composite, then rank it once more over the same lookback window.
    df['abs_mom'] = df['abs_mom_raw'] / rolling_median_mom
    df['mom_percent_rank'] = df['abs_mom'].rolling(window=lookback_candles, min_periods=1).rank(pct=True, method='max') * 100.0 * np.sign(df['mom_raw_raw'])
    df['mom_raw'] = df['mom_percent_rank']

    # These chart levels now share the same percentile scale as mom_raw.
    df['mom_lvl1'] = float(momPct1)
    df['mom_lvl2'] = float(momPct2)
    df['mom_lvl3'] = float(momPct3)

    
    # --- TÃ­nh toÃ¡n Normalized Volume ---
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
    
    # --- TÃ­nh toÃ¡n RVol (Relative Volume theo cÃ¹ng khung giá» & cÃ¹ng thá»© trong tuáº§n) ---
    df['broker_dt'] = pd.to_datetime(df['broker_time'], unit='s')
    df['time_of_day'] = df['broker_dt'].dt.time
    df['day_of_week'] = df['broker_dt'].dt.dayofweek
    df['rvol_mean'] = df.groupby(['day_of_week', 'time_of_day'])['value'].rolling(window=rvolLookbackDays, min_periods=1).mean().reset_index(level=[0,1], drop=True).sort_index()
    df['rvol'] = np.where(df['rvol_mean'] > 0, df['value'] / df['rvol_mean'], 0)
    
    # --- TÃ­nh toÃ¡n Mean MA Vol (Trung bÃ¬nh cá»§a ma_vol cÃ¹ng giá» & cÃ¹ng thá»© trong chu ká»³ matrixLookbackHours) ---
    mean_vol_lookback_days = max(1, int(matrixLookbackHours / 24.0))
    df['mean_ma_vol'] = df.groupby(['day_of_week', 'time_of_day'])['ma_vol'].rolling(window=mean_vol_lookback_days, min_periods=1).mean().reset_index(level=[0,1], drop=True).sort_index()
    df['mean_vol_lvl1'] = df['mean_ma_vol'].rolling(window=lookback_candles, min_periods=1).quantile(volPct1 / 100.0)
    df['mean_vol_lvl2'] = df['mean_ma_vol'].rolling(window=lookback_candles, min_periods=1).quantile(volPct2 / 100.0)
    df['mean_vol_lvl3'] = df['mean_ma_vol'].rolling(window=lookback_candles, min_periods=1).quantile(volPct3 / 100.0)
    df['mean_vol_lvl4'] = df['mean_ma_vol'].rolling(window=lookback_candles, min_periods=1).quantile(volPct4 / 100.0)
    
    vp_boxes = []
    cache_key = f"{symbol}_{timeframe}_{dvpLookbackDays}_{timeoutHours}_{rowCount}_{pct1}_{gridMode}_{fixedPips}_{timeShiftHours}_{brokerTimezone}"
    current_time_val = time.time()
    
    use_cache = False
    has_m1 = False
    if end_time == 0 and latest_only and cache_key in _VP_BOXES_CACHE:
        cache_entry = _VP_BOXES_CACHE[cache_key]
        if current_time_val - cache_entry['time'] < 60:
            use_cache = True
            vp_boxes = cache_entry['boxes']
            if len(df) > 0:
                current_last_time = df['time'].iloc[-1]
                for box in vp_boxes:
                    if box.get('is_active'):
                        box['end'] = current_last_time
    # Live latest-only refreshes can rebuild the profile when their cache
    # expires. Backtest polling intentionally skips this expensive rebuild;
    # the frontend retains the last profile calculated at the replay point.
    if not use_cache and (not latest_only or end_time == 0):
        # --- Fetch M1 data BEFORE shifting df['time'] ---
        try:
            end_ts = int(df['broker_time'].max()) + 3600
            if dvpLookbackDays > 0:
                # Fetch the configured D-VP window independently of the chart
                # candle count. On M1, the 10k chart bars cover only about a
                # week; clamping to df.min() silently truncated longer D-VP
                # lookbacks that are still available on higher timeframes.
                start_ts = int(df['broker_time'].max()) - int(dvpLookbackDays * 24 * 3600)
            else:
                start_ts = int(df['broker_time'].min())
            real_sym = _get_real_symbol(symbol)
            # Serialize this direct MT5 request with the rest of the data service.
            # Referencing `mt5` here used to raise NameError; the broad exception
            # below silently forced D-VP back to chart-timeframe candles.
            with mt5_service.mt5_api_lock:
                m1_rates = mt5_service.mt5.copy_rates_range(
                    real_sym, mt5_service.mt5.TIMEFRAME_M1, start_ts, end_ts
                )
            has_m1 = m1_rates is not None and len(m1_rates) > 0
            if has_m1:
                df_m1 = pd.DataFrame(m1_rates)
                # Chuáº©n hoÃ¡ M1 time vá» UTC
                m1_broker_naive = pd.to_datetime(df_m1['time'], unit='s')
                try:
                    m1_broker_aware = m1_broker_naive.dt.tz_localize(brokerTimezone, nonexistent='shift_forward', ambiguous='NaT')
                except Exception:
                    m1_broker_aware = m1_broker_naive.dt.tz_localize('UTC')
                m1_utc_aware = m1_broker_aware.dt.tz_convert('UTC')
                df_m1['time'] = (m1_utc_aware - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta('1s')
                df_m1['time'] = df_m1['time'].astype(int)
        except Exception as error:
            print(f"M1 D-VP source unavailable for {symbol} {timeframe}: {error}")
            has_m1 = False

    # Manual Time Shift requested by user
    is_macro_tf = timeframe.upper() in ['D1', 'W1', 'MN1']
    if not is_macro_tf:
        df['time'] = df['time'] + (timeShiftHours * 3600)
    
    # --- TÃ­nh toÃ¡n Background Sessions (Ã, Ã‚u, Má»¹) ---
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
            # Calculate utcoffset by subtracting naive UTC time from naive local time using DatetimeIndex for speed
            tz_naive = pd.Series(pd.DatetimeIndex(tz_series).tz_localize(None), index=tz_series.index)
            utc_naive = pd.Series(pd.DatetimeIndex(true_utc_series).tz_localize(None), index=true_utc_series.index)
            utcoffset = tz_naive - utc_naive
            dst_shift_mins = (utcoffset - summer_offsets[tz_name]).dt.total_seconds() / 60
        else:
            dst_shift_mins = pd.Series(0, index=df.index)
            
        target_start = (start_min - dst_shift_mins) % 1440
        target_end = (end_min - dst_shift_mins) % 1440
        
        cond_straight = (candle_min >= target_start) & (candle_min < target_end)
        cond_cross = (candle_min >= target_start) | (candle_min < target_end)
        crosses_midnight = target_start > target_end
        result = np.where(crosses_midnight, cond_cross, cond_straight)
        result = np.where(start_min == end_min, False, result)

        session_dates = user_local_series.dt.normalize()
        early_crossing = crosses_midnight & (candle_min < target_end)
        session_dates = session_dates - pd.to_timedelta(early_crossing.astype(int), unit='D')
        session_keys = session_dates.dt.strftime('%Y-%m-%d').to_numpy()
        return result, session_keys

    in_asia, asia_session_keys = get_session_mask(asiaStart, asiaEnd, 'Asia/Tokyo')
    in_euro, euro_session_keys = get_session_mask(euroStart, euroEnd, 'Europe/London')
    in_pre_us, pre_us_session_keys = get_session_mask(preUsStart, preUsEnd, 'America/New_York')
    in_us, us_session_keys = get_session_mask(usStart, usEnd, 'America/New_York')
    
    df['session_color'] = None
    df['session_name'] = None
    df.loc[in_asia, 'session_color'] = 'rgba(139, 69, 19, 0.18)' # Brown/Orange
    df.loc[in_asia, 'session_name'] = 'Á'
    df.loc[in_euro, 'session_color'] = 'rgba(139, 0, 139, 0.18)' # Dark Purple
    df.loc[in_euro, 'session_name'] = 'Âu'
    df.loc[in_pre_us, 'session_color'] = 'rgba(255, 193, 7, 0.20)' # Pre-US Amber
    df.loc[in_pre_us, 'session_name'] = 'Pre-US'
    df.loc[in_us, 'session_color'] = 'rgba(0, 0, 139, 0.18)' # Dark Blue
    df.loc[in_us, 'session_name'] = 'Mỹ'

    # Recalculate each session VWAP on every candle. If any candle from a
    # session intersects the trailing window, include that whole session
    # (up to the current candle for an in-progress session).
    # Global VWAP and SD calculations remain unchanged.
    session_windows = {
        'vwap_asia': (in_asia, asia_session_keys),
        'vwap_europe': (in_euro, euro_session_keys),
        'vwap_pre_us': (in_pre_us, pre_us_session_keys),
        'vwap_us': (in_us, us_session_keys),
    }
    session_window_seconds = max(1, int(vwapLength)) * 3600
    session_times = df['time'].to_numpy(dtype=np.int64)
    session_volumes = df['value'].fillna(0).to_numpy(dtype=float)
    session_price_volumes = df['vwap_vol'].fillna(0).to_numpy(dtype=float)
    session_squared_price_volumes = (df['hlc3'] * df['hlc3'] * df['value']).fillna(0).to_numpy(dtype=float)
    session_band_fields = {
        'vwap_asia': ('upper_band_asia', 'lower_band_asia'),
        'vwap_europe': ('upper_band_europe', 'lower_band_europe'),
        'vwap_pre_us': ('upper_band_pre_us', 'lower_band_pre_us'),
        'vwap_us': ('upper_band_us', 'lower_band_us'),
    }

    for column, (session_mask, session_keys) in session_windows.items():
        result = np.full(len(df), np.nan, dtype=float)
        upper_result = np.full(len(df), np.nan, dtype=float)
        lower_result = np.full(len(df), np.nan, dtype=float)
        upper_field, lower_field = session_band_fields[column]
        selected = np.flatnonzero(session_mask)
        if len(selected):
            grouped_keys = pd.Series(session_keys[selected], index=selected)
            session_groups = []
            for _, group_indices in grouped_keys.groupby(grouped_keys, sort=True).groups.items():
                positions = np.asarray(group_indices, dtype=int)
                session_groups.append({
                    'positions': positions,
                    'start_time': int(session_times[positions[0]]),
                    'end_time': int(session_times[positions[-1]]),
                    'volume_prefix': np.concatenate(([0.0], np.cumsum(session_volumes[positions]))),
                    'price_volume_prefix': np.concatenate(([0.0], np.cumsum(session_price_volumes[positions]))),
                    'squared_price_volume_prefix': np.concatenate(([0.0], np.cumsum(session_squared_price_volumes[positions]))),
                })
            session_groups.sort(key=lambda group: group['start_time'])
            group_cursor = 0

            for index, current_time in enumerate(session_times):
                cutoff_time = int(current_time) - session_window_seconds
                while group_cursor < len(session_groups) and session_groups[group_cursor]['end_time'] < cutoff_time:
                    group_cursor += 1
                volume_sum = 0.0
                price_volume_sum = 0.0
                squared_price_volume_sum = 0.0
                for group_index in range(group_cursor, len(session_groups)):
                    group = session_groups[group_index]
                    if group['start_time'] > current_time:
                        break
                    candle_count = int(np.searchsorted(group['positions'], index, side='right'))
                    if candle_count == 0:
                        continue
                    volume_sum += group['volume_prefix'][candle_count]
                    price_volume_sum += group['price_volume_prefix'][candle_count]
                    squared_price_volume_sum += group['squared_price_volume_prefix'][candle_count]
                if volume_sum > 0:
                    session_vwap = price_volume_sum / volume_sum
                    result[index] = session_vwap
                    # Keep the session's reference bands available outside its
                    # active hours so the frontend can preview the next session.
                    # The chart still masks these lines to the matching session.
                    variance = max(squared_price_volume_sum / volume_sum - session_vwap * session_vwap, 0.0)
                    session_sd = np.sqrt(variance) * vwapMult
                    upper_result[index] = session_vwap + session_sd
                    lower_result[index] = session_vwap - session_sd
        df[column] = result
        df[upper_field] = upper_result
        df[lower_field] = lower_result
    
    # --- Thá»‘ng kÃª Äá»‰nh/ÄÃ¡y Vol theo Phase ---
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
    
    if not use_cache:
        # --- 3. Dynamic Volume Profile (D-VP State Machine) ---
        # Use one common M1-derived price grid for all chart timeframes. If
        # Auto grid is based on the current chart bars, the same M1 profile is
        # split into different price bins on M1 and M5, creating missing zones.
        dvp_grid_reference = df_m1 if has_m1 and not df_m1.empty else df
        if gridMode == 'fixed':
            avg_price = dvp_grid_reference['close'].mean() if len(dvp_grid_reference) > 0 else 0
            if avg_price > 0:
                import math
                # Dynamic pip size based on EURUSD ratio
                ratio_pip = avg_price * (0.0001 / 1.10)
                pip_size = 10 ** math.floor(math.log10(ratio_pip))
            else:
                pip_size = 0.0001
                
            bin_size = fixedPips * pip_size
            
            # NgÄƒn cháº·n viá»‡c bin_size quÃ¡ nhá» (gÃ¢y lag náº¿u sá»‘ lÆ°á»£ng há»™p > 1000)
            recent_min = dvp_grid_reference['low'].min()
            recent_max = dvp_grid_reference['high'].max()
            if recent_max - recent_min > 0 and bin_size > 0:
                if (recent_max - recent_min) / bin_size > 1000:
                    bin_size = (recent_max - recent_min) / 1000
        else:
            # 120 M5 bars = 600 M1 candles, keeping Auto-grid resolution
            # identical when switching between M1 and M5.
            lookback_bars = min(600 if has_m1 else 120, len(dvp_grid_reference))
            recent_df = dvp_grid_reference.tail(max(1, lookback_bars))
            recent_min = recent_df['low'].min()
            recent_max = recent_df['high'].max()
            bin_size = (recent_max - recent_min) / max(1, rowCount)
            
        # Báº¢O Vá»† CHá»NG TRÃ€N VÃ’NG Láº¶P D-VP DO QUÃ NHIá»€U BINS
        global_min = df['low'].min()
        global_max = df['high'].max()
        if global_max - global_min > 0 and bin_size > 0:
            pass # Bá» giá»›i háº¡n sá»‘ lÆ°á»£ng há»™p VP vÃ¬ giao diá»‡n Ä‘Ã£ Ä‘Æ°á»£c vÃ¡ lá»—i hiá»‡u nÄƒng Ä‘á»“ hoáº¡

        if bin_size <= 0:
            bin_size = 0.0001
        # DÃ¹ng láº¡i tf_seconds Ä‘Ã£ tÃ­nh á»Ÿ trÃªn (dÃ²ng 250) Ä‘á»ƒ trÃ¡nh ghi Ä‘Ã¨ vÃ  thiáº¿u M30
        timeout_floor_sec = 180 if has_m1 else tf_seconds * 3
        timeout_sec = max(timeoutHours * 3600, timeout_floor_sec)
        
        # --- Calculate D-VP Cutoff Time ---
        if has_m1 and len(df_m1) > 0:
            # Anchor the profile window to the same latest M1 bar on every chart TF.
            profile_end_time = int(df_m1['time'].max())
            if not is_macro_tf:
                profile_end_time += int(timeShiftHours * 3600)
        else:
            profile_end_time = int(df['time'].iloc[-1]) if len(df) > 0 else 0
        if dvpLookbackDays > 0 and profile_end_time > 0:
            last_time = profile_end_time
            dvp_cutoff_time = last_time - (dvpLookbackDays * 24 * 3600)
        else:
            dvp_cutoff_time = 0
            
        # --- Fetch M1 data for Precise D-VP ---
        if has_m1:
            # Chá»‰ shift M1 time trÃªn TF thÆ°á»ng, macro TF (D1/W1/MN1) khÃ´ng shift
            if not is_macro_tf:
                df_m1['time'] = df_m1['time'] + (timeShiftHours * 3600)
            df_m1_filtered = df_m1[df_m1['time'] >= dvp_cutoff_time]
            times = df_m1_filtered['time'].values
            highs = df_m1_filtered['high'].values
            lows = df_m1_filtered['low'].values
            vols = df_m1_filtered['tick_volume'].values
            timeout_candles = max(int(timeout_sec / 60), 3)
        else:
            df_filtered = df[df['time'] >= dvp_cutoff_time]
            times = df_filtered['time'].values
            highs = df_filtered['high'].values
            lows = df_filtered['low'].values
            try:
                vols = df_filtered['value'].values
            except:
                vols = df_filtered['tick_volume'].values
            timeout_candles = max(int(timeout_sec / tf_seconds), 3)
        
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
                    active_bins[bin_idx] = {'vol': vol_per_bin, 'start': t, 'end': t, 'last_touch': t, 'last_idx': i}
                else:
                    b = active_bins[bin_idx]
                    if (i - b['last_idx']) > timeout_candles:
                        # Close old box, extend end to current time t
                        completed_boxes.append({
                            'bin_idx': bin_idx,
                            'price': bin_idx * bin_size + bin_size/2,
                            'vol': b['vol'],
                            'start': b['start'],
                            'end': t
                        })
                        # Start new box
                        active_bins[bin_idx] = {'vol': vol_per_bin, 'start': t, 'end': t, 'last_touch': t, 'last_idx': i}
                    else:
                        b['vol'] += vol_per_bin
                        b['end'] = t
                        b['last_touch'] = t
                        b['last_idx'] = i
                        
        # Flush remaining active bins, extending them to the right edge of the chart
        last_time = max(times[-1] if len(times) > 0 else 0, df['time'].iloc[-1] if not df.empty else 0)
        for bin_idx, b in active_bins.items():
            completed_boxes.append({
                'bin_idx': bin_idx,
                'price': bin_idx * bin_size + bin_size/2,
                'vol': b['vol'],
                'start': b['start'],
                'end': last_time, 'is_active': True # Active boxes extend to the right edge
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
                    'is_active': bool(b.get('is_active', False)),
                    'level': level,
                    'color': color,
                    'height': float(bin_size)
                })
                
    
        _VP_BOXES_CACHE[cache_key] = {
            'time': current_time_val,
            'boxes': vp_boxes
        }
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
        # Nếu real-time (end_time == 0) chỉ cần 2 nến. 
        # Nếu backtest (có end_time) thì lấy 100 nến để đề phòng trường hợp nhảy tốc độ cao (100x).
        df = df.tail(2 if end_time == 0 else 100)
        
    cols_to_keep = ['time', 'open', 'high', 'low', 'close', 'value', 'vwap', 'vwap_asia', 'vwap_europe', 'vwap_pre_us', 'vwap_us', 'stdev', 'upper_band', 'lower_band', 'upper_band_asia', 'lower_band_asia', 'upper_band_europe', 'lower_band_europe', 'upper_band_pre_us', 'lower_band_pre_us', 'upper_band_us', 'lower_band_us', 'hl2', 'mom_raw', 'mom_percent_rank', 'mom_lvl1', 'mom_lvl2', 'mom_lvl3', 'norm_vol', 'rvol', 'ma_vol', 'mean_ma_vol', 'mean_vol_lvl1', 'mean_vol_lvl2', 'mean_vol_lvl3', 'mean_vol_lvl4', 'mom_ma', 'mom_flip', 'vol_lvl1', 'vol_lvl2', 'vol_lvl3', 'vol_lvl4', 'session_color', 'session_name', 'spread']
    existing_cols = [c for c in cols_to_keep if c in df.columns]
    df = df[existing_cols]
        
    # Chuyá»ƒn Dataframe sang dictionary (Thay tháº¿ NaN, Inf báº±ng None Ä‘á»ƒ JSON tÆ°Æ¡ng thÃ­ch)
    for col in df.columns:
        if pd.api.types.is_numeric_dtype(df[col]):
            df[col] = df[col].replace([np.inf, -np.inf], np.nan)
    df = df.replace({np.nan: None})
    records = df.to_dict(orient="records")
    
    # Keep the latest TKH state for alert checking, including an explicit None
    # when the candle does not qualify. Leaving the previous value in place
    # would let a stale >=75% reading trigger after the current signal vanished.
    if end_time == 0 and len(records) > 0 and 'mom_flip' in records[-1]:
        import alert_service
        def finite_alert_value(value):
            try:
                number = float(value)
                return round(number, 2) if np.isfinite(number) else None
            except (TypeError, ValueError):
                return None

        previous_record = records[-2] if len(records) > 1 else records[-1]
        current_flip = finite_alert_value(records[-1].get('mom_flip'))
        previous_flip = finite_alert_value(previous_record.get('mom_flip'))
        current_direction = np.sign(finite_alert_value(records[-1].get('mom_raw')) or 0.0)
        previous_direction = np.sign(finite_alert_value(previous_record.get('mom_raw')) or 0.0)
        alert_service.LATEST_MOM_FLIP_DATA[f"{symbol}_{timeframe}"] = {
            # TKH chart values carry the momentum direction. Keep alert values
            # signed too, so a +75% alert cannot be triggered by a -75% burst.
            'value': current_flip * current_direction if current_flip is not None else None,
            'time': records[-1]['time'],
            'prev_value': previous_flip * previous_direction if previous_flip is not None else None,
            'updated_at': time.time(),
        }
        

    return JSONResponse(content=_json_safe({
        "symbol": symbol, 
        "timeframe": timeframe, 
        "data": records,
        "indicators": {
            "vp_boxes": vp_boxes,
            "vol_stats": vol_stats
        }
    }))

MATRIX_PROGRESS = {"currency": 0.0, "crypto": 0.0, "metals": 0.0}
_MATRIX_CACHE = {}
_MATRIX_CACHE_TIME = {}
_SESSION_MATRIX_CACHE = {}
_SESSION_MATRIX_CACHE_TIME = {}

@app.get("/api/v1/matrix/progress")
def get_matrix_progress(matrix_type: str = "currency"):
    return {"progress": MATRIX_PROGRESS.get(matrix_type, 0.0)}


@app.get("/api/v1/matrix/session-stats")
def get_session_currency_matrix(
    short_hours: int = 24,
    long_hours: int = 89,
    vol_days: int = 30,
    matrix_type: str = "fx",
    end_time: int = 0,
    brokerTimezone: str = "Europe/Athens",
    browserOffsetHours: Optional[float] = None,
    autoDst: Optional[bool] = None,
    asiaStart: Optional[str] = None,
    asiaEnd: Optional[str] = None,
    euroStart: Optional[str] = None,
    euroEnd: Optional[str] = None,
    preUsStart: Optional[str] = None,
    preUsEnd: Optional[str] = None,
    usStart: Optional[str] = None,
    usEnd: Optional[str] = None,
):
    """Calculate session-based trend, flow and tick-volume statistics for Matrix."""
    try:
        with open(CONFIG_FILE, "r") as config_file:
            config = json.load(config_file)
    except Exception:
        config = {}

    # Avoid unbounded history requests while retaining the configured volume baseline.
    short_hours = max(1, min(int(short_hours), 24 * 30))
    long_hours = max(short_hours, min(int(long_hours), 24 * 30))
    vol_days = max(1, min(int(vol_days), 365))
    offset_hours = float(browserOffsetHours if browserOffsetHours is not None else config.get("browserOffsetHours", 7.0))
    use_dst = bool(autoDst if autoDst is not None else config.get("autoDst", True))
    session_ranges = [
        ("asia", "Á", asiaStart or config.get("asiaStart", "07:00"), asiaEnd or config.get("asiaEnd", "11:00"), "Asia/Tokyo", pd.Timedelta(hours=9)),
        ("europe", "Âu", euroStart or config.get("euroStart", "07:00"), euroEnd or config.get("euroEnd", "09:00"), "Europe/London", pd.Timedelta(hours=1)),
        ("pre_us", "Pre-US", preUsStart or config.get("preUsStart", "16:00"), preUsEnd or config.get("preUsEnd", "19:00"), "America/New_York", pd.Timedelta(hours=-4)),
        ("us", "Mỹ", usStart or config.get("usStart", "07:30"), usEnd or config.get("usEnd", "11:00"), "America/New_York", pd.Timedelta(hours=-4)),
    ]

    cache_key = (
        short_hours, long_hours, vol_days, matrix_type, end_time, brokerTimezone,
        offset_hours, use_dst, tuple((key, start, end) for key, _, start, end, _, _ in session_ranges),
    )
    now = time.time()
    if cache_key in _SESSION_MATRIX_CACHE and now - _SESSION_MATRIX_CACHE_TIME.get(cache_key, 0) < 15:
        return JSONResponse(content=_json_safe(_SESSION_MATRIX_CACHE[cache_key]))

    if matrix_type in ["fx", "currency"]:
        currencies = ["EUR", "GBP", "AUD", "NZD", "JPY", "USD", "GI"]
        pairs = [
            "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "EURGBP", "EURAUD", "EURNZD", "EURJPY",
            "GBPAUD", "GBPNZD", "GBPJPY", "AUDNZD", "AUDJPY", "NZDJPY", "GLOBAL_INDEX",
        ]
    else:
        group_symbols = config.get("matrix_groups", {}).get(matrix_type, [])
        if not group_symbols:
            return JSONResponse(content={"progress": 100.0, "ranking": [], "corr_matrix": [], "currencies": [], "sessions": []})
        gi_symbol = f"{matrix_type.upper()}_GI"
        currencies = group_symbols + [gi_symbol]
        pairs = group_symbols + [gi_symbol]

    hours_per_day = 24 * 12  # M5 candles; matches the existing Matrix window and Volume days setting.
    # The legacy Volume days control uses 1.5× calendar-day bars to cover market closures.
    history_bars = max(long_hours * 12, int(vol_days * hours_per_day * 1.5)) + 24
    period_configs = (("long", long_hours), ("short", short_hours))
    currency_samples = {
        currency: {session_key: {period: [] for period, _ in period_configs} for session_key, *_ in session_ranges}
        for currency in currencies
    }
    currency_history_samples = {
        currency: {session_key: {period: {} for period, _ in period_configs} for session_key, *_ in session_ranges}
        for currency in currencies
    }
    pair_spread_sessions = {}
    return_series = []
    MATRIX_PROGRESS[matrix_type] = 0.0

    def parse_minutes(time_text):
        try:
            hours, minutes = map(int, time_text.split(":"))
            return (hours % 24) * 60 + (minutes % 60)
        except (AttributeError, TypeError, ValueError):
            return 0

    def volume_weighted_price(prices, volumes):
        total_volume = float(np.sum(volumes))
        if total_volume > 0:
            return float(np.sum(prices * volumes) / total_volume)
        return float(np.mean(prices)) if len(prices) else 0.0

    def measure_session(df, positions, price_moves):
        prices = df["hlc3"].to_numpy(dtype=float)[positions]
        volumes = df["value"].fillna(0).to_numpy(dtype=float)[positions]
        move_values = price_moves[positions]
        split = max(1, len(positions) // 2)
        first_price = volume_weighted_price(prices[:split], volumes[:split])
        second_price = volume_weighted_price(prices[split:], volumes[split:]) if split < len(positions) else first_price
        trend = ((second_price - first_price) / first_price * 100.0) if first_price > 0 else 0.0
        total_volume = float(np.sum(volumes))
        # Keep Matrix's flow scale (weighted average candle return × candle count),
        # but calculate it from every candle in this session rather than a V-target block.
        flow = (float(np.sum(move_values * volumes)) / total_volume * len(positions)) if total_volume > 0 else 0.0
        return trend, flow, total_volume, len(positions)

    def get_session_groups(df, local_times, session_config):
        _, _, start_text, end_text, timezone_name, summer_offset = session_config
        start_minute = parse_minutes(start_text)
        end_minute = parse_minutes(end_text)
        candle_minute = local_times.dt.hour.to_numpy() * 60 + local_times.dt.minute.to_numpy()
        if use_dst:
            zone_times = df["utc_time"].dt.tz_convert(timezone_name)
            zone_naive = pd.Series(pd.DatetimeIndex(zone_times).tz_localize(None), index=df.index)
            utc_naive = pd.Series(pd.DatetimeIndex(df["utc_time"]).tz_localize(None), index=df.index)
            dst_shift = ((zone_naive - utc_naive - summer_offset).dt.total_seconds() / 60).to_numpy()
        else:
            dst_shift = np.zeros(len(df))
        target_start = (start_minute - dst_shift) % 1440
        target_end = (end_minute - dst_shift) % 1440
        if start_minute == end_minute:
            mask = np.zeros(len(df), dtype=bool)
        else:
            straight = (candle_minute >= target_start) & (candle_minute < target_end)
            crosses_midnight = target_start > target_end
            crossed = (candle_minute >= target_start) | (candle_minute < target_end)
            mask = np.where(crosses_midnight, crossed, straight)

        session_dates = local_times.dt.normalize()
        early_crossing = (target_start > target_end) & (candle_minute < target_end)
        session_dates = session_dates - pd.to_timedelta(early_crossing.astype(int), unit="D")
        selected = np.flatnonzero(mask)
        if not len(selected):
            return []
        date_series = pd.Series(session_dates.iloc[selected].astype(str).to_numpy(), index=selected)
        return [np.asarray(indices, dtype=int) for _, indices in date_series.groupby(date_series, sort=True).groups.items()]

    for pair_index, pair in enumerate(pairs):
        try:
            df = get_historical_data(pair, "M5", history_bars, end_time, brokerTimezone, fallback_ea=False)
            if df is None or df.empty or not {"time", "high", "low", "close", "value"}.issubset(df.columns):
                MATRIX_PROGRESS[matrix_type] = round((pair_index + 1) / len(pairs) * 100, 2)
                continue
            df = df.copy().sort_values("time").reset_index(drop=True)
            broker_naive = pd.to_datetime(df["time"], unit="s")
            try:
                broker_aware = broker_naive.dt.tz_localize(brokerTimezone, nonexistent="shift_forward", ambiguous="NaT")
            except Exception:
                broker_aware = broker_naive.dt.tz_localize("UTC")
            df["utc_time"] = broker_aware.dt.tz_convert("UTC")
            df = df.dropna(subset=["utc_time"]).reset_index(drop=True)
            if df.empty:
                MATRIX_PROGRESS[matrix_type] = round((pair_index + 1) / len(pairs) * 100, 2)
                continue

            df["value"] = pd.to_numeric(df["value"], errors="coerce").fillna(0).clip(lower=0)
            df["hlc3"] = (df["high"] + df["low"] + df["close"]) / 3.0
            hlc3_previous = df["hlc3"].shift(1).fillna(df["hlc3"])
            price_moves = np.where(hlc3_previous.to_numpy() > 0, (df["hlc3"].to_numpy() - hlc3_previous.to_numpy()) / hlc3_previous.to_numpy() * 100.0, 0.0)
            local_times = df["utc_time"] + pd.to_timedelta(offset_hours, unit="h")
            df_times = df["time"].to_numpy(dtype=np.int64)
            volume_values = df["value"].to_numpy(dtype=float)
            latest_time = int(df_times[-1])
            history_start_time = latest_time - vol_days * 86400

            groups_by_session = {}
            for session_config in session_ranges:
                session_key = session_config[0]
                session_groups = []
                for positions in get_session_groups(df, local_times, session_config):
                    session_groups.append({
                        "positions": positions,
                        "start_time": int(df_times[positions[0]]),
                        "end_time": int(df_times[positions[-1]]),
                        "volume": float(np.sum(volume_values[positions])),
                    })
                session_groups.sort(key=lambda group: group["start_time"])
                groups_by_session[session_key] = session_groups

            # Capture historical spread burden by session from the same M5
            # candles used for Matrix. MT5 stores candle spread in points, so
            # convert it to price before comparing it with the candle range.
            point_size = None
            if "spread" in df.columns and pair != "GLOBAL_INDEX" and not pair.endswith("_GI"):
                try:
                    with mt5_service.mt5_api_lock:
                        real_symbol = _get_real_symbol(pair)
                        symbol_info = mt5_service.mt5.symbol_info(real_symbol) if isinstance(real_symbol, str) else None
                    if symbol_info and float(symbol_info.point) > 0:
                        point_size = float(symbol_info.point)
                except Exception as error:
                    print(f"Could not read MT5 point size for {pair}: {error}")

            pair_session_values = {}
            if "spread" in df.columns:
                spread_points = pd.to_numeric(df["spread"], errors="coerce").to_numpy(dtype=float)
                ranges = (pd.to_numeric(df["high"], errors="coerce") - pd.to_numeric(df["low"], errors="coerce")).to_numpy(dtype=float)
                for session_config in session_ranges:
                    session_key = session_config[0]
                    groups = [group for group in groups_by_session[session_key] if group["end_time"] >= history_start_time]
                    selected_positions = [
                        group["positions"][df_times[group["positions"]] >= history_start_time]
                        for group in groups
                    ]
                    selected_positions = [positions for positions in selected_positions if len(positions)]
                    if not selected_positions:
                        pair_session_values[session_key] = None
                        continue
                    positions = np.concatenate(selected_positions)
                    selected_spreads = spread_points[positions]
                    selected_ranges = ranges[positions]
                    valid = np.isfinite(selected_spreads) & (selected_spreads >= 0) & np.isfinite(selected_ranges) & (selected_ranges > 0)
                    if not np.any(valid):
                        pair_session_values[session_key] = None
                        continue
                    average_spread_points = float(np.mean(selected_spreads[valid]))
                    average_range = float(np.mean(selected_ranges[valid]))
                    average_spread = average_spread_points * point_size if point_size is not None else None
                    pair_session_values[session_key] = {
                        "average_spread_points": round(average_spread_points, 2),
                        "average_spread": round(average_spread, 10) if average_spread is not None else None,
                        "average_range": round(average_range, 10),
                        "spread_to_range_pct": round(average_spread / average_range * 100.0, 3) if average_spread is not None and average_range > 0 else None,
                        "samples": len(selected_positions),
                        "bars": int(np.count_nonzero(valid)),
                    }
            pair_spread_sessions[pair] = pair_session_values

            # Match historical samples at a daily cadence. Their windows use the
            # configured number of candles, so weekends/closures do not shorten them.
            historical_endpoints = []
            used_endpoint_indices = set()
            for day_offset in range(1, vol_days + 1):
                target_time = latest_time - day_offset * 86400
                endpoint_index = int(np.searchsorted(df_times, target_time, side="right") - 1)
                if endpoint_index < 0:
                    continue
                endpoint_time = int(df_times[endpoint_index])
                # Skip weekends/closures instead of reusing one old candle for
                # several daily samples.
                if target_time - endpoint_time > 8 * 3600 or endpoint_index in used_endpoint_indices:
                    continue
                used_endpoint_indices.add(endpoint_index)
                historical_endpoints.append((day_offset, endpoint_index, endpoint_time))

            def groups_intersecting_window(session_groups, window_start_time, window_end_time, end_index):
                if not session_groups:
                    return []
                group_starts = [group["start_time"] for group in session_groups]
                group_ends = [group["end_time"] for group in session_groups]
                first_group = int(np.searchsorted(group_ends, window_start_time, side="left"))
                past_last_group = int(np.searchsorted(group_starts, window_end_time, side="right"))
                selected = []
                for group in session_groups[first_group:past_last_group]:
                    positions = group["positions"]
                    available_count = int(np.searchsorted(positions, end_index, side="right"))
                    if available_count == 0:
                        continue
                    available_positions = positions[:available_count]
                    if df_times[available_positions[-1]] >= window_start_time:
                        selected.append(available_positions)
                return selected

            if pair == "GLOBAL_INDEX":
                base_currency, quote_currency = "GI", None
            elif matrix_type not in ["fx", "currency"]:
                base_currency, quote_currency = pair, None
            else:
                base_currency, quote_currency = pair[:3], pair[3:]

            for period_key, period_hours in period_configs:
                period_candles = period_hours * 12
                current_start_index = max(0, len(df) - period_candles)
                window_start_time = int(df_times[current_start_index])
                for session_config in session_ranges:
                    session_key = session_config[0]
                    session_groups = groups_by_session[session_key]
                    selected_positions = groups_intersecting_window(
                        session_groups, window_start_time, latest_time, len(df) - 1
                    )
                    selected_samples = [measure_session(df, positions, price_moves) for positions in selected_positions]
                    if not selected_samples:
                        continue

                    trends, flows, volumes, bar_counts = map(list, zip(*selected_samples))
                    average_volume = float(np.mean(volumes))
                    baseline = [
                        group["volume"] for group in session_groups
                        if history_start_time <= group["end_time"] < window_start_time and group["volume"] > 0
                    ]
                    volume_percentiles = [float(np.mean(np.asarray(baseline) <= value) * 100.0) for value in volumes] if baseline else []
                    contribution = {
                        "trend_pct": float(np.mean(trends)),
                        "flow_pct": float(np.mean(flows)),
                        "average_volume": average_volume,
                        "volume_percentile": float(np.mean(volume_percentiles)) if volume_percentiles else None,
                        "samples": len(selected_samples),
                        "bars": float(np.mean(bar_counts)),
                    }
                    if base_currency in currency_samples:
                        currency_samples[base_currency][session_key][period_key].append((contribution, 1.0))
                    if quote_currency in currency_samples:
                        currency_samples[quote_currency][session_key][period_key].append((contribution, -1.0))

                    # Build matching historical session-window movement samples
                    # so the session momentum can be ranked against Vol days.
                    for day_offset, endpoint_index, endpoint_time in historical_endpoints:
                        if endpoint_time >= window_start_time:
                            continue
                        historical_start_index = max(0, endpoint_index - period_candles + 1)
                        historical_start_time = int(df_times[historical_start_index])
                        historical_positions = groups_intersecting_window(
                            session_groups, historical_start_time, endpoint_time, endpoint_index
                        )
                        if not historical_positions:
                            continue
                        historical_metrics = [measure_session(df, positions, price_moves) for positions in historical_positions]
                        historical_contribution = {
                            "trend_pct": float(np.mean([item[0] for item in historical_metrics])),
                            "flow_pct": float(np.mean([item[1] for item in historical_metrics])),
                        }
                        if base_currency in currency_history_samples:
                            currency_history_samples[base_currency][session_key][period_key].setdefault(day_offset, []).append((historical_contribution, 1.0))
                        if quote_currency in currency_history_samples:
                            currency_history_samples[quote_currency][session_key][period_key].setdefault(day_offset, []).append((historical_contribution, -1.0))

            # Correlation matrix remains based on M30 log returns, using the same fetched bars.
            m30_close = df.assign(datetime=df["utc_time"]).set_index("datetime").resample("30min")["close"].last().dropna()
            returns = np.log(m30_close / m30_close.shift(1)).dropna()
            returns.name = pair
            if not returns.empty:
                return_series.append(returns)
        except Exception as error:
            print(f"Session Matrix failed for {pair}: {error}")
        MATRIX_PROGRESS[matrix_type] = round((pair_index + 1) / len(pairs) * 100, 2)

    def average_contributions(contributions):
        if not contributions:
            return None
        result = {}
        for field in ("trend_pct", "flow_pct", "average_volume", "volume_percentile", "samples", "bars"):
            values = [item[field] * (sign if field in ("trend_pct", "flow_pct") else 1.0) for item, sign in contributions if item.get(field) is not None]
            result[field] = float(np.mean(values)) if values else None
        return result

    session_labels = [{"key": key, "label": label} for key, label, *_ in session_ranges]
    ranking = []
    for currency in currencies:
        session_values = {}
        for session_key, *_ in session_ranges:
            session_values[session_key] = {}
            for period_key, _ in period_configs:
                value = average_contributions(currency_samples[currency][session_key][period_key])
                if value:
                    value["samples"] = int(round(value["samples"]))
                    value["bars"] = round(value["bars"], 1)
                    value["trend_pct"] = round(value["trend_pct"], 4)
                    value["flow_pct"] = round(value["flow_pct"], 4)
                    value["average_volume"] = round(value["average_volume"], 2)
                    value["volume_percentile"] = round(value["volume_percentile"], 1) if value["volume_percentile"] is not None else None
                    volume_factor = 0.5 + 0.5 * (value["volume_percentile"] if value["volume_percentile"] is not None else 50.0) / 100.0

                    # Rank T and F independently against historical windows of
                    # the same duration, then use those signed percentiles for P.
                    historical_trends = []
                    historical_flows = []
                    for history_contributions in currency_history_samples[currency][session_key][period_key].values():
                        signed_trends = [item["trend_pct"] * sign for item, sign in history_contributions]
                        signed_flows = [item["flow_pct"] * sign for item, sign in history_contributions]
                        if signed_trends and signed_flows:
                            historical_trend = float(np.mean(signed_trends))
                            historical_flow = float(np.mean(signed_flows))
                            historical_trends.append(historical_trend)
                            historical_flows.append(historical_flow)
                    if historical_trends and historical_flows:
                        trend_rank = float(np.mean(np.abs(historical_trends) <= abs(value["trend_pct"])) * 100.0)
                        flow_rank = float(np.mean(np.abs(historical_flows) <= abs(value["flow_pct"])) * 100.0)
                        value["trend_percentile"] = round(trend_rank * float(np.sign(value["trend_pct"])), 1)
                        value["flow_percentile"] = round(flow_rank * float(np.sign(value["flow_pct"])), 1)
                        value["power_score"] = round(
                            ((1 / np.e) * value["trend_percentile"] + (1 - 1 / np.e) * value["flow_percentile"])
                            * volume_factor,
                            4,
                        )
                    else:
                        value["trend_percentile"] = None
                        value["flow_percentile"] = None
                        value["power_score"] = None
                session_values[session_key][period_key] = value

        period_summary = {}
        for period_key, _ in period_configs:
            available = [session_values[key][period_key] for key, *_ in session_ranges if session_values[key][period_key]]
            if available:
                trend = float(np.mean([item["trend_pct"] for item in available]))
                flow = float(np.mean([item["flow_pct"] for item in available]))
                vol_values = [item["volume_percentile"] for item in available if item["volume_percentile"] is not None]
                volume_percentile = float(np.mean(vol_values)) if vol_values else 50.0
                power = ((1 / np.e) * trend + (1 - 1 / np.e) * flow) * (0.5 + 0.5 * volume_percentile / 100.0)
            else:
                trend, flow, volume_percentile, power = 0.0, 0.0, 50.0, 0.0
            period_summary[period_key] = {"trend_pct": round(trend, 4), "flow_pct": round(flow, 4), "volume_percentile": round(volume_percentile, 1), "power_score": round(power, 4)}

        long_summary = period_summary["long"]
        if long_summary["trend_pct"] > 0 and long_summary["flow_pct"] > 0:
            status, status_color = "Dẫn dắt", "#4ade80"
        elif long_summary["trend_pct"] <= 0 and long_summary["flow_pct"] > 0:
            status, status_color = "Tích lũy", "#38bdf8"
        elif long_summary["trend_pct"] > 0 and long_summary["flow_pct"] <= 0:
            status, status_color = "Suy yếu", "#fbbf24"
        else:
            status, status_color = "Tụt hậu", "#f87171"
        ranking.append({
            "currency": currency,
            "power_score": period_summary["long"]["power_score"],
            "short_power_score": period_summary["short"]["power_score"],
            "long_summary": period_summary["long"],
            "short_summary": period_summary["short"],
            "sessions": session_values,
            "status": status,
            "status_color": status_color,
        })
    ranking.sort(key=lambda item: (item["power_score"], item["currency"]), reverse=True)

    corr_matrix = []
    if len(currencies) > 1 and return_series:
        df_returns = pd.concat(return_series, axis=1).sort_index().ffill().dropna()
        index_returns = {currency: pd.Series(0.0, index=df_returns.index) for currency in currencies}
        for pair in df_returns.columns:
            if pair == "GLOBAL_INDEX":
                base, quote = "GI", None
            elif matrix_type not in ["fx", "currency"]:
                base, quote = pair, "USD"
            else:
                base, quote = pair[:3], pair[3:6]
            if base in index_returns:
                index_returns[base] = index_returns[base] + df_returns[pair]
            if quote in index_returns:
                index_returns[quote] = index_returns[quote] - df_returns[pair]
        correlation = pd.DataFrame(index_returns).corr()
        for c1 in correlation.index:
            row = {"currency": c1}
            for c2 in correlation.columns:
                value = correlation.loc[c1, c2]
                row[c2] = float(round(value, 2)) if not pd.isna(value) else 0.0
            corr_matrix.append(row)

    result = {
        "progress": 100.0,
        "matrix_type": matrix_type,
        "long_hours": long_hours,
        "short_hours": short_hours,
        "vol_days": vol_days,
        "sessions": session_labels,
        "ranking": ranking,
        "corr_matrix": corr_matrix,
        "currencies": currencies,
        "pair_spreads": pair_spread_sessions,
    }
    if len(_SESSION_MATRIX_CACHE) > 100:
        _SESSION_MATRIX_CACHE.clear()
        _SESSION_MATRIX_CACHE_TIME.clear()
    _SESSION_MATRIX_CACHE[cache_key] = result
    _SESSION_MATRIX_CACHE_TIME[cache_key] = now
    MATRIX_PROGRESS[matrix_type] = 100.0
    return JSONResponse(content=_json_safe(result))

@app.get("/api/v1/matrix")
def get_currency_matrix(n_hours: int = 24, vol_days: int = 30, matrix_type: str = "fx", end_time: int = 0, brokerTimezone: str = "Europe/Athens", matrix_mode: str = "money_flow"):
    import time
    cache_key = f"{n_hours}_{vol_days}_{matrix_type}_{end_time}_{brokerTimezone}_{matrix_mode}"
    current_time = time.time()
    
    # Cache for 10 seconds to prevent concurrent overlap and UI progress reset
    if cache_key in _MATRIX_CACHE and current_time - _MATRIX_CACHE_TIME.get(cache_key, 0) < 10:
        return JSONResponse(content=_json_safe(_MATRIX_CACHE[cache_key]))
        
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
            return JSONResponse(content={"progress": 100.0, "ranking": [], "pairs_data": [], "matrix_type": matrix_type})
        
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

        df['vol_rolling'] = df['value'].rolling(window=window_size, min_periods=1).sum()

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

            # Số nến của cục sau (thời gian bỏ ra để đẩy cục tiền thứ 2)
            N_after = np.maximum(i_arr - j_mid + 1, 1.0)

            # Vận tốc: Quãng đường chia cho thời gian của cục sau, nhân window_size chuẩn hoá
            df['diff_pct'] = (distance_pct / N_after) * window_size
        
        
        if len(df) > window_size:
            # Lấy trung bình cửa sổ cấu hình (window_size) để phản ánh trọn vẹn xu hướng của cả chu kỳ, triệt tiêu nhiễu giật nến cuối
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
            
            diff_array_len = int(vol_days * 24 * candles_per_hour)
            diff_array = df['diff_pct'].iloc[-diff_array_len:].fillna(0).values
            vol_array = df['vol_rolling'].iloc[-diff_array_len:].fillna(0).values
            
            # Intraday M30 Log Returns for Correlation Matrix
            df['datetime'] = pd.to_datetime(df['time'], unit='s')
            df_m30 = df.set_index('datetime').resample('30min').last()
            log_ret = np.log(df_m30['close'] / df_m30['close'].shift(1))
            log_ret.name = pair
            
            return (pair, diff_pct_current, base_currency, quote_currency, diff_array, vol_array, log_ret)
        return None

    # Fetch and process pairs sequentially to prevent MT5 deadlock
    results = []
    for i, pair in enumerate(pairs):
        res = process_pair(pair)
        results.append(res)
        MATRIX_PROGRESS[matrix_type] = round(((i + 1) / total_pairs) * 100, 2)
        
    scores_hist = {c: [] for c in currencies}
    vol_hist = {c: [] for c in currencies}
    log_returns_list = []
    
    for res in results:
        if res:
            pair, diff_pct_current, base_currency, quote_currency, diff_array, vol_array, log_ret = res
            
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
            log_returns_list.append(log_ret)

    # Xáº¿p háº¡ng currencies vÃ  tÃ­nh Vol Percentile & Mom Percentile
    ranked_currencies = []
    for c in currencies:
        vol_arr = vol_hist[c]
        scores_arr = scores_hist[c]
        
        vol_percentile = 0.0
        mom_percentile = 0.0
        if len(vol_arr) > 0 and len(scores_arr) > 0:
            # TÃ­nh Vol Percentile â€” trung bÃ¬nh cá»­a sá»•
            ws_vol = min(window_size, len(vol_arr))
            current_vol = np.mean(vol_arr[-ws_vol:]) if ws_vol > 0 else vol_arr[-1]
            
            # So sÃ¡nh vol trung bÃ¬nh cá»­a sá»• vá»›i rolling mean lá»‹ch sá»­
            if len(vol_arr) >= ws_vol:
                vol_rolling_means = pd.Series(vol_arr).rolling(ws_vol, min_periods=max(1, ws_vol//2)).mean().dropna().values
            else:
                vol_rolling_means = vol_arr
            percentile = np.mean(vol_rolling_means < current_vol) * 100
            vol_percentile = round(percentile, 2)
            
            # TÃ­nh Mom Percentile (NhÃ¢n Ä‘iá»ƒm sá»©c máº¡nh vá»›i RVOL â€” trung bÃ¬nh cá»­a sá»•)
            scores_np = np.array(scores_arr)
            vol_np = np.array(vol_arr)
            
            mean_vol = np.mean(vol_np)
            rvol = vol_np / mean_vol if mean_vol > 0 else np.ones_like(vol_np)
            weighted_scores = scores_np * rvol
            
            # Láº¥y trung bÃ¬nh cá»­a sá»• thay vÃ¬ 1 náº¿n cuá»‘i
            ws = min(window_size, len(weighted_scores))
            current_weighted = np.mean(weighted_scores[-ws:]) if ws > 0 else weighted_scores[-1]
            
            # TÃ­nh phÃ¢n phá»‘i theo cá»­a sá»• trÆ°á»£t (rolling mean) thay vÃ¬ tá»«ng náº¿n
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
    
    # Tính ma trận tương quan (Correlation Matrix) CHUẨN INTRADAY / SCALP (M30 Log Returns)
    corr_matrix = []
    if len(currencies) > 1 and len(log_returns_list) > 0:
        df_returns = pd.concat(log_returns_list, axis=1).ffill().dropna()
        
        idx_returns = {c: pd.Series(0.0, index=df_returns.index) for c in currencies}
        
        for p in df_returns.columns:
            if p == "GLOBAL_INDEX":
                b = "GI"
                q = "NONE"
            elif matrix_type not in ["fx", "currency"]:
                b = p
                q = "USD"
            else:
                b = p[:3]
                q = p[3:6]
                
            if b in idx_returns:
                idx_returns[b] = idx_returns[b] + df_returns[p]
            if q in idx_returns:
                idx_returns[q] = idx_returns[q] - df_returns[p]
                
        df_idx = pd.DataFrame(idx_returns)
        df_corr = df_idx.corr()
        
        for c1 in df_corr.index:
            row = {"currency": c1}
            for c2 in df_corr.columns:
                val = df_corr.loc[c1, c2]
                row[c2] = float(round(val, 2)) if not pd.isna(val) else 0.0
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
    return JSONResponse(content=_json_safe(result))


_MARKET_FLOW_CACHE = {}
_MARKET_FLOW_CACHE_TIME = {}
_DVP_TREND_CACHE = {}
_DVP_TREND_CACHE_TIME = {}


def _matrix_dvp_gap_snapshot(df, end_index, vwap_values, stdev_values, vwap_mult,
                             lookback_days, pct1, grid_mode, fixed_pips,
                             row_count, timeout_hours):
    """Measure mean D-VP spacing, including empty edges of the global VWAP band."""
    if end_index < 0 or end_index >= len(df):
        return None

    stamp = int(df["time"].iloc[end_index])
    start_stamp = stamp - int(lookback_days * 24 * 3600)
    start_index = int(np.searchsorted(df["time"].to_numpy(dtype=np.int64), start_stamp, side="left"))
    window = df.iloc[start_index:end_index + 1]
    if len(window) < 3:
        return None

    vwap = float(vwap_values[end_index])
    stdev = float(stdev_values[end_index])
    close = float(df["close"].iloc[end_index])
    if not np.isfinite(vwap) or not np.isfinite(stdev) or stdev <= 0:
        return None

    band_low = vwap - (stdev * vwap_mult)
    band_high = vwap + (stdev * vwap_mult)
    if grid_mode == "fixed":
        mean_price = float(window["close"].mean())
        if mean_price > 0:
            pip_size = 10 ** np.floor(np.log10(mean_price * (0.0001 / 1.10)))
        else:
            pip_size = 0.0001
        bin_size = fixed_pips * pip_size
    else:
        recent = window.tail(min(120, len(window)))
        recent_range = float(recent["high"].max() - recent["low"].min())
        bin_size = recent_range / max(1, row_count)

    profile_range = float(window["high"].max() - window["low"].min())
    if profile_range <= 0:
        return None
    if not np.isfinite(bin_size) or bin_size <= 0:
        bin_size = profile_range / max(1, row_count)
    # Keep the matrix calculation bounded for instruments with very fine fixed-pip grids.
    resolution_cap = max(100, min(1000, row_count * 4))
    if profile_range / bin_size > resolution_cap:
        bin_size = profile_range / float(resolution_cap)

    lows = window["low"].to_numpy(dtype=float)
    highs = window["high"].to_numpy(dtype=float)
    volumes = window["value"].to_numpy(dtype=float)
    min_bins = np.floor(lows / bin_size).astype(np.int64)
    max_bins = np.floor(highs / bin_size).astype(np.int64)
    bin_counts = np.maximum(max_bins - min_bins + 1, 1)

    # Expand candle ranges into D-VP price-bin events, then split each bin's
    # history into boxes when its inactivity exceeds the chart's timeout.
    event_count = int(bin_counts.sum())
    if event_count <= 0 or event_count > 2_000_000:
        return None
    event_bar = np.repeat(np.arange(len(window), dtype=np.int32), bin_counts)
    event_start_offsets = np.repeat(np.cumsum(bin_counts, dtype=np.int64) - bin_counts, bin_counts)
    event_bins = np.repeat(min_bins, bin_counts) + (np.arange(event_count, dtype=np.int64) - event_start_offsets)
    event_volumes = np.repeat(volumes / bin_counts, bin_counts)

    order = np.lexsort((event_bar, event_bins))
    sorted_bins = event_bins[order]
    sorted_bars = event_bar[order]
    sorted_volumes = event_volumes[order]
    timeout_bars = max(int(timeout_hours * 3600 / 300), 3)
    run_starts = np.ones(event_count, dtype=bool)
    if event_count > 1:
        run_starts[1:] = (sorted_bins[1:] != sorted_bins[:-1]) | ((sorted_bars[1:] - sorted_bars[:-1]) > timeout_bars)
    run_ids = np.cumsum(run_starts, dtype=np.int64) - 1
    box_volumes = np.bincount(run_ids, weights=sorted_volumes)
    box_bins = sorted_bins[run_starts]
    positive_boxes = box_volumes > 0
    box_volumes = box_volumes[positive_boxes]
    box_bins = box_bins[positive_boxes]
    if not len(box_volumes):
        return None

    volume_cutoff = float(np.percentile(box_volumes, pct1))
    kept_bins = np.unique(box_bins[box_volumes >= volume_cutoff])
    if not len(kept_bins):
        return None

    centers = kept_bins.astype(float) * bin_size + bin_size / 2.0
    in_band = (centers + bin_size / 2.0 >= band_low) & (centers - bin_size / 2.0 <= band_high)
    band_bins = kept_bins[in_band]
    band_bins = np.unique(np.sort(band_bins))
    if not len(band_bins):
        return {
            # With no retained D-VP zone in the band, treat the whole band as
            # one empty gap. Its width is 2 * vwap_mult standard deviations.
            "gap_sd": float((band_high - band_low) / stdev),
            "zones": 0,
            "close_vwap_sd": float((close - vwap) / stdev),
        }
    zone_breaks = np.where(np.diff(band_bins) > 1)[0] + 1
    zones = np.split(band_bins, zone_breaks)
    gaps = []
    if len(zones):
        # Count empty space between each band edge and the nearest retained D-VP
        # zone, as well as the empty spaces between neighboring zones.
        first_zone_low = float(zones[0][0]) * bin_size
        last_zone_high = (float(zones[-1][-1]) + 1.0) * bin_size
        lower_edge_gap = max(0.0, first_zone_low - band_low)
        upper_edge_gap = max(0.0, band_high - last_zone_high)
        if lower_edge_gap > 0:
            gaps.append(lower_edge_gap / stdev)
        if upper_edge_gap > 0:
            gaps.append(upper_edge_gap / stdev)

        for left, right in zip(zones[:-1], zones[1:]):
            gap = (float(right[0]) - float(left[-1]) - 1.0) * bin_size
            if gap > 0:
                gaps.append(gap / stdev)
    return {
        # A retained zone can cover the entire band. That is a valid zero-gap
        # observation and must participate in the Vol-days distribution.
        "gap_sd": float(np.mean(gaps)) if gaps else 0.0,
        "zones": int(len(zones)),
        "close_vwap_sd": float((close - vwap) / stdev),
    }


@app.get("/api/v1/matrix/dvp-trend")
def get_dvp_trend_ranking(
    matrix_type: str = "fx",
    vol_days: int = 30,
    end_time: int = 0,
    brokerTimezone: str = "Europe/Athens",
    dvp_lookback_days: float = 0,
    vwap_length: int = 0,
    vwap_mult: float = 0,
    pct1: float = -1,
    grid_mode: str = "",
    fixed_pips: float = 0,
    row_count: int = 0,
    timeout_hours: float = 0,
    force: bool = False,
):
    """Rank assets by today's D-VP gap spacing versus same-time snapshots in Vol days."""
    try:
        with open(CONFIG_FILE, "r") as config_file:
            config = json.load(config_file)
    except Exception:
        config = {}

    vol_days = max(1, min(int(vol_days), 365))
    lookback_days = max(1.0, min(float(dvp_lookback_days or config.get("dvpLookbackDays", 5)), 90.0))
    vwap_length = max(1, min(int(vwap_length or config.get("vwapLength", 89)), 24 * 30))
    vwap_mult = max(0.1, min(float(vwap_mult or config.get("vwapMult", 2)), 10.0))
    pct1 = max(0.0, min(float(config.get("pct1", 75) if pct1 < 0 else pct1), 100.0))
    grid_mode = grid_mode or config.get("gridMode", "auto")
    fixed_pips = max(0.01, float(fixed_pips or config.get("fixedPips", 10)))
    row_count = max(5, min(int(row_count or config.get("rowCount", 50)), 500))
    timeout_hours = max(0.05, min(float(timeout_hours or config.get("timeoutHours", 1)), 24.0))

    if matrix_type in ("fx", "currency"):
        symbols = [
            "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "EURGBP", "EURAUD", "EURNZD",
            "EURJPY", "GBPAUD", "GBPNZD", "GBPJPY", "AUDNZD", "AUDJPY", "NZDJPY",
        ]
    else:
        symbols = config.get("matrix_groups", {}).get(matrix_type, [])
    if not symbols:
        return JSONResponse(content={"matrix_type": matrix_type, "vol_days": vol_days, "rows": [], "message": "Không có tài sản trong nhóm này."})

    key = (
        "trading-day-samples-v3", matrix_type, vol_days, int(end_time or 0), brokerTimezone, lookback_days, vwap_length,
        vwap_mult, pct1, grid_mode, fixed_pips, row_count, timeout_hours,
    )
    now = time.time()
    if not force and key in _DVP_TREND_CACHE and now - _DVP_TREND_CACHE_TIME.get(key, 0) < 60:
        return JSONResponse(content=_json_safe(_DVP_TREND_CACHE[key]))

    bars_per_day = 24 * 12  # Same M5 source interval used by Currency Matrix.
    max_profiles = vol_days
    history_bars = min(
        100_000,
        max(240, int((max_profiles * 1.5 + lookback_days + (vwap_length / 24.0) + 2) * bars_per_day)),
    )
    MATRIX_PROGRESS["dvp_trend"] = 0.0
    rows = []

    for symbol_index, symbol in enumerate(symbols):
        try:
            raw = get_historical_data(symbol, "M5", history_bars, end_time, brokerTimezone, fallback_ea=False)
            required = {"time", "high", "low", "close"}
            if raw is None or raw.empty or not required.issubset(raw.columns):
                MATRIX_PROGRESS["dvp_trend"] = round((symbol_index + 1) / len(symbols) * 100, 2)
                continue

            df = raw.copy().sort_values("time").drop_duplicates("time").reset_index(drop=True)
            for column in ("time", "high", "low", "close"):
                df[column] = pd.to_numeric(df[column], errors="coerce")
            volume_column = "value" if "value" in df.columns else "tick_volume"
            if volume_column not in df.columns:
                df["value"] = 0.0
            else:
                df["value"] = pd.to_numeric(df[volume_column], errors="coerce").fillna(0).clip(lower=0)
            df = df.dropna(subset=["time", "high", "low", "close"]).reset_index(drop=True)
            if len(df) < max(12, vwap_length * 12 // 2):
                MATRIX_PROGRESS["dvp_trend"] = round((symbol_index + 1) / len(symbols) * 100, 2)
                continue

            hlc3 = (df["high"].to_numpy(dtype=float) + df["low"].to_numpy(dtype=float) + df["close"].to_numpy(dtype=float)) / 3.0
            volumes = df["value"].to_numpy(dtype=float)
            vwap_window = max(1, vwap_length * 12)
            vol_sum = pd.Series(volumes).rolling(window=vwap_window, min_periods=1).sum().to_numpy(dtype=float)
            vwap_series = pd.Series(hlc3 * volumes).rolling(window=vwap_window, min_periods=1).sum().to_numpy(dtype=float) / np.maximum(vol_sum, 1e-9)
            variance = pd.Series(((hlc3 - vwap_series) ** 2) * volumes).rolling(window=vwap_window, min_periods=1).sum().to_numpy(dtype=float) / np.maximum(vol_sum, 1e-9)
            stdev_series = np.sqrt(np.maximum(variance, 0.0))

            times = df["time"].to_numpy(dtype=np.int64)
            latest_time = int(times[-1])
            sample_indices = [len(df) - 1]
            seen_indices = {len(df) - 1}
            # Vol days represent distinct days with market data, not calendar
            # days. Scan further back to replace weekends/holidays with actual
            # trading-day snapshots until the requested sample count is filled.
            for day in range(1, max_profiles * 2 + 8):
                if len(sample_indices) >= max_profiles + 1:
                    break
                target_time = latest_time - day * 24 * 3600
                candidate = int(np.searchsorted(times, target_time, side="right") - 1)
                if candidate < 0 or target_time - int(times[candidate]) > 72 * 3600:
                    continue
                if candidate not in seen_indices:
                    sample_indices.append(candidate)
                    seen_indices.add(candidate)

            current = _matrix_dvp_gap_snapshot(
                df, sample_indices[0], vwap_series, stdev_series, vwap_mult, lookback_days,
                pct1, grid_mode, fixed_pips, row_count, timeout_hours,
            )
            historical = []
            for sample_index in sample_indices[1:]:
                sample = _matrix_dvp_gap_snapshot(
                    df, sample_index, vwap_series, stdev_series, vwap_mult, lookback_days,
                    pct1, grid_mode, fixed_pips, row_count, timeout_hours,
                )
                if sample and sample.get("gap_sd") is not None and np.isfinite(sample["gap_sd"]):
                    historical.append(float(sample["gap_sd"]))

            gap_sd = current.get("gap_sd") if current else None
            percentile = None
            if gap_sd is not None and len(historical) >= 5:
                less = sum(value < gap_sd for value in historical)
                equal = sum(np.isclose(value, gap_sd) for value in historical)
                percentile = ((less + 0.5 * equal) / len(historical)) * 100.0

            close_vwap_sd = current.get("close_vwap_sd") if current else None
            if close_vwap_sd is None:
                direction = "neutral"
            elif close_vwap_sd > 0.05:
                direction = "up"
            elif close_vwap_sd < -0.05:
                direction = "down"
            else:
                direction = "neutral"
            rows.append({
                "symbol": symbol,
                "direction": direction,
                "close_vwap_sd": round(float(close_vwap_sd), 2) if close_vwap_sd is not None and np.isfinite(close_vwap_sd) else None,
                "gap_sd": round(float(gap_sd), 3) if gap_sd is not None and np.isfinite(gap_sd) else None,
                "percentile": round(float(percentile), 1) if percentile is not None and np.isfinite(percentile) else None,
                "zones": int(current.get("zones", 0)) if current else 0,
                "samples": len(historical),
            })
        except Exception as error:
            print(f"D-VP trend Matrix failed for {symbol}: {error}")
        MATRIX_PROGRESS["dvp_trend"] = round((symbol_index + 1) / len(symbols) * 100, 2)

    rows.sort(key=lambda row: row["percentile"] if row["percentile"] is not None else -1, reverse=True)
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    result = {
        "matrix_type": matrix_type,
        "vol_days": vol_days,
        "sample_days": max_profiles,
        "vwap_length": vwap_length,
        "vwap_mult": vwap_mult,
        "dvp_lookback_days": lookback_days,
        "rows": rows,
    }
    if len(_DVP_TREND_CACHE) > 50:
        _DVP_TREND_CACHE.clear()
        _DVP_TREND_CACHE_TIME.clear()
    _DVP_TREND_CACHE[key] = result
    _DVP_TREND_CACHE_TIME[key] = now
    MATRIX_PROGRESS["dvp_trend"] = 100.0
    return JSONResponse(content=_json_safe(result))


@app.get("/api/v1/matrix/market-flows")
def get_market_flow_matrix(
    short_hours: int = 24,
    long_hours: int = 89,
    vol_days: int = 30,
    end_time: int = 0,
    brokerTimezone: str = "Europe/Athens",
    force: bool = False,
):
    """Compare each market's own GI using the same V-target momentum logic as Currency Matrix."""
    short_hours = max(1, min(int(short_hours), 24 * 30))
    long_hours = max(short_hours, min(int(long_hours), 24 * 30))
    vol_days = max(1, min(int(vol_days), 365))
    cache_key = (short_hours, long_hours, vol_days, int(end_time or 0), brokerTimezone)
    now = time.time()
    if not force and cache_key in _MARKET_FLOW_CACHE and now - _MARKET_FLOW_CACHE_TIME.get(cache_key, 0) < 30:
        return JSONResponse(content=_json_safe(_MARKET_FLOW_CACHE[cache_key]))

    try:
        with open(CONFIG_FILE, "r") as config_file:
            config = json.load(config_file)
    except Exception:
        config = {}

    markets = [
        {"key": "fx", "label": "Forex", "gi_symbol": "GLOBAL_INDEX"},
        {"key": "us_stocks", "label": "Cổ phiếu Mỹ", "gi_symbol": "US_STOCKS_GI"},
        {"key": "commodities", "label": "Hàng hóa", "gi_symbol": "COMMODITIES_GI"},
        {"key": "crypto", "label": "Crypto", "gi_symbol": "CRYPTO_GI"},
        {"key": "usd_assets", "label": "USD vs Assets", "gi_symbol": "USD_ASSETS_GI"},
    ]
    candles_per_hour = 12  # Matrix history uses M5 candles.
    history_bars = max(long_hours * candles_per_hour + 25, int(vol_days * 24 * candles_per_hour * 1.5))
    lookback_candles = int(vol_days * 24 * candles_per_hour)
    target_pct = float(config.get("mfTargetPct", 75)) / 100.0

    def calculate_mode(df, window_size, mode, prepared_by_window):
        if len(df) <= window_size:
            return None

        prepared = prepared_by_window.get(window_size)
        if prepared is None:
            values = df["value"].to_numpy(dtype=float)
            prices = df["hlc3"].to_numpy(dtype=float)
            vol_rolling = pd.Series(values).rolling(window=window_size, min_periods=1).sum()
            v_series = np.maximum(
                vol_rolling.rolling(window=lookback_candles, min_periods=1)
                .quantile(target_pct).fillna(1.0).to_numpy(dtype=float),
                1.0,
            )
            prepared = {
                "values": values,
                "prices": prices,
                "vol_rolling": vol_rolling,
                "v_series": v_series,
                "cum_vol": np.cumsum(values),
                "cum_vwap_vol": np.cumsum(prices * values),
            }
            prepared_by_window[window_size] = prepared
        values = prepared["values"]
        prices = prepared["prices"]
        vol_rolling = prepared["vol_rolling"]
        v_series = prepared["v_series"]
        cum_vol = prepared["cum_vol"]
        cum_vwap_vol = prepared["cum_vwap_vol"]
        n = len(df)
        i_arr = np.arange(n)

        target_current = cum_vol - v_series
        j_current = np.searchsorted(cum_vol, target_current, side="right")
        j_cur_m1 = np.where(j_current > 0, j_current - 1, 0)
        has_j_cur = j_current > 0
        vol_before_current = np.where(has_j_cur, cum_vol[j_cur_m1], 0.0)

        if mode == "flow":
            previous = np.roll(prices, 1)
            previous[0] = prices[0]
            returns_pct = np.where(previous > 0, (prices - previous) / previous * 100.0, 0.0)
            cumulative_momentum = np.cumsum(returns_pct * values)
            net_momentum = cumulative_momentum - np.where(has_j_cur, cumulative_momentum[j_cur_m1], 0.0)
            diff_pct = np.where(v_series > 0, (net_momentum / v_series) * window_size, 0.0)
        else:
            half_volume = v_series / 2.0
            target_mid = np.maximum(cum_vol - half_volume, 0.0)
            j_mid = np.searchsorted(cum_vol, target_mid, side="right")
            j_mid_m1 = np.where(j_mid > 0, j_mid - 1, 0)
            has_j_mid = j_mid > 0
            vol_before_mid = np.where(has_j_mid, cum_vol[j_mid_m1], 0.0)
            vol_after = cum_vol - vol_before_mid
            vwap_vol_after = cum_vwap_vol - np.where(has_j_mid, cum_vwap_vol[j_mid_m1], 0.0)
            vwap_after = np.where(vol_after > 0, vwap_vol_after / np.maximum(vol_after, 1e-9), prices)
            earlier_vol = vol_before_mid - vol_before_current
            earlier_vwap_vol = np.where(has_j_mid, cum_vwap_vol[j_mid_m1], 0.0) - np.where(has_j_cur, cum_vwap_vol[j_cur_m1], 0.0)
            vwap_before = np.where(earlier_vol > 0, earlier_vwap_vol / np.maximum(earlier_vol, 1e-9), prices)
            distance_pct = np.where(vwap_before > 0, (vwap_after - vwap_before) / vwap_before * 100.0, 0.0)
            bars_after = np.maximum(i_arr - j_mid + 1, 1.0)
            diff_pct = (distance_pct / bars_after) * window_size

        history_length = min(lookback_candles, len(df))
        score_series = pd.Series(diff_pct[-history_length:]).replace([np.inf, -np.inf], np.nan).fillna(0.0).to_numpy()
        volume_series = vol_rolling.to_numpy(dtype=float)[-history_length:]
        current_score = float(np.mean(diff_pct[-window_size:]))
        if not np.isfinite(current_score):
            return None

        volume_window = min(window_size, len(volume_series))
        current_volume = float(np.mean(volume_series[-volume_window:])) if volume_window else 0.0
        volume_rolling_means = pd.Series(volume_series).rolling(
            volume_window, min_periods=max(1, volume_window // 2)
        ).mean().dropna().to_numpy()
        volume_percentile = float(np.mean(volume_rolling_means < current_volume) * 100.0) if len(volume_rolling_means) else 0.0

        mean_volume = float(np.mean(volume_series)) if len(volume_series) else 0.0
        relative_volume = volume_series / mean_volume if mean_volume > 0 else np.ones_like(volume_series)
        weighted_scores = score_series * relative_volume
        current_weighted = float(np.mean(weighted_scores[-volume_window:])) if volume_window else 0.0
        rolling_means = pd.Series(weighted_scores).rolling(
            volume_window, min_periods=max(1, volume_window // 2)
        ).mean().dropna().to_numpy()
        if len(rolling_means):
            momentum_percentile = float(np.mean(np.abs(rolling_means) <= abs(current_weighted)) * 100.0)
            if current_weighted < 0:
                momentum_percentile = -momentum_percentile
        else:
            momentum_percentile = 0.0
        return {
            "score": current_score,
            "momentum_pct": momentum_percentile,
            "volume_pct": volume_percentile,
        }

    market_rows = []
    gi_return_series = []
    MATRIX_PROGRESS["market_flows"] = 0.0
    for market_index, market in enumerate(markets):
        try:
            df = get_historical_data(market["gi_symbol"], "M5", history_bars, end_time, brokerTimezone, fallback_ea=False)
            if df is None or df.empty or not {"time", "high", "low", "close", "value"}.issubset(df.columns):
                market_rows.append({**market, "long": None, "short": None})
                MATRIX_PROGRESS["market_flows"] = round((market_index + 1) / len(markets) * 100, 2)
                continue

            df = df.copy().sort_values("time").reset_index(drop=True)
            for column in ("high", "low", "close", "value"):
                df[column] = pd.to_numeric(df[column], errors="coerce")
            df = df.dropna(subset=["high", "low", "close"]).reset_index(drop=True)
            df["value"] = df["value"].fillna(0).clip(lower=0)
            df["hlc3"] = (df["high"] + df["low"] + df["close"]) / 3.0

            period_metrics = {}
            prepared_by_window = {}
            for period_key, hours in (("long", long_hours), ("short", short_hours)):
                window_size = hours * candles_per_hour
                trend = calculate_mode(df, window_size, "trend", prepared_by_window)
                flow = calculate_mode(df, window_size, "flow", prepared_by_window)
                if trend and flow:
                    volume_pct = (trend["volume_pct"] + flow["volume_pct"]) / 2.0
                    power_score = ((1.0 / np.e) * trend["momentum_pct"] + (1.0 - 1.0 / np.e) * flow["momentum_pct"]) * (0.5 + 0.5 * volume_pct / 100.0)
                    if trend["momentum_pct"] > 0 and flow["momentum_pct"] > 0:
                        status = "Dẫn dắt"
                    elif trend["momentum_pct"] <= 0 and flow["momentum_pct"] > 0:
                        status = "Tích lũy"
                    elif trend["momentum_pct"] > 0 and flow["momentum_pct"] <= 0:
                        status = "Suy yếu"
                    else:
                        status = "Tụt hậu"
                    period_metrics[period_key] = {
                        "trend": {"score": round(trend["score"], 4), "momentum_pct": round(trend["momentum_pct"], 2)},
                        "flow": {"score": round(flow["score"], 4), "momentum_pct": round(flow["momentum_pct"], 2)},
                        "volume_pct": round(volume_pct, 2),
                        "power_score": round(float(power_score), 2),
                        "status": status,
                    }
                else:
                    period_metrics[period_key] = None
            market_rows.append({**market, **period_metrics})

            datetime_index = pd.to_datetime(df["time"], unit="s")
            close_by_time = pd.Series(df["close"].to_numpy(dtype=float), index=datetime_index)
            close_m30 = close_by_time.resample("30min").last()
            gi_returns = np.log(close_m30 / close_m30.shift(1)).replace([np.inf, -np.inf], np.nan)
            gi_returns.name = market["label"]
            gi_return_series.append(gi_returns)
        except Exception as error:
            print(f"Market flow Matrix failed for {market['gi_symbol']}: {error}")
            market_rows.append({**market, "long": None, "short": None})
        MATRIX_PROGRESS["market_flows"] = round((market_index + 1) / len(markets) * 100, 2)

    corr_matrix = []
    if len(gi_return_series) > 1:
        returns = pd.concat(gi_return_series, axis=1).sort_index().ffill().dropna()
        if not returns.empty:
            correlation = returns.corr()
            for market_label in correlation.index:
                row = {"market": market_label}
                for other_market in correlation.columns:
                    value = correlation.loc[market_label, other_market]
                    row[other_market] = float(round(value, 2)) if not pd.isna(value) else None
                corr_matrix.append(row)

    result = {
        "long_hours": long_hours,
        "short_hours": short_hours,
        "vol_days": vol_days,
        "ranking_long": sorted(market_rows, key=lambda item: (item.get("long") or {}).get("power_score", -float("inf")), reverse=True),
        "ranking_short": sorted(market_rows, key=lambda item: (item.get("short") or {}).get("power_score", -float("inf")), reverse=True),
        "markets": [market["label"] for market in markets],
        "corr_matrix": corr_matrix,
    }
    if len(_MARKET_FLOW_CACHE) > 50:
        _MARKET_FLOW_CACHE.clear()
        _MARKET_FLOW_CACHE_TIME.clear()
    _MARKET_FLOW_CACHE[cache_key] = result
    _MARKET_FLOW_CACHE_TIME[cache_key] = now
    MATRIX_PROGRESS["market_flows"] = 100.0
    return JSONResponse(content=_json_safe(result))

# Serve Frontend SPA
FRONTEND_DIST = get_frontend_dist_dir()
if os.path.exists(FRONTEND_DIST):
    # Phá»¥c vá»¥ thÆ° má»¥c assets (CSS, JS)
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    # Phá»¥c vá»¥ index.html cho cÃ¡c route cÃ²n láº¡i
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
                        
                    allowed_keys = ['pct1', 'pct2', 'gridMode', 'fixedPips', 'rowCount', 'timeoutHours', 'dvpLookbackDays', 'mfTargetPct', 'mfTimeoutCandles', 'vwapLength', 'vwapMult', 'rvolLookbackDays', 'peakVolLookbackDays', 'momLength', 'matrixLookbackHours', 'momPct1', 'momPct2', 'momPct3', 'maVolLength', 'momMaLength', 'smaMomLength', 'momFlipFilterPct', 'momFlipVolFilterPct', 'volPct1', 'volPct2', 'volPct3', 'volPct4', 'timeShiftHours', 'browserOffsetHours', 'autoDst', 'asiaStart', 'asiaEnd', 'euroStart', 'euroEnd', 'preUsStart', 'preUsEnd', 'usStart', 'usEnd', 'brokerTimezone']
                    kwargs = {k: v for k, v in configs.items() if k in allowed_keys}
                    
                    ohlcv_res = await asyncio.to_thread(get_ohlcv, symbol, timeframe, 1000, 0, True, **kwargs)
                    
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
                                alert_service.send_email(strat['symbol'], c_close, f"Chiáº¿n lÆ°á»£c '{strat.get('name', 'Strategy Builder')}' Ä‘Ã£ hoÃ n thÃ nh táº¥t cáº£ cÃ¡c bÆ°á»›c ({len(steps)} bÆ°á»›c) táº¡i giÃ¡ {c_close}!", "HOÃ€N THÃ€NH", "strategy")
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

