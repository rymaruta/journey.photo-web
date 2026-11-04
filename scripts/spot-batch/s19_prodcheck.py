"""段19: 本番に出たあと、本番で確かめる（Deploy Site が成功してから流す）。

  python3 scripts/spot-batch/s19_prodcheck.py
- アプリ向けの JSON（/app/data/spot-feed/）の国内の行数と、新しい行が全部載っているか
- 新しいスポットのページが 200 で、名前が本文にあるか（最初の5件）
"""
import json
import os
import subprocess

from batchlib import CONTENT, load, work_dir

SITE = "https://journey-photo.com"
work_dir()


def get(u):
    r = subprocess.run(["curl", "-sS", "-w", "\n%{http_code}", u], capture_output=True, text=True)
    b, _, c = r.stdout.rpartition("\n")
    return c, b


ids = set(open("new_ids.txt").read().split())
L = load(os.path.join(CONTENT, "spots.json"))
new = {e["spotId"]: e for e in L if e["spotId"] in ids}
c, b = get(f"{SITE}/app/data/spot-feed/index.json")
idx = json.loads(b)
sh = idx["shards"]
keys = [s["key"] if isinstance(s, dict) else s for s in (sh if isinstance(sh, list) else sh.keys())]
found, jp = set(), 0
for k in keys:
    if not str(k).startswith("jp"):
        continue
    c, b = get(f"{SITE}/app/data/spot-feed/{k}.json")
    d = json.loads(b)
    rows = d["spots"] if isinstance(d, dict) and "spots" in d else d
    jp += len(rows)
    found |= {r.get("spotId") for r in rows}
print("本番の国内の行", jp, "・新しい行が載っている", len(found & set(new)), "/", len(new))
for e in list(new.values())[:5]:
    c, b = get(f"{SITE}/spots/{e['slug']}/")
    print(e["slug"], c, "名前あり" if e["name"] in b else "名前なし")
