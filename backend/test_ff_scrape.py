import urllib.request
from bs4 import BeautifulSoup
import dateutil.parser
import datetime
import re

def scrape_ff():
    url = 'https://www.forexfactory.com/calendar?week=this'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
    html = urllib.request.urlopen(req).read()
    soup = BeautifulSoup(html, 'html.parser')
    
    events = []
    current_date = None
    current_time = None
    
    rows = soup.find_all('tr', class_='calendar__row')
    for row in rows:
        if 'calendar__row--day-breaker' in row.get('class', []):
            continue
            
        # Parse date
        date_td = row.find('td', class_='calendar__date')
        if date_td and date_td.find('span', class_='date'):
            date_str = date_td.find('span', class_='date').text.strip()
            # e.g., "MonSep 14" -> "Sep 14"
            m = re.search(r'([A-Z][a-z]{2})\s*(\d+)', date_str)
            if m:
                current_date = f"{m.group(1)} {m.group(2)} 2026"
                
        # Parse time
        time_td = row.find('td', class_='calendar__time')
        if time_td and time_td.text.strip():
            t_str = time_td.text.strip()
            if 'All Day' not in t_str and 'Day' not in t_str:
                current_time = t_str
                
        currency_td = row.find('td', class_='calendar__currency')
        if not currency_td:
            continue
        currency = currency_td.text.strip()
        
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
                
        event_td = row.find('td', class_='calendar__event')
        title = event_td.text.strip() if event_td else ""
        
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
        
        if current_date and current_time and currency and title:
            # combine date and time
            dt_str = f"{current_date} {current_time}"
            try:
                # FF timezone is usually EDT (-04:00) unless we send cookies.
                # Without cookies, it defaults to Eastern Time. 
                # EDT is UTC-4. Let's assume EDT for now.
                dt = dateutil.parser.parse(dt_str)
                dt = dt.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=-4)))
                timestamp = int(dt.timestamp())
                
                events.append({
                    "title": title,
                    "country": currency,
                    "impact": impact,
                    "time": timestamp,
                    "forecast": forecast,
                    "actual": actual,
                    "previous": previous,
                    "evaluation": eval_str
                })
            except Exception as e:
                pass
                
    print(f"Parsed {len(events)} events.")
    for e in events[:2]:
        print(e)
        
scrape_ff()
