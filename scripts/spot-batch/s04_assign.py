"""段4: 県を組（A〜D…）に分け、県ごとに言語版の多い順から N 件ずつ担当を決める。

  python3 scripts/spot-batch/s04_assign.py --groups 4 --per-pref 14
県は件数（候補の数）が偏らないように順に配る。1組 4〜6 県・約 70 件が、書く担当1人で回る目安。
"""
import argparse

from batchlib import load, save, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("--groups", type=int, default=4)
ap.add_argument("--per-pref", type=int, default=14)
a = ap.parse_args()
work_dir()
c = load("cands_f.json")
targets = [p for p in load("target_prefs.json") if c.get(p)]
names = [chr(ord("A") + i) for i in range(a.groups)]
G = {g: {} for g in names}
load_ = {g: 0 for g in names}
for p in sorted(targets, key=lambda p: -min(a.per_pref, len(c[p]))):
    g = min(names, key=lambda x: load_[x])
    G[g][p] = [x["qid"] for x in c[p][: a.per_pref]]
    load_[g] += len(G[g][p])
for g, v in G.items():
    save(f"assign_{g}.json", v)
    print(g, load_[g], " ".join(v))
