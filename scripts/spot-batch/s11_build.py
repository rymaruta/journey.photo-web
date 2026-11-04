"""段11: 確かめ終えた行を台帳の形にして content/spots.json の末尾に足す（既存の行は1バイトも変えない）。

  python3 scripts/spot-batch/s11_build.py out/A.json out/B.json …
- content/spots.json は毎回 origin/develop の版に戻してから足す（何度流しても同じ結果）
- spotId は Q番号ごとに ids.json に覚える（流し直しても変わらない）
- drops.json（slug → 理由）の行は足さない
- 座標: Wikidata が小数2桁以下か記事の座標と 1km 以上ずれる・行に coordsDoubt → 記事の座標。小数2桁に丸める
- 公式サイトは sites.json で ok のものだけ
- aiCheck.delegatedBy は委任した owner の名前（AI の名前は書けない・spotsLedger.test.ts）
"""
import datetime
import json
import math
import os
import secrets
import subprocess
import sys
import urllib.parse

from batchlib import CONTENT, PG, load, save, work_dir

DELEGATED_BY = os.environ.get("SPOT_DELEGATED_BY", "rymaruta")  # owner の委任（2026-09-26・#410）
work_dir()
SPOTS = os.path.join(CONTENT, "spots.json")
arts = load("articles.json")
sites = load("sites.json", {})
wp = load("wpcoords.json", {})
drop = load("drops.json", {})


def _dec(x):
    s = repr(x)
    return len(s.split(".")[1]) if "." in s else 0


def coords_for(a, doubt=False):
    c = a["cand"]
    w = wp.get(a["title"])
    if w and doubt:
        return w["lat"], w["lng"]
    if w:
        d = math.hypot((w["lng"] - c["lng"]) * 111 * math.cos(math.radians(c["lat"])), (w["lat"] - c["lat"]) * 111)
        if min(_dec(c["lat"]), _dec(c["lng"])) <= 2 or d > 1:
            return w["lat"], w["lng"]
    return c["lat"], c["lng"]


rows = [r for f in sys.argv[1:] for r in load(f)["rows"] if r["slug"] not in drop]
if not rows:
    raise SystemExit("行が無い（out/<組>.json を渡す）")
subprocess.run(["git", "-C", PG, "checkout", "origin/develop", "--", "content/spots.json"], check=True)
IDS = load("ids.json", {})
jst = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
today = jst.strftime("%Y-%m-%d")
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
new = []
for r in rows:
    a = arts[r["qid"]]
    src = [{"url": "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(a["title"].replace(" ", "_")), "title": f"Wikipedia「{a['title']}」"},
           {"url": f"https://www.wikidata.org/wiki/{r['qid']}", "title": f"Wikidata「{r['qid']}」（座標・所在地）"}]
    IDS.setdefault(r["qid"], "sp_" + secrets.token_hex(6))
    lat, lng = coords_for(a, r.get("coordsDoubt", False))
    e = {"spotId": IDS[r["qid"]], "slug": r["slug"], "name": r["name"], "nameEn": r["nameEn"], "reading": r["reading"],
         "aliases": r.get("aliases", []), "address": r["address"], "region": r["region"],
         "coords": {"lat": round(lat, 2), "lng": round(lng, 2)},
         "category": r["category"], "summary": r["summary"], "description": r["description"], "highlights": r["highlights"],
         "seasonalGuide": r["seasonalGuide"], "timeOfDayGuide": r["timeOfDayGuide"], "compositionTips": r["compositionTips"]}
    u = r.get("officialWebsiteUrl")
    if u and sites.get(u, {}).get("ok") and u.startswith("https://"):
        e["officialWebsiteUrl"] = u
        pt = sites[u].get("title") or ""
        core = r["name"].split(" ")[-1]
        src.append({"url": u, "title": f"公式サイト「{pt if core[:2] in pt else r['name']}」"})
    e.update({"status": "published", "draftedAt": today, "draftedBy": "claude", "createdAt": f"{today}T00:00:00.000Z", "updatedAt": now,
              "aiCheck": {"checkedAt": today, "delegatedBy": DELEGATED_BY, "sources": src, "imageChecked": False}})
    new.append(e)
t = open(SPOTS, encoding="utf-8").read().rstrip()
assert t.endswith("]")
body = t[:-1].rstrip()
add = ",\n".join("\n".join("  " + line for line in json.dumps(e, ensure_ascii=False, indent=2).split("\n")) for e in new)
with open(SPOTS, "w", encoding="utf-8") as f:
    f.write(body + ",\n" + add + "\n]\n")
save("ids.json", IDS, indent=0)
with open("new_ids.txt", "w") as f:
    f.write("\n".join(e["spotId"] for e in new) + "\n")
print("added", len(new), "・new_ids.txt に spotId を書いた")
