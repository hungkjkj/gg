import MetaTrader5 as mt5
import pandas as pd
from datetime import datetime

# Cấu hình đăng nhập
# Tạm thời vô hiệu hóa Login tự động để MT5 sử dụng tài khoản XM đang đăng nhập sẵn trên máy.

def initialize_mt5():
    """Khởi tạo kết nối với phần mềm MT5"""
    # Nếu không điền login/password, MT5 sẽ dùng tài khoản đang đăng nhập trong phần mềm.
    if not mt5.initialize():
        print(f"MT5 Initialization Failed: {mt5.last_error()}")
        return False
    print("MT5 Initialized Successfully")
    pre_scan_symbols()
    return True

def pre_scan_symbols():
    """Quét trước các mã phổ biến để tìm hậu tố của sàn"""
    common_symbols = [
        "EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY",
        "EURGBP", "EURAUD", "EURNZD", "EURJPY",
        "GBPAUD", "GBPNZD", "GBPJPY",
        "AUDNZD", "AUDJPY", "NZDJPY",
        "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "SOLUSD"
    ]
    print("Pre-scanning symbols to build cache...")
    for sym in common_symbols:
        _get_real_symbol(sym)
    print("Pre-scanning complete.")

def shutdown_mt5():
    mt5.shutdown()

def _get_mt5_timeframe(tf_string: str):
    """Chuyển đổi chuỗi Timeframe (H1, M5) sang hằng số của MT5"""
    tf_map = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1,
        "H2": mt5.TIMEFRAME_H2,
        "H4": mt5.TIMEFRAME_H4,
        "H8": mt5.TIMEFRAME_H8,
        "D1": mt5.TIMEFRAME_D1,
        "W1": mt5.TIMEFRAME_W1,
        "MN1": mt5.TIMEFRAME_MN1,
    }
    return tf_map.get(tf_string.upper(), mt5.TIMEFRAME_H1)

import time
import os
import threading

ea_lock = threading.Lock()

_SYMBOL_CACHE = {}
_ALL_SYMBOLS_CACHE = None

def _get_real_symbol(symbol: str):
    if mt5.terminal_info() is None:
        initialize_mt5()
    
    # Xử lý riêng GLOBAL_INDEX
    if symbol.upper() == 'GLOBAL_INDEX':
        return symbol
        
    if symbol in _SYMBOL_CACHE:
        return _SYMBOL_CACHE[symbol]
        
    if mt5.symbol_select(symbol, True):
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 0, 1)
        if rates is not None and len(rates) > 0:
            _SYMBOL_CACHE[symbol] = symbol
            return symbol
            
    syms = mt5.symbols_get(group=f"*{symbol}*")
    if syms:
        for s in syms:
            if mt5.symbol_select(s.name, True):
                rates = mt5.copy_rates_from_pos(s.name, mt5.TIMEFRAME_H1, 0, 1)
                if rates is not None and len(rates) > 0:
                    _SYMBOL_CACHE[symbol] = s.name
                    return s.name
                    
    _SYMBOL_CACHE[symbol] = symbol
    return symbol

def get_all_symbols():
    """Lấy toàn bộ danh sách symbols từ MT5 và phân loại theo nhóm"""
    global _ALL_SYMBOLS_CACHE
    if _ALL_SYMBOLS_CACHE is not None:
        return _ALL_SYMBOLS_CACHE
        
    if mt5.terminal_info() is None:
        initialize_mt5()
        
    syms = mt5.symbols_get()
    if not syms:
        return {}
        
    res = {}
    for s in syms:
        # Nhóm theo cấp 1 và cấp 2 của đường dẫn (path)
        parts = s.path.split('\\')
        group = f"{parts[0]} - {parts[1]}" if len(parts) > 1 else parts[0]
        
        if group not in res:
            res[group] = []
            
        res[group].append({
            "name": s.name,
            "description": s.description
        })
        
    _ALL_SYMBOLS_CACHE = res
    return res

