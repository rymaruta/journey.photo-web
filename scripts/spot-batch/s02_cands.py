"""段2: 県ごとに Wikidata の SPARQL を1本ずつ流して候補を取る（2秒に1回・1本だけ）。

  python3 scripts/spot-batch/s02_cands.py --prefs 長野県,香川県,…
  python3 scripts/spot-batch/s02_cands.py --lowest 19     # 公開の少ない順に 19 県
途中で止まっても、取れた県は cands_raw.json に残り、続きから走る。
"""
import argparse
import os

from batchlib import STATE, load, save, sparql, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("--prefs")
ap.add_argument("--lowest", type=int)
a = ap.parse_args()
work_dir()
prefs = load(os.path.join(STATE, "prefectures.json"))
if a.prefs:
    targets = a.prefs.split(",")
elif a.lowest:
    pub = load("published_by_pref.json")
    targets = sorted(prefs, key=lambda p: pub.get(p, 0))[: a.lowest]
else:
    raise SystemExit("--prefs か --lowest を渡す")
bad = [p for p in targets if p not in prefs]
if bad:
    raise SystemExit(f"県の名前が違う: {bad}")
save("target_prefs.json", targets)
out = load("cands_raw.json", {})
for p in targets:
    if p in out:
        continue
    q = f'''SELECT ?item ?title ?coord ?n (GROUP_CONCAT(DISTINCT ?tl;separator="|") AS ?types) (SAMPLE(?web) AS ?site) WHERE {{
      ?item wdt:P131+ wd:{prefs[p]} ; wdt:P625 ?coord ; wikibase:sitelinks ?n .
      FILTER(?n >= 3)
      ?a schema:about ?item; schema:isPartOf <https://ja.wikipedia.org/>; schema:name ?title .
      FILTER NOT EXISTS {{ ?item wdt:P576 ?d }}
      OPTIONAL {{ ?item wdt:P31 ?t . ?t rdfs:label ?tl FILTER(lang(?tl)="ja") }}
      OPTIONAL {{ ?item wdt:P856 ?web }}
    }} GROUP BY ?item ?title ?coord ?n'''
    r = sparql(q)
    out[p] = [{"qid": b["item"]["value"].split("/")[-1], "title": b["title"]["value"], "coord": b["coord"]["value"],
               "n": int(b["n"]["value"]), "types": b.get("types", {}).get("value", ""), "site": b.get("site", {}).get("value")} for b in r]
    print(p, len(out[p]), flush=True)
    save("cands_raw.json", out, indent=None)
print("done", len(out))
