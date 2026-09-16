import urllib.request
from bs4 import BeautifulSoup
import dateutil.parser
import datetime
import re
import time
import json
import os

CACHE_FILE = "news_cache.json"

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {"data": [], "last_fetch": 0}

def save_cache(cache):
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
    except:
        pass

HISTORY_CACHE_FILE = "news_history_cache.json"

def load_history_cache():
    if os.path.exists(HISTORY_CACHE_FILE):
        try:
            with open(HISTORY_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {}

def save_history_cache(cache):
    try:
        with open(HISTORY_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
    except:
        pass

HISTORY_CACHE = load_history_cache()
NEWS_CACHE = load_cache()

def _parse_year_from_week(week):
    """Trích xuất năm từ chuỗi week, ví dụ: 'dec2.2024' -> 2024"""
    m = re.search(r'\.(\d{4})$', str(week))
    if m:
        return int(m.group(1))
    return datetime.datetime.now().year

def scrape_ff_week(week='this'):
    url = f'https://www.forexfactory.com/calendar?week={week}'
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': 'fftimezoneoffset=0; ff_timezone=0;'
    })
    try:
        html = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"Scrape error for week={week}: {e}")
        return []
        
    # Calculate local system timezone offset to UTC (removed)
    
        
    soup = BeautifulSoup(html, 'html.parser')
    
    # Step 1: Extract event JSON data (contains UTC timestamps as 'dateline')
    events_by_id = {}
    event_jsons = re.findall(r'\{"id":\d+[^{}]{50,500}"dateline":\d+[^{}]*\}', html)
    for ej_str in event_jsons:
        try:
            obj = json.loads(ej_str)
            eid = obj.get('id')
            if eid:
                events_by_id[str(eid)] = obj
        except:
            pass
    
    # Step 2: Parse HTML rows for visual data (impact, actual, forecast, previous)
    events = []
    rows = soup.find_all('tr', class_='calendar__row')
    
    for row in rows:
        if 'calendar__row--day-breaker' in row.get('class', []):
            continue
        
        event_id = row.get('data-event-id', '')
        if not event_id or event_id not in events_by_id:
            continue
        
        json_data = events_by_id[event_id]
        currency = json_data.get('currency', '')
        title = json_data.get('name', '')
        dateline = json_data.get('dateline', 0)
        
        if not currency or not title or not dateline:
            continue
            
        impact_td = row.find('td', class_='calendar__impact')
        impact = "Low"
        if impact_td and impact_td.find('span'):
            cls = impact_td.find('span').get('class', [])
            if 'icon--ff-impact-red' in cls:
                impact = "High"
            elif 'icon--ff-impact-ora' in cls:
                impact = "Medium"
            elif 'icon--ff-impact-yel' in cls:
                impact = "Low"
            elif 'icon--ff-impact-gra' in cls:
                impact = "Holiday"
                
        actual_td = row.find('td', class_='calendar__actual')
        actual = actual_td.text.strip() if actual_td else ""
        eval_str = "None"
        if actual_td and actual_td.find('span'):
            cls = actual_td.find('span').get('class', [])
            if 'better' in cls: eval_str = 'Positive'
            elif 'worse' in cls: eval_str = 'Negative'
            else: eval_str = 'Neutral' if actual else "None"
            
        forecast_td = row.find('td', class_='calendar__forecast')
        forecast = forecast_td.text.strip() if forecast_td else ""
        
        previous_td = row.find('td', class_='calendar__previous')
        previous = previous_td.text.strip() if previous_td else ""
        
        # Dateline is always an absolute UTC Epoch regardless of timezone
        true_utc = dateline
        
        events.append({
            "title": title,
            "country": currency,
            "impact": impact,
            "time": true_utc,
            "forecast": forecast,
            "actual": actual,
            "previous": previous,
            "evaluation": eval_str,
            "tz_offset": 0
        })
                
    return events

def _timestamp_to_ff_week(timestamp):
    """Chuyển timestamp Unix thành chuỗi week cho ForexFactory, ví dụ: 'dec2.2024'
    ForexFactory dùng ngày thứ Hai đầu tuần làm mốc."""
    dt = datetime.datetime.fromtimestamp(timestamp)
    # Lùi về thứ Hai đầu tuần
    monday = dt - datetime.timedelta(days=dt.weekday())
    month_abbr = monday.strftime('%b').lower()
    return f"{month_abbr}{monday.day}.{monday.year}"

def get_backtest_news(timestamp):
    """Lấy tin tức lịch sử cho một thời điểm backtest cụ thể và tuần tiếp theo.
    Cache vĩnh viễn vì dữ liệu quá khứ không thay đổi."""
    global HISTORY_CACHE
    
    all_events = []
    
    # Tính tuần hiện tại và tuần tiếp theo
    timestamps = [timestamp, timestamp + 7 * 86400]
    
    for ts in timestamps:
        week_str = _timestamp_to_ff_week(ts)
        
        # Kiểm tra cache
        if week_str in HISTORY_CACHE and len(HISTORY_CACHE[week_str]) > 0:
            all_events.extend(HISTORY_CACHE[week_str])
        else:
            # Chưa có -> cào từ ForexFactory
            print(f"Fetching historical news for backtest week: {week_str}")
            week_events = scrape_ff_week(week_str)
            
            if len(week_events) > 0:
                HISTORY_CACHE[week_str] = week_events
                save_history_cache(HISTORY_CACHE)
                all_events.extend(week_events)
                
    return all_events

def fetch_ff_calendar():
    global NEWS_CACHE
    current_time = time.time()
    
    needs_update = False
    
    if len(NEWS_CACHE["data"]) == 0:
        needs_update = True
    else:
        # Kiểm tra xem có tin nào đã qua giờ, chưa có actual, và chưa được check
        for ev in NEWS_CACHE["data"]:
            if ev["time"] < current_time and ev["impact"] != "Holiday":
                if not ev.get("actual") and not ev.get("checked"):
                    needs_update = True
                    break
                        
    if not needs_update:
        return NEWS_CACHE["data"]
        
    print("Fetching new Catalyst data from ForexFactory...")
    events_this = scrape_ff_week('this')
    events_next = scrape_ff_week('next')
    
    all_events = events_this + events_next
    if len(all_events) > 0:
        # Cào thành công -> đánh dấu checked cho những tin đã qua giờ mà vẫn trống actual
        for ev in all_events:
            if ev["time"] < current_time and not ev.get("actual") and ev["impact"] != "Holiday":
                ev["checked"] = True
                    
        NEWS_CACHE["data"] = all_events
        NEWS_CACHE["last_fetch"] = current_time
        save_cache(NEWS_CACHE)
        return all_events
    
    # Cào thất bại (all_events rỗng) -> KHÔNG đánh dấu checked, lần sau sẽ thử lại
    return NEWS_CACHE["data"]

def get_news_for_symbol(symbol: str):
    events = fetch_ff_calendar()
    if not events:
        return []
        
    currencies = []
    if len(symbol) >= 6:
        currencies = [symbol[0:3].upper(), symbol[3:6].upper()]
    else:
        currencies = [symbol.upper()]
        
    filtered = []
    for ev in events:
        country = ev["country"].upper()
        if country in currencies or (country == "ALL"):
            impact = ev["impact"].strip()
            if impact in ["High", "Medium", "Holiday"]:
                filtered.append(ev.copy())
                
    return filtered

def get_weekly_news():
    events = fetch_ff_calendar()
    return events

