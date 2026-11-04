"""段20: この束で見た候補（書いた・見送った）の Q番号を state/seen-qids.json に足す。束の文章のコミットに含める。
次の束の s03 が、もう一度同じ候補を担当に渡さないため。保留にした行は state/held.json に足す。
見送った候補は理由・種類・見直す条件つきで state/skipped.json に足す（書いた候補はそこから消す）。
「見送り」は捨てるのではなく、理由を残して、記事が更新されたら拾い直せるようにする（2026-11-04 owner）。

  python3 scripts/spot-batch/s20_record_seen.py --batch 第6束 [--held slug1,slug2 --reason "保留の理由"]
"""
import argparse
import os

import datetime

from batchlib import STATE, classify_skip, load, out_files, save, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("--batch", required=True, help="束の名前（例: 第6束）")
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
# 見送り: 理由・種類・見直す条件つきで残す。同じ Q番号はこの束の判断で置き換え、書いた候補は消す
raw = load("cands_raw.json", {})
pref = {c["qid"]: p for p, lst in raw.items() for c in lst}
arts = load("articles.json", {})
written = {r["qid"] for f in out_files() for r in load(f)["rows"]}
sk = {r["qid"]: r for r in load(os.path.join(STATE, "skipped.json"), [])}
for q in written:
    sk.pop(q, None)
today = datetime.date.today().isoformat()
n_new = 0
for f in out_files():
    for x in load(f).get("skipped", []):
        kind, revisit = classify_skip(x.get("reason", ""))
        sk[x["qid"]] = {"qid": x["qid"], "title": x.get("title") or arts.get(x["qid"], {}).get("title", ""),
                        "prefecture": pref.get(x["qid"], ""), "batch": a.batch, "decidedAt": today,
                        "kind": kind, "reason": x.get("reason", ""), "revisitWhen": revisit}
        n_new += 1
rows = sorted(sk.values(), key=lambda r: (r["prefecture"], r["title"]))
save(os.path.join(STATE, "skipped.json"), rows)
kinds = {}
for r in rows:
    kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
print("見た候補", before, "→", len(seen), "・保留", len(held), "・見送り", len(rows), "（この束", n_new, "）")
print("見送りの種類:", "・".join(f"{k} {v}" for k, v in sorted(kinds.items(), key=lambda x: -x[1])))
