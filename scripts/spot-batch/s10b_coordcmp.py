"""段10b: 行の座標（Wikidata）と記事の座標を突き合わせる。表に出た行は、build が記事の座標を使う
（Wikidata が小数2桁以下か 1km 以上ずれるとき）。記事に座標が無く Wikidata も粗い行は見送る。
確かめ役が疑った行は、行に "coordsDoubt": true を付けると build が記事の座標を使う。

  python3 scripts/spot-batch/s10b_coordcmp.py out/A.json out/B.json …
"""
import json, math, sys
from batchlib import work_dir
work_dir()
a=json.load(open('articles.json')); wp=json.load(open('wpcoords.json'))
AREA={'島','湖沼','渓谷','海岸','高原','湿原','公園','町並み','温泉','山岳','岬','棚田','史跡','城跡'}
def km(a1,b1,a2,b2): return math.hypot((b2-b1)*111*math.cos(math.radians((a1+a2)/2)),(a2-a1)*111)
def dec(x): s=repr(x); return len(s.split('.')[1]) if '.' in s else 0
for f in sys.argv[1:]:
    for r in json.load(open(f))['rows']:
        c=a[r['qid']]['cand']; w=wp.get(a[r['qid']]['title'])
        coarse=min(dec(c['lat']),dec(c['lng']))<=2
        if not w: print(f'{f} {r["slug"]}: 記事に座標なし wd=({c["lat"]},{c["lng"]}) coarse={coarse}'); continue
        d=km(c['lat'],c['lng'],w['lat'],w['lng']); lim=5 if r['category'] in AREA else 2
        if d>1 or coarse: print(f'{f} {r["slug"]} [{r["category"]}]: wd=({c["lat"]},{c["lng"]}) wp=({w["lat"]:.4f},{w["lng"]:.4f}) {d:.2f}km {"NG" if d>lim else ""} coarse={coarse}')
