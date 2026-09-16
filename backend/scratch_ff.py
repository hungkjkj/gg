import urllib.request
import re
import json

url = 'https://www.forexfactory.com/calendar?week=this'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
html = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', errors='ignore')

event_jsons = re.findall(r'\{"id":\d+[^{}]{50,500}"dateline":\d+[^{}]*\}', html)
for ej_str in event_jsons:
    try:
        obj = json.loads(ej_str)
        print(obj.get('name'), obj.get('dateline'))
    except Exception as e:
        pass

match = re.search(r'data-timezone="([^"]+)"', html)
if match:
    print("Timezone:", match.group(1))
else:
    print("No timezone found in data-timezone")
