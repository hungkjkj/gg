import urllib.request
import json
from bs4 import BeautifulSoup
import re

def fetch_ff_calendar_merged():
    # 1. Fetch JSON
    urls = [
        "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
        "https://nfs.faireconomy.media/ff_calendar_nextweek.json"
    ]
    
    all_events = []
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    all_events.extend(data)
        except Exception as e:
            pass
            
    # 2. Fetch HTML to extract Actual and Evaluation
    html_events = {}
    try:
        url = 'https://www.forexfactory.com/calendar?week=this'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        html = urllib.request.urlopen(req, timeout=10).read()
        soup = BeautifulSoup(html, 'html.parser')
        
        rows = soup.find_all('tr', class_='calendar__row')
        for row in rows:
            if 'calendar__row--day-breaker' in row.get('class', []):
                continue
                
            title_el = row.find('td', class_='calendar__event')
            title = title_el.text.strip() if title_el else ""
            
            currency_td = row.find('td', class_='calendar__currency')
            currency = currency_td.text.strip() if currency_td else ""
            
            actual_td = row.find('td', class_='calendar__actual')
            actual = actual_td.text.strip() if actual_td else ""
            
            eval_str = "None"
            if actual_td and actual_td.find('span'):
                cls = actual_td.find('span').get('class', [])
                if 'better' in cls: eval_str = 'Positive'
                elif 'worse' in cls: eval_str = 'Negative'
                else: eval_str = 'Neutral' if actual else "None"
                
            if title and currency:
                key = f"{title}_{currency}"
                html_events[key] = {
                    "actual": actual,
                    "evaluation": eval_str
                }
    except Exception as e:
        print("HTML scrape error:", e)
        
    # Merge
    import dateutil.parser
    formatted_events = []
    for event in all_events:
        try:
            dt = dateutil.parser.isoparse(event["date"])
            timestamp = int(dt.timestamp())
            
            title = event.get("title", "")
            country = event.get("country", "")
            
            key = f"{title}_{country}"
            
            actual = event.get("actual", "")
            eval_str = "None"
            
            if key in html_events and html_events[key]["actual"]:
                actual = html_events[key]["actual"]
                eval_str = html_events[key]["evaluation"]
                
            formatted_events.append({
                "title": title,
                "country": country,
                "impact": event.get("impact", "Low"),
                "time": timestamp,
                "forecast": event.get("forecast", ""),
                "actual": actual,
                "previous": event.get("previous", ""),
                "evaluation": eval_str
            })
        except Exception as e:
            pass
            
    print(f"Merged {len(formatted_events)} events.")
    return formatted_events

res = fetch_ff_calendar_merged()
for r in res[:10]:
    if r['actual']: print(r)