def get_tick(symbol: str):
    """Lấy tick hiện tại của một symbol"""
    if mt5.terminal_info() is None:
        initialize_mt5()
    
    # Xử lý riêng GLOBAL_INDEX
    if symbol == "GLOBAL_INDEX":
        sym_eur = _get_real_symbol("EURUSD")
        sym_jpy = _get_real_symbol("USDJPY")
        sym_gbp = _get_real_symbol("GBPUSD")
        
        if mt5.symbol_select(sym_eur, True) and mt5.symbol_select(sym_jpy, True) and mt5.symbol_select(sym_gbp, True):
            t_eur = mt5.symbol_info_tick(sym_eur)
            t_jpy = mt5.symbol_info_tick(sym_jpy)
            t_gbp = mt5.symbol_info_tick(sym_gbp)
            
            if t_eur and t_jpy and t_gbp and t_eur.bid > 0 and t_jpy.bid > 0 and t_gbp.bid > 0:
                eur_bid, jpy_bid, gbp_bid = t_eur.bid, t_jpy.bid, t_gbp.bid
                dxy_bid = 50.14 * (eur_bid ** -0.576) * (jpy_bid ** 0.136) * (gbp_bid ** -0.119)
                gi_bid = 10000.0 / dxy_bid
                return {
                    "time": int(t_eur.time),
                    "bid": gi_bid,
                    "ask": gi_bid,
                    "last": gi_bid
                }
            else:
                # Fallback to copy_rates if tick is unavailable
                r_eur = mt5.copy_rates_from_pos(sym_eur, mt5.TIMEFRAME_M1, 0, 1)
                r_jpy = mt5.copy_rates_from_pos(sym_jpy, mt5.TIMEFRAME_M1, 0, 1)
                r_gbp = mt5.copy_rates_from_pos(sym_gbp, mt5.TIMEFRAME_M1, 0, 1)
                if r_eur is not None and r_jpy is not None and r_gbp is not None and len(r_eur) > 0 and len(r_jpy) > 0 and len(r_gbp) > 0:
                    eur_c, jpy_c, gbp_c = r_eur[0]['close'], r_jpy[0]['close'], r_gbp[0]['close']
                    dxy_c = 50.14 * (eur_c ** -0.576) * (jpy_c ** 0.136) * (gbp_c ** -0.119)
                    gi_c = 10000.0 / dxy_c
                    return {
                        "time": int(r_eur[0]['time']),
                        "bid": float(gi_c),
                        "ask": float(gi_c),
                        "last": float(gi_c)
                    }
        return None
        
    real_sym = _get_real_symbol(symbol)
    if mt5.symbol_select(real_sym, True):
        tick = mt5.symbol_info_tick(real_sym)
        if tick is not None and tick.bid > 0:
            return {
                "time": tick.time,
                "bid": tick.bid,
                "ask": tick.ask,
                "last": tick.last
            }
        else:
            rates = mt5.copy_rates_from_pos(real_sym, mt5.TIMEFRAME_M1, 0, 1)
            if rates is not None and len(rates) > 0:
                last_rate = rates[0]
                return {
                    "time": int(last_rate['time']),
                    "bid": float(last_rate['close']),
                    "ask": float(last_rate['close']),
                    "last": float(last_rate['close'])
                }
    return None

