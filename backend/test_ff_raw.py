import urllib.request
import re
import json

url = 'https://www.forexfactory.com/calendar?week=this'
req = urllib.request.Request(url, headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Cookie': 'fftimezoneoffset=0; ff_timezone=0;'
})
html = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', errors='ignore')

event_jsons = re.findall(r'\{"id":\d+[^{}]{50,500}"dateline":\d+[^{}]*\}', html)
for ej_str in event_jsons:
    if "FOMC" in ej_str:
        obj = json.loads(ej_str)
        print("Raw FF Dateline:", obj.get("dateline"))
