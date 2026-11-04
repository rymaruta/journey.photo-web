"""段20: この束で見た候補（書いた・見送った）の Q番号を state/seen-qids.json に足す。束の文章のコミットに含める。
次の束の s03 が、もう一度同じ候補を担当に渡さないため。保留にした行は state/held.json に足す。

  python3 scripts/spot-batch/s20_record_seen.py [--held slug1,slug2 --reason "保留の理由"]
"""
import argparse
import os

from batchlib import STATE, load, out_files, save, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("--held", default="")
ap.add_argument("--reason", default="")
a = ap.parse_args()
work_dir()
seen = set(load(os.path.join(STATE, "seen-qids.json")))
before = len(seen)
seen |= set(load("articles.json"))
save(os.path.join(STATE, "seen-qids.json"), sorted(seen), indent=0)
held = load(os.path.join(STATE, "held.json"), [])
if a.held:
    rows = {r["slug"]: r for f in out_files() for r in load(f)["rows"]}
    for s in a.held.split(","):
        held.append({"slug": s, "qid": rows[s]["qid"], "name": rows[s]["name"], "reason": a.reason, "row": rows[s]})
    save(os.path.join(STATE, "held.json"), held)
print("見た候補", before, "→", len(seen), "・保留", len(held))
