"""段1: 作業用フォルダを用意し、台帳の索引・県ごとの既存スポット・見た候補の控えを作る。

  SPOT_BATCH_DIR=/home/user/spot-batch/b6 python3 scripts/spot-batch/s01_init.py
台帳は origin/develop のものを読む（git fetch origin develop を先に）。
"""
import json
import os
import re
import subprocess

from batchlib import HERE, PG, STATE, load, save, work_dir

work_dir()
for d in ("out", "review", "visual", "ledger_nearby", "thumbs", "prompts"):
    os.makedirs(d, exist_ok=True)
# 担当への指示書は、作業用フォルダと作業ツリーの道を埋めた版を作業用フォルダに置く
for f in os.listdir(os.path.join(HERE, "prompts")):
    with open(os.path.join(HERE, "prompts", f), encoding="utf-8") as src:
        t = src.read().replace("{{DIR}}", os.getcwd()).replace("{{PG}}", PG)
    with open(os.path.join("prompts", f), "w", encoding="utf-8") as dst:
        dst.write(t)


def show(path):
    return json.loads(subprocess.run(["git", "-C", PG, "show", "origin/develop:" + path],
                                     capture_output=True, text=True, check=True).stdout)


spots = show("content/spots.json")
img = show("content/spot-images.json")
save("ledger_base.json", spots, indent=None)

qids = set()


def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "wikidata" and isinstance(v, str) and re.match(r"Q\d+$", v):
                qids.add(v)
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)


walk(img)
for e in spots:
    for src in (e.get("aiCheck") or {}).get("sources", []):
        m = re.search(r"wikidata\.org/wiki/(Q\d+)", src.get("url", ""))
        if m:
            qids.add(m.group(1))


def norm(x):
    return re.sub(r"[\s・（）()「」]", "", x)


names = set()
for e in spots:
    names.add(norm(e["name"]))
    for a in e.get("aliases") or []:
        names.add(norm(a))
pts = [(e["coords"]["lat"], e["coords"]["lng"], e["slug"], e["name"]) for e in spots if e["region"].get("country") == "日本"]
save("ledger_index.json", {"qids": sorted(qids), "names": sorted(names), "pts": pts, "slugs": [e["slug"] for e in spots]}, indent=None)

by = {}
for e in spots:
    if e["region"].get("country") != "日本":
        continue
    by.setdefault(e["region"]["prefecture"], []).append(
        {"slug": e["slug"], "name": e["name"], "aliases": e.get("aliases", []),
         "lat": e["coords"]["lat"], "lng": e["coords"]["lng"], "status": e["status"]})
for p, v in by.items():
    save(f"ledger_nearby/{p}.json", v, indent=None)

# 前の束で見た（書いた・見送った）候補は、もう一度は見ない
# ただし「上限のため見送り（書ける）」は記事に問題が無いので、次の束の候補に戻す（state/skipped.json）
_back = {r["qid"] for r in load(os.path.join(STATE, "skipped.json"), []) if r.get("kind") == "上限のため見送り（書ける）"}
save("prev_qids.json", sorted(set(load(os.path.join(STATE, "seen-qids.json"))) - _back), indent=None)
if _back:
    print("前に上限で見送った候補を戻す", len(_back))
for f, empty in (("subject_ok.json", []), ("drops.json", {}), ("ids.json", {}), ("sites.json", {})):
    if not os.path.exists(f):
        save(f, empty)
pub = {}
for e in spots:
    if e["region"].get("country") == "日本" and e.get("status") == "published":
        pub[e["region"]["prefecture"]] = pub.get(e["region"]["prefecture"], 0) + 1
save("published_by_pref.json", dict(sorted(pub.items(), key=lambda x: x[1])))
print("台帳", len(spots), "・既知の QID", len(qids), "・前に見た候補", len(load("prev_qids.json")))
print("公開の少ない県:", " ".join(f"{k}{v}" for k, v in list(sorted(pub.items(), key=lambda x: x[1]))[:20]))
