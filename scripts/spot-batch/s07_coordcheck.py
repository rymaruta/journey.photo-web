"""段7: 記事の座標（prop=coordinates・主座標）を 50 題ずつまとめて聞く → wpcoords.json。

  python3 scripts/spot-batch/s07_coordcheck.py
s05 が終わってから流す（同じ API を2本で叩かない）。
"""
import batchlib
from batchlib import load, save, wiki_api, work_dir

work_dir()
a = load("articles.json")
titles = sorted({v["title"] for v in a.values() if v.get("title")})
res = load("wpcoords.json", {})
todo = [t for t in titles if t not in res]
for i in range(0, len(todo), 50):
    d = wiki_api({"action": "query", "prop": "coordinates", "coprimary": "primary", "colimit": "max", "titles": "|".join(todo[i:i + 50])})
    for p in d["query"]["pages"]:
        c = (p.get("coordinates") or [None])[0]
        res[p["title"]] = c and {"lat": c["lat"], "lng": c["lon"]}
save("wpcoords.json", res, indent=0)
print("coords", len(res), "記事に座標なし", sum(1 for x in res.values() if not x), batchlib.STATS)
