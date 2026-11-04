"""段16: 目視の結果（visual/V*.json・P*.json・overrides*.json）を確定ファイルに書く。

  python3 scripts/spot-batch/s16_apply_visual.py
- 出すのは「担当が開いて見て、残すと決めた写真」だけ。pending・unviewed・取れていない写真は出さない
- group<N>.json ↔ V<N>.json（1枚目）、pending<N>.json ↔ P<N>.json（2枚目以降）を番号で突き合わせる
- 代表写真: V の cover → P の cover（"keep" なら替えない・数なら替える・null なら外す）→ overrides の cover の順に上書き
- overrides*.json は手で決めたもの: {"<spotId>": {"exclude": [{"i": 2, "reason": "…"}], "cover": null, "note": "…"}}
  （例: 写真の場所を確かめられない・空からの写真でないと言い切れない）
- 外した写真は content/spot-samples-excluded.json に理由つきで足す（次に集め直しても戻らない）
- 何度流しても同じ結果（content/spot-samples.json は develop の版から作り直す）
"""
import glob
import json
import os
import re
import subprocess

from batchlib import CONTENT, PG, load, save, work_dir

work_dir()
S = load("samples_before_visual.json")
ids = set(open("new_ids.txt").read().split())


def show(p):
    return json.loads(subprocess.run(["git", "-C", PG, "show", "origin/develop:" + p], capture_output=True, text=True, check=True).stdout)


OUT = show("content/spot-samples.json")
EXC = show("content/spot-samples-excluded.json")
seenE = {(e["spotId"], e["file"]) for e in EXC}


def ok(sid, i):
    p = f"thumbs/{sid}/{i}.jpg"
    return os.path.exists(p) and os.path.getsize(p) > 3000


def pairs(gpat, rpat):
    for g in sorted(glob.glob(f"visual/{gpat}*.json")):
        n = re.search(r"(\d+)\.json$", g).group(1)
        r = f"visual/{rpat}{n}.json"
        if os.path.exists(r):
            yield load(g), load(r)
        else:
            print("まだ結果が無い組:", g)


viewed, excl, cover, notes = {}, {}, {}, {}
for G, V in pairs("group", "V"):
    for sid, v in V.items():
        if sid not in G or v.get("unviewed"):
            continue
        pend = set(v.get("pending", []))
        viewed.setdefault(sid, set()).update(f["i"] for f in G[sid]["files"] if f["i"] not in pend)
        for x in v.get("exclude", []):
            excl.setdefault(sid, {})[x["i"]] = x["reason"]
        cover[sid] = v.get("cover")
for G, P in pairs("pending", "P"):
    for sid, p in P.items():
        if sid not in G:
            continue
        pend = set(p.get("pending", []))
        decided = set(p.get("keep", [])) | {x["i"] for x in p.get("exclude", [])}
        viewed.setdefault(sid, set()).update(f["i"] for f in G[sid]["files"] if f["i"] in decided and f["i"] not in pend)
        for x in p.get("exclude", []):
            excl.setdefault(sid, {})[x["i"]] = x["reason"]
        c = p.get("cover", "keep")
        if c != "keep":
            cover[sid] = c
for f in sorted(glob.glob("visual/overrides*.json")):
    for sid, o in load(f).items():
        for x in o.get("exclude", []):
            excl.setdefault(sid, {})[x["i"]] = x["reason"]
        if "cover" in o:
            cover[sid] = o["cover"]
        if o.get("note"):
            notes[sid] = o["note"]

stat = {"spots": 0, "kept": 0, "excluded": 0, "cover": 0, "nocover": 0}
covers = {}
for sid in sorted(ids):
    if sid not in S:
        continue
    smp = S[sid]["samples"]
    kept = [i for i in sorted(viewed.get(sid, ())) if i < len(smp) and i not in excl.get(sid, {}) and ok(sid, i)]
    for i, why in excl.get(sid, {}).items():
        if i < len(smp) and (sid, smp[i]["file"]) not in seenE:
            EXC.append({"spotId": sid, "file": smp[i]["file"], "reason": f"目で見て（visual-review）: {why}"})
            seenE.add((sid, smp[i]["file"]))
            stat["excluded"] += 1
    c = cover.get(sid)
    if c not in kept:
        c = None
    if kept:
        OUT[sid] = {"slug": S[sid]["slug"], "name": S[sid]["name"],
                    "samples": [dict(smp[i], pickedBy="visual-review" if i == c else "auto") for i in kept]}
        stat["kept"] += len(kept)
    else:
        OUT.pop(sid, None)
    stat["spots"] += 1
    if c is None:
        stat["nocover"] += 1
    else:
        stat["cover"] += 1
        covers[S[sid]["slug"]] = smp[c]["file"]

with open(os.path.join(CONTENT, "spot-samples.json"), "w", encoding="utf-8") as f:
    f.write(json.dumps({k: OUT[k] for k in sorted(OUT)}, ensure_ascii=False, indent=2) + "\n")
with open(os.path.join(CONTENT, "spot-samples-excluded.json"), "w", encoding="utf-8") as f:
    f.write(json.dumps(EXC, ensure_ascii=False, indent=2) + "\n")
save("final_covers.json", covers, indent=0)
print(json.dumps(stat, ensure_ascii=False))
