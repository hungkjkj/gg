import urllib.request
import re
import json
import datetime
import time

url = 'https://www.forexfactory.com/calendar?week=this'
req = urllib.request.Request(url, headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Cookie': 'fftimezoneoffset=0; ff_timezone=0;'
})
html = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', errors='ignore')

# Check timezone in html
tz_match = re.search(r'"timezone"\s*:\s*\{[^}]*"offset"\s*:\s*(-?\d+)', html)
if tz_match:
    vpn_offset_seconds = int(tz_match.group(1))
    print(f"Server VPN offset found in HTML: {vpn_offset_seconds} seconds")
else:
    print("No VPN offset found in HTML")
    
# Extract events
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

# Print FOMC or top 5 events
printed = 0
for eid, obj in events_by_id.items():
    if "FOMC" in obj.get('name', ''):
        dt = datetime.datetime.fromtimestamp(obj['dateline'], datetime.timezone.utc)
        print(f"FOMC Event: {obj['name']}")
        print(f"Dateline (Epoch): {obj['dateline']}")
        print(f"UTC Datetime: {dt}")
        printed += 1
if printed == 0:
    for eid, obj in list(events_by_id.items())[:5]:
        dt = datetime.datetime.fromtimestamp(obj['dateline'], datetime.timezone.utc)
        print(f"Event: {obj['name']}")
        print(f"Dateline (Epoch): {obj['dateline']}")
        print(f"UTC Datetime: {dt}")
