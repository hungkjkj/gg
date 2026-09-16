import requests
import json
import time

try:
    res = requests.get('http://localhost:8000/api/v1/news', params={'symbol': 'USD'})
    data = res.json()
    for ev in data.get('data', []):
        if 'FOMC' in ev.get('title', ''):
            print(f"Title: {ev['title']}")
            print(f"Time (Epoch): {ev['time']}")
            from datetime import datetime, timezone
            print(f"UTC Datetime: {datetime.fromtimestamp(ev['time'], timezone.utc)}")
            print("-" * 30)
            break
except Exception as e:
    print(e)
