import urllib.request
import json
import dateutil.parser

req = urllib.request.Request(
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    headers={'User-Agent': 'Mozilla/5.0'}
)
data = json.loads(urllib.request.urlopen(req).read().decode('utf-8'))
for e in data:
    if 'Lagarde' in e['title']:
        print(f"Title: {e['title']}")
        print(f"Date: {e['date']}")
        dt = dateutil.parser.isoparse(e["date"])
        print(f"UNIX UTC: {int(dt.timestamp())}")
