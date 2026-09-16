import pandas as pd
import numpy as np

df = pd.DataFrame({'time': [1704153600, 1704157200]})
broker_naive = pd.to_datetime(df['time'], unit='s')
broker_aware = broker_naive.dt.tz_localize('Europe/Athens', nonexistent='shift_forward', ambiguous='NaT')
utc_aware = broker_aware.dt.tz_convert('UTC')

utc_epoch2 = (utc_aware - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta('1s')
print("Method 2:", utc_epoch2.tolist())
