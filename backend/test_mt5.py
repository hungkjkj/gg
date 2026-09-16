import MetaTrader5 as mt5
import time

def test():
    if not mt5.initialize():
        print("init failed")
        return
        
    symbols = mt5.symbols_get()
    print(f"Total symbols: {len(symbols)}")
    
    candidates = [s for s in symbols if 'GOLD' in s.name.upper() or 'XAUUSD' in s.name.upper()]
    for c in candidates:
        print(f"Checking {c.name}...")
        test_rate = mt5.copy_rates_from_pos(c.name, mt5.TIMEFRAME_M1, 0, 1)
        if test_rate is not None and len(test_rate) > 0:
            candle_time = test_rate[0]['time']
            current_time = time.time()
            diff_days = (current_time - candle_time) / 86400
            print(f"  -> Last candle time: {candle_time} ({diff_days:.1f} days ago)")
        else:
            print("  -> No data")

if __name__ == "__main__":
    test()
