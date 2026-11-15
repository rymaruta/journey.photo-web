"""濃くする束 段4: 検査を通した説明を台帳の行へ入れる（対象の行のテキストだけを差し替える）。

  SPOT_BATCH_DIR=… python3 scripts/spot-batch/e04_apply.py [--ledger content/spots.json] out/A.json …

- 台帳（JSON の配列）の各行の位置を取り、**変える行のテキストだけ**を差し替える（他の行は1バイトも変えない）
- 変える項目: description・highlights（・summary が書かれていれば）・updatedAt・aiCheck（読んだ公式サイトの頁を sources に足し、checkedAt を今日に）
- 変えない項目: slug・name・region・座標・分類・季節と時間帯の案内・撮り方・公式サイト ほか
- 控え: state/enriched.json に slug・日付・使った出典を残す（次の選定で除く）
"""
import argparse
import datetime
import json
import os
import sys

from batchlib import CONTENT, STATE, load, save, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("--ledger", default=os.path.join(CONTENT, "spots.json"))
ap.add_argument("files", nargs="+")
a = ap.parse_args()
work_dir()
mats = load("materials.json")
today = min(datetime.date.today(), datetime.datetime.now(datetime.timezone.utc).date()).isoformat()
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
new = {}
for f in a.files:
    for r in load(f).get("rows", []):
        new[r["slug"]] = r

text = open(a.ledger, encoding="utf-8").read()
dec = json.JSONDecoder()
i = text.index("[") + 1
spans = []
while True:
    while text[i] in " \n\r\t,":
        i += 1
    if text[i] == "]":
        break
    obj, end = dec.raw_decode(text, i)
    spans.append((i, end, obj))
    i = end
out, last, changed, rec = [], 0, 0, []
for s, e, obj in spans:
    r = new.get(obj.get("slug"))
    if not r:
        continue
    m = mats[obj["slug"]]
    obj["description"] = r["description"]
    obj["highlights"] = r["highlights"]
    if r.get("summary"):
        obj["summary"] = r["summary"]
    obj["updatedAt"] = now
    ai = obj.get("aiCheck") or {}
    srcs = list(ai.get("sources", []))
    have = {x["url"] for x in srcs}
    for p in m.get("official", []):
        if p["url"] in have or not any(ev["src"].startswith("o") and ev["src"] == f"o{m['official'].index(p) + 1}" for c in r["claims"] for ev in c["evidence"]):
            continue
        srcs.append({"url": p["url"], "title": f"公式サイト「{(p['title'] or obj['name']).split('|')[0].split('｜')[0].strip()[:40]}」"})
        have.add(p["url"])
    ai["sources"] = srcs
    ai["checkedAt"] = today
    obj["aiCheck"] = ai
    block = json.dumps(obj, ensure_ascii=False, indent=2).replace("\n", "\n  ")
    out.append((s, e, block))
    changed += 1
    rec.append({"slug": obj["slug"], "date": today, "sources": [x["url"] for x in srcs]})
res, pos = [], 0
for s, e, block in out:
    res.append(text[pos:s])
    res.append(block)
    pos = e
res.append(text[pos:])
open(a.ledger, "w", encoding="utf-8").write("".join(res))
done = load(os.path.join(STATE, "enriched.json"), [])
seen = {d["slug"] for d in done}
done += [x for x in rec if x["slug"] not in seen]
save(os.path.join(STATE, "enriched.json"), done)
print("書き換えた行", changed, "・控え", len(done))
if changed != len(new):
    print("⚠️ 台帳に無い slug:", sorted(set(new) - {o['slug'] for _, _, o in spans}))
    sys.exit(1)
