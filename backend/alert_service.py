import json
import os
import smtplib
import asyncio
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from mt5_service import get_tick

ALERTS_FILE = "alerts.json"
CONFIG_FILE = "app_configs.json"
alerts_data = []

def load_alerts():
    global alerts_data
    if os.path.exists(ALERTS_FILE):
        try:
            with open(ALERTS_FILE, "r") as f:
                alerts_data = json.load(f)
        except:
            alerts_data = []
    else:
        alerts_data = []

def save_alerts():
    global alerts_data
    with open(ALERTS_FILE, "w") as f:
        json.dump(alerts_data, f)

def get_alerts():
    return alerts_data

def add_alert(alert):
    global alerts_data
    alerts_data.append(alert)
    save_alerts()
    return alert

def delete_alert(alert_id):
    global alerts_data
    alerts_data = [a for a in alerts_data if str(a.get("id")) != str(alert_id)]
    save_alerts()

STRATEGIES_FILE = "strategies.json"
strategies_data = []

def load_strategies():
    global strategies_data
    if os.path.exists(STRATEGIES_FILE):
        try:
            with open(STRATEGIES_FILE, "r") as f:
                strategies_data = json.load(f)
        except:
            strategies_data = []
    else:
        strategies_data = []

def save_strategies():
    global strategies_data
    with open(STRATEGIES_FILE, "w") as f:
        json.dump(strategies_data, f)

def get_strategies():
    return strategies_data

def add_strategy(strategy):
    global strategies_data
    strategies_data.append(strategy)
    save_strategies()
    return strategy

def update_strategy(strategy_id, updated_data):
    global strategies_data
    for i, s in enumerate(strategies_data):
        if str(s.get("id")) == str(strategy_id):
            strategies_data[i] = {**s, **updated_data}
            save_strategies()
            return strategies_data[i]
    return None

def delete_strategy(strategy_id):
    global strategies_data
    strategies_data = [s for s in strategies_data if str(s.get("id")) != str(strategy_id)]
    save_strategies()

def get_email_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except:
            pass
    return None

def send_email(symbol, price, note, direction, alert_type="price"):
    config = get_email_config()
    if not config or not config.get('emailSender') or not config.get('emailPassword'):
        return False
        
    sender_email = config['emailSender']
    sender_password = config['emailPassword']
    receiver_email = config['emailReceiver']
    
    val_str = f"{price}%" if alert_type == "mom" else str(price)
    subject_type = "% Mom Flip" if alert_type == "mom" else "giá"
    body_type = "mức % Mom Flip" if alert_type == "mom" else "mức giá"
    
    try:
        msg = MIMEMultipart()
        msg['From'] = sender_email
        msg['To'] = receiver_email
        msg['Subject'] = f"🚨 Cảnh báo {subject_type}: {symbol} {direction} {val_str}"
        
        html = f"""
        <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #d9534f;">🚨 Cảnh báo kích hoạt!</h2>
                <p>Mã giao dịch: <strong>{symbol}</strong></p>
                <p>Loại cảnh báo: <strong>{subject_type}</strong></p>
                <p>Trạng thái: <strong>{direction}</strong> {body_type} <strong>{val_str}</strong></p>
                <p>Ghi chú: {note if note else "Không có"}</p>
                <br/>
                <p><em>Email tự động từ hệ thống Quant Trading Dashboard.</em></p>
            </body>
        </html>
        """
        msg.attach(MIMEText(html, 'html'))
        
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        print("Lỗi gửi email backend:", str(e))
        return False

LATEST_MOM_FLIP_DATA = {}
alert_prev_prices = {}

