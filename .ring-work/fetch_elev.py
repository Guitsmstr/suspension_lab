"""Fetch SRTM elevation (open-meteo) for the Nordschleife trace, resumable."""
import json, urllib.request, time, os

WORK = '/Users/guits/Documents/temp/.ring-work'
coords = json.load(open(f'{WORK}/touristenfahrten.geojson'))['features'][0]['geometry']['coordinates']
n = len(coords)
B = 60
SLEEP = 2.5
state_path = f'{WORK}/elev-state.json'
if os.path.exists(state_path):
    st = json.load(open(state_path))
    elev = st['elev']
    print(f'resume: {sum(1 for e in elev if e is not None)}/{n}')
else:
    elev = [None] * n

def fetch(s, e):
    batch = coords[s:e]
    lats = ','.join(str(c[1]) for c in batch)
    lons = ','.join(str(c[0]) for c in batch)
    url = 'https://api.open-meteo.com/v1/elevation?latitude=' + lats + '&longitude=' + lons
    for attempt in range(6):
        try:
            with urllib.request.urlopen(
                urllib.request.Request(url, headers={'User-Agent': 'SuspensionLab/1.0'}), timeout=40
            ) as r:
                j = json.load(r)
            assert 'elevation' in j and len(j['elevation']) == len(batch), str(j)[:200]
            return j['elevation']
        except Exception as ex:
            print(f'retry {s} attempt {attempt}: {ex}', flush=True)
            time.sleep(4 + attempt * 4)
    raise SystemExit(f'FAILED at {s}')

s = 0
while s < n:
    if elev[s] is not None:
        s += B
        continue
    e = min(s + B, n)
    elev[s:e] = fetch(s, e)
    json.dump({'elev': elev}, open(state_path, 'w'))
    print(f'{e}/{n}', flush=True)
    s = e
    time.sleep(SLEEP)

json.dump({'coords': coords, 'elevation': elev}, open(f'{WORK}/ring-raw.json', 'w'))
print('done. elev min/max:', min(elev), max(elev))
