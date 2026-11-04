"""段15: 目で見る担当に渡す組を作る。

  python3 scripts/spot-batch/s15_visual_groups.py first --per 27    → visual/group<N>.json（各スポットの1枚目）
  python3 scripts/spot-batch/s15_visual_groups.py rest  --per 56    → visual/pending<N>.json（2枚目以降・前の判断つき）
- 1人に渡すのは 1枚目なら 27 枚まで、2枚目以降なら 56 枚まで（第4束: 81 枚渡した担当が途中で画像を開けなくなり、
  見ずに決めた。全部やり直した）
- rest は first の結果（visual/V*.json）を読み、currentCover（いまの代表写真）と alreadyKept（残した1枚目）を付ける
- 番号は既にある組の続きから振る（V1.json と P1.json が混ざらない）
"""
import argparse
import glob
import os
import re

from batchlib import load, save, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("mode", choices=["first", "rest"])
ap.add_argument("--per", type=int)
a = ap.parse_args()
work_dir()
ids = sorted(set(open("new_ids.txt").read().split()))
S = load("samples_before_visual.json")


def ok(p):
    return os.path.exists(p) and os.path.getsize(p) > 3000


def next_no(prefix):
    nums = [int(m.group(1)) for f in glob.glob(f"visual/{prefix}*.json") if (m := re.search(rf"{prefix}(\d+)\.json$", f))]
    return max(nums, default=0) + 1


if a.mode == "first":
    per = a.per or 27
    items = [(s, {"slug": S[s]["slug"], "name": S[s]["name"],
                  "files": [{"i": 0, "path": os.path.abspath(f"thumbs/{s}/0.jpg"), "file": S[s]["samples"][0]["file"]}]})
             for s in ids if s in S and S[s]["samples"] and ok(f"thumbs/{s}/0.jpg")]
    n0 = next_no("group")
    for j in range(0, len(items), per):
        save(f"visual/group{n0 + j // per}.json", dict(items[j:j + per]))
    print("1枚目", len(items), "か所 →", (len(items) + per - 1) // per, "組（group%d〜）" % n0)
else:
    per = a.per or 56
    V = {}
    for f in sorted(glob.glob("visual/V*.json")):
        V.update(load(f))
    seen = set()
    for f in glob.glob("visual/pending*.json"):
        for sid, d in load(f).items():
            seen |= {(sid, x["i"]) for x in d["files"]}
    items = []
    for sid in ids:
        e = S.get(sid)
        if not e:
            continue
        files = [{"i": i, "path": os.path.abspath(f"thumbs/{sid}/{i}.jpg"), "file": e["samples"][i]["file"]}
                 for i in range(1, len(e["samples"])) if ok(f"thumbs/{sid}/{i}.jpg") and (sid, i) not in seen]
        if not files:
            continue
        v = V.get(sid, {})
        ex0 = v.get("unviewed") or any(x["i"] == 0 for x in v.get("exclude", []))
        items.append((sid, {"slug": e["slug"], "name": e["name"], "currentCover": v.get("cover"), "coverNote": v.get("note", ""),
                            "files": files,
                            "alreadyKept": [] if ex0 or sid not in V else [{"i": 0, "path": os.path.abspath(f"thumbs/{sid}/0.jpg"), "file": e["samples"][0]["file"]}]}))
    n0 = next_no("pending")
    groups, cur, cnt = [], [], 0
    for it in items:
        if cur and cnt + len(it[1]["files"]) > per:
            groups.append(cur)
            cur, cnt = [], 0
        cur.append(it)
        cnt += len(it[1]["files"])
    if cur:
        groups.append(cur)
    for j, g in enumerate(groups):
        save(f"visual/pending{n0 + j}.json", dict(g))
    print("2枚目以降", sum(len(d["files"]) for _, d in items), "枚 →", len(groups), "組（pending%d〜）" % n0)