def _fetch_raw_data(symbol: str, timeframe: str, count: int = 1000, end_time: int = 0, brokerTimezone: str = "Europe/Athens"):
    """Lấy dữ liệu OHLCV quá khứ từ MT5, fallback sang EA nếu API bị chặn"""
    
    # 1. THỬ API CHÍNH THỨC TRƯỚC
    if mt5.terminal_info() is None:
        initialize_mt5()
        
    if mt5.terminal_info() is not None:
        tf = _get_mt5_timeframe(timeframe)
        real_sym = _get_real_symbol(symbol)
        if mt5.symbol_select(real_sym, True):
            if end_time > 0:
                # end_time nhận vào là UTC timestamp, cần đổi sang Broker Time
                utc_dt = pd.to_datetime(end_time, unit='s', utc=True)
                try:
                    broker_dt = utc_dt.tz_convert(brokerTimezone)
                except Exception:
                    # Fallback if timezone is invalid
                    broker_dt = utc_dt
                end_time_broker = int(broker_dt.tz_localize(None).timestamp())
                rates = mt5.copy_rates_from(real_sym, tf, end_time_broker, count)
            else:
                rates = mt5.copy_rates_from_pos(real_sym, tf, 0, count)
                
            if rates is not None and len(rates) > 0:
                df = pd.DataFrame(rates)
                df['datetime'] = pd.to_datetime(df['time'], unit='s')
                df['value'] = df['tick_volume']
                return df
                
    # 2. API BỊ CHẶN -> FALLBACK SANG MQL5 EXPERT ADVISOR (DataServer)
    print(f"Warning: MT5 API failed. Falling back to MQL5 DataServer for {symbol} {timeframe}")
    
    t_info = mt5.terminal_info()
    if t_info is None:
        print("Cannot get MT5 terminal info for fallback.")
        return pd.DataFrame()
        
    mt5_files_dir = os.path.join(t_info.data_path, "MQL5", "Files")
    req_file = os.path.join(mt5_files_dir, "req.txt")
    res_file = os.path.join(mt5_files_dir, "res.csv")
    
    with ea_lock:
        # Xoá file cũ nếu có
        retry = 0
        while os.path.exists(res_file) and retry < 20:
            try: os.remove(res_file)
            except: 
                time.sleep(0.1)
                retry += 1
                
        if os.path.exists(res_file):
            print("Cannot delete old res.csv, aborting EA fallback to avoid stale data.")
            return pd.DataFrame()
            
        # Ghi yêu cầu vào file
        real_sym_for_ea = _get_real_symbol(symbol) if mt5.terminal_info() is not None else symbol
        try:
            with open(req_file, "w") as f:
                f.write(f"{real_sym_for_ea},{timeframe},{count},{end_time}")
        except Exception as e:
            print(f"Failed to write req.txt: {e}")
            return pd.DataFrame()
            
        # Đợi EA xử lý (tối đa 5 giây)
        timeout = 5.0
        start_time = time.time()
        while time.time() - start_time < timeout:
            if os.path.exists(res_file):
                # Cố gắng đọc file (thêm delay nhỏ để EA ghi xong)
                time.sleep(0.1)
                try:
                    df = pd.read_csv(res_file)
                    if df.empty:
                        return pd.DataFrame()
                    df['datetime'] = pd.to_datetime(df['time'], unit='s')
                    df['value'] = df['tick_volume']
                    return df
                except:
                    pass
            time.sleep(0.1)
            
    print(f"MQL5 DataServer timeout for {symbol}.")
    return pd.DataFrame()

_cached_usdx_symbol = None
_usdx_searched = False

