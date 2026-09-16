import MetaTrader5 as mt5
import pandas as pd
from datetime import datetime

# Cấu hình để pandas hiển thị hết các cột
pd.set_option('display.max_columns', 500)
pd.set_option('display.width', 1500)

def get_mt5_data(symbol, timeframe, num_candles):
    # Thông tin đăng nhập (Lấy từ ảnh của bạn)
    LOGIN = 1715557955
    PASSWORD = "L1GqemlcsG#YB"
    SERVER = "OANDA_Global-Demo-1"
    
    # Thiết lập kết nối với phần mềm MetaTrader 5
    mt5_path = r"D:\zenmini\terminal64.exe"
    
    # Cố gắng khởi tạo và đăng nhập
    if not mt5.initialize(path=mt5_path, login=LOGIN, password=PASSWORD, server=SERVER, portable=True):
        print("Failed to initialize or login to MT5. Make sure the MT5 terminal is running and credentials are correct.")
        print("Error:", mt5.last_error())
        return None

    # Lấy dữ liệu OHLCV
    print(f"Fetching data for {symbol}...")
    
    # Lấy `num_candles` nến tính từ thời điểm hiện tại (0) về quá khứ
    rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, num_candles)

    # Đóng kết nối với MT5 sau khi lấy xong dữ liệu
    mt5.shutdown()

    if rates is None:
        print(f"Failed to fetch data for {symbol}. (Check if the symbol exists in Market Watch)")
        return None

    # Tạo DataFrame từ dữ liệu thu được
    df = pd.DataFrame(rates)
    
    # Chuyển đổi thời gian dạng timestamp (giây) sang datetime để dễ đọc
    df['time'] = pd.to_datetime(df['time'], unit='s')
    
    return df

if __name__ == "__main__":
    # Ví dụ: Lấy 10 cây nến H1 của cặp EURUSD
    # Lưu ý: Sửa tên cặp tiền này theo đúng định dạng tên cặp trên MT5 của Oanda (VD: EUR_USD, EURUSD...)
    SYMBOL = "EURUSD"
    
    # Các khung thời gian hỗ trợ: mt5.TIMEFRAME_M1, mt5.TIMEFRAME_H1, mt5.TIMEFRAME_D1, v.v.
    TIMEFRAME = mt5.TIMEFRAME_H1
    NUM_CANDLES = 10

    df_data = get_mt5_data(SYMBOL, TIMEFRAME, NUM_CANDLES)
    
    if df_data is not None:
        print("\nData fetched successfully:")
        print(df_data)