async def alert_worker():
    print("Started Alert Worker")
    load_alerts()
    while True:
        try:
            active_alerts = [a for a in alerts_data if a.get("status") == "active"]
            if not active_alerts:
                await asyncio.sleep(2)
                continue
                
            symbols = list(set([a["symbol"] for a in active_alerts if a.get("type", "price") == "price"]))
            ticks = {}
            for sym in symbols:
                # MT5 service get_tick is synchronous
                tick = await asyncio.to_thread(get_tick, sym)
                if tick:
                    ticks[sym] = tick
                    
            triggered_any = False
            any_state_changed = False
            
            for alert in active_alerts:
                sym = alert["symbol"]
                alert_type = alert.get("type", "price")
                
                current_value = None
                state_changed = False
                
                if alert_type == "price":
                    if alert.get("bar_close_only"):
                        tf = alert.get("timeframe", "H1")
                        import mt5_service
                        import pandas as pd
                        try:
                            rates = await asyncio.to_thread(mt5_service._fetch_raw_data, sym, tf, 2, 0)
                            if rates is not None and not rates.empty and len(rates) >= 2:
                                current_forming_time = int(rates.iloc[-1]['time']) if 'time' in rates.columns else 0
                                if alert.get("last_forming_time") == current_forming_time:
                                    continue
                                current_value = float(rates.iloc[-2]['close'])
                                alert["last_forming_time"] = current_forming_time
                                any_state_changed = True
                            else:
                                continue
                        except Exception as e:
                            print("Error fetching OHLCV for price bar_close_only alert:", e)
                            continue
                    else:
                        if sym not in ticks:
                            continue
                        current_value = ticks[sym].get("bid") or ticks[sym].get("last")
                elif alert_type == "mom":
                    tf = alert.get("timeframe", "H1")
                    if not tf: tf = "H1"
                    try:
                        import time
                        if not hasattr(alert_worker, "last_mom_fetch"):
                            alert_worker.last_mom_fetch = {}
                        now = time.time()
                        
                        # Cache key for fetching so we don't spam 
                        fetch_key = f"{sym}_{tf}"
                        if now - alert_worker.last_mom_fetch.get(fetch_key, 0) > 60:
                            import main
                            # Read configs to match chart parameters
                            configs = get_email_config() or {}
                            # Extract kwargs for get_ohlcv
                            kwargs = {
                                'maVolLength': configs.get('maVolLength', 2),
                                'momMaLength': configs.get('momMaLength', 3),
                                'smaMomLength': configs.get('smaMomLength', 10),
                                'momFlipFilterPct': configs.get('momFlipFilterPct', 75.0),
                                'momFlipVolFilterPct': configs.get('momFlipVolFilterPct', 50.0),
                                'volPct1': configs.get('volPct1', 85.0),
                                'volPct2': configs.get('volPct2', 75.0),
                                'volPct3': configs.get('volPct3', 50.0),
                                'volPct4': configs.get('volPct4', 15.0),
                            }
                            # Fetch with small count to be fast and update LATEST_MOM_FLIP_DATA
                            await asyncio.to_thread(main.get_ohlcv, sym, tf, 300, 0, False, **kwargs)
                            alert_worker.last_mom_fetch[fetch_key] = now
                    except Exception as e:
                        print("Error fetching OHLCV for mom alert:", e)
                        
                    data_key = f"{sym}_{tf}"
                    if data_key not in LATEST_MOM_FLIP_DATA:
                        continue
                    mom_data = LATEST_MOM_FLIP_DATA[data_key]
                    if isinstance(mom_data, dict):
                        if alert.get("bar_close_only"):
                            current_forming_time = mom_data.get('time')
                            if alert.get("last_forming_time") == current_forming_time:
                                continue
                            current_value = mom_data.get('prev_value')
                            alert["last_forming_time"] = current_forming_time
                            any_state_changed = True
                        else:
                            current_value = mom_data.get('value')
                    else:
                        current_value = mom_data
                    
                if current_value is None: continue
                
                alert_id = str(alert["id"])
                prev_value = alert_prev_prices.get(alert_id)
                target_value = alert["price"] # Using price field for the target value
                
                if prev_value is not None:
                    # Check crossover
                    direction = ""
                    if prev_value < target_value and current_value >= target_value:
                        direction = "Vượt lên trên"
                    elif prev_value > target_value and current_value <= target_value:
                        direction = "Cắt xuống dưới"
                        
                    if direction:
                        # Triggered
                        alert["status"] = "triggered"
                        triggered_any = True
                        val_str = f"{current_value}%" if alert_type == "mom" else str(current_value)
                        print(f"Alert Triggered for {sym} at {val_str} ({direction})")
                        
                        # Background email
                        asyncio.create_task(asyncio.to_thread(send_email, sym, target_value, alert.get("note", ""), direction, alert_type))
                
                alert_prev_prices[alert_id] = current_value
                
            if triggered_any or any_state_changed:
                save_alerts()
                
        except Exception as e:
            print("Alert worker error:", e)
            
        await asyncio.sleep(2)