def get_historical_data(symbol: str, timeframe: str, count: int = 1000, end_time: int = 0, brokerTimezone: str = "Europe/Athens"):
    is_global = symbol.endswith("_GI") or symbol == "GLOBAL_INDEX"
    
    if is_global:
        if symbol == "GLOBAL_INDEX":
            # Equal-weighted geometric mean (VN30 style) for Global Market vs USD
            df_eur = _fetch_raw_data("EURUSD", timeframe, count, end_time, brokerTimezone)
            df_jpy = _fetch_raw_data("USDJPY", timeframe, count, end_time, brokerTimezone)
            df_gbp = _fetch_raw_data("GBPUSD", timeframe, count, end_time, brokerTimezone)
            df_aud = _fetch_raw_data("AUDUSD", timeframe, count, end_time, brokerTimezone)
            df_nzd = _fetch_raw_data("NZDUSD", timeframe, count, end_time, brokerTimezone)
            
            if df_eur is not None and not df_eur.empty and df_jpy is not None:
                df = df_eur.copy()
                df['close'] = 100 * ((df_eur['close'] * df_gbp['close'] * df_aud['close'] * df_nzd['close'] / df_jpy['close']) ** 0.2)
                df['open'] = 100 * ((df_eur['open'] * df_gbp['open'] * df_aud['open'] * df_nzd['open'] / df_jpy['open']) ** 0.2)
                df['high'] = 100 * ((df_eur['high'] * df_gbp['high'] * df_aud['high'] * df_nzd['high'] / df_jpy['low']) ** 0.2)
                df['low'] = 100 * ((df_eur['low'] * df_gbp['low'] * df_aud['low'] * df_nzd['low'] / df_jpy['high']) ** 0.2)
                df['tick_volume'] = df_eur['tick_volume'] + df_jpy['tick_volume'] + df_gbp['tick_volume'] + df_aud['tick_volume'] + df_nzd['tick_volume']
                df['value'] = df['tick_volume']
                return df
            return pd.DataFrame()
        else:
            import json
            import numpy as np
            config_path = os.path.join(os.path.dirname(__file__), "app_configs.json")
            try:
                with open(config_path, "r") as f:
                    config = json.load(f)
            except:
                return pd.DataFrame()
                
            group_map = {
                "US_STOCKS_GI": "us_stocks",
                "COMMODITIES_GI": "commodities",
                "CRYPTO_GI": "crypto"
            }
            group_key = group_map.get(symbol)
            if not group_key: return pd.DataFrame()
            
            symbols = config.get("matrix_groups", {}).get(group_key, [])
            if not symbols: return pd.DataFrame()
            
            dfs = []
            for sym in symbols:
                df_sym = _fetch_raw_data(sym, timeframe, count, end_time, brokerTimezone)
                if df_sym is not None and not df_sym.empty:
                    df_sym = df_sym.set_index('time')[['open', 'high', 'low', 'close', 'tick_volume', 'datetime']]
                    dfs.append(df_sym)
            
            if not dfs: return pd.DataFrame()
            
            df_merged = dfs[0].copy()
            for i in range(1, len(dfs)):
                df_merged = df_merged.join(dfs[i], lsuffix='', rsuffix=f'_{i}', how='inner')
                
            if df_merged.empty: return pd.DataFrame()
            
            # Geometric mean calculation
            N = len(dfs)
            close_cols = ['close'] + [f'close_{i}' for i in range(1, N)]
            open_cols = ['open'] + [f'open_{i}' for i in range(1, N)]
            high_cols = ['high'] + [f'high_{i}' for i in range(1, N)]
            low_cols = ['low'] + [f'low_{i}' for i in range(1, N)]
            vol_cols = ['tick_volume'] + [f'tick_volume_{i}' for i in range(1, N)]
            
            df_res = pd.DataFrame(index=df_merged.index)
            df_res['datetime'] = df_merged['datetime']
            df_res['time'] = df_merged.index
            
            # Use np.exp(np.mean(np.log(X))) for geometric mean to avoid overflow
            df_res['close'] = np.exp(np.mean(np.log(df_merged[close_cols].values), axis=1))
            df_res['open'] = np.exp(np.mean(np.log(df_merged[open_cols].values), axis=1))
            df_res['high'] = np.exp(np.mean(np.log(df_merged[high_cols].values), axis=1))
            df_res['low'] = np.exp(np.mean(np.log(df_merged[low_cols].values), axis=1))
            df_res['tick_volume'] = df_merged[vol_cols].sum(axis=1)
            df_res['value'] = df_res['tick_volume']
            
            return df_res.reset_index(drop=True)
            
    # Xử lý các mã bình thường
    df = _fetch_raw_data(symbol, timeframe, count, end_time, brokerTimezone)
    if df is not None:
        return df
    return pd.DataFrame()