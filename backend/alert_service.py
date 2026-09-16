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

def get_email_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                return json.load(f)
        except:
            pass
    return None

def send_email(symbol, price, note, direction):
    config = get_email_config()
    if not config or not config.get('emailSender') or not config.get('emailPassword'):
        return False
        
    sender_email = config['emailSender']
    sender_password = config['emailPassword']
    receiver_email = config['emailReceiver']
    
    try:
        msg = MIMEMultipart()
        msg['From'] = sender_email
        msg['To'] = receiver_email
        msg['Subject'] = f"🚨 Cảnh báo giá: {symbol} {direction} {price}"
        
        html = f"""
        <html>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #d9534f;">🚨 Cảnh báo kích hoạt!</h2>
                <p>Mã giao dịch: <strong>{symbol}</strong></p>
                <p>Trạng thái: <strong>{direction}</strong> mức giá <strong>{price}</strong></p>
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
                
            symbols = list(set([a["symbol"] for a in active_alerts]))
            ticks = {}
            for sym in symbols:
                # MT5 service get_tick is synchronous
                tick = await asyncio.to_thread(get_tick, sym)
                if tick:
                    ticks[sym] = tick
                    
            triggered_any = False
            
            for alert in active_alerts:
                sym = alert["symbol"]
                if sym not in ticks:
                    continue
                
                # Bi price format
                current_price = ticks[sym].get("bid") or ticks[sym].get("last")
                if not current_price: continue
                
                alert_id = str(alert["id"])
                prev_price = alert_prev_prices.get(alert_id)
                target_price = alert["price"]
                
                if prev_price is not None:
                    # Check crossover
                    direction = ""
                    if prev_price < target_price and current_price >= target_price:
                        direction = "Vượt lên trên"
                    elif prev_price > target_price and current_price <= target_price:
                        direction = "Cắt xuống dưới"
                        
                    if direction:
                        # Triggered
                        alert["status"] = "triggered"
                        triggered_any = True
                        print(f"Alert Triggered for {sym} at {current_price} ({direction})")
                        
                        # Background email
                        asyncio.create_task(asyncio.to_thread(send_email, sym, target_price, alert.get("note", ""), direction))
                
                alert_prev_prices[alert_id] = current_price
                
            if triggered_any:
                save_alerts()
                
        except Exception as e:
            print("Alert worker error:", e)
            
        await asyncio.sleep(2)
