"""濃くする束 段2b: 書く担当へ渡す準備（今の行の控え・組分け）。材料が薄い行は組に入れず理由を残す。

  SPOT_BATCH_DIR=… python3 scripts/spot-batch/e02b_prep.py [--groups 4] [--min-chars 1500]

- 材料が足りる行: Wikipedia が取れていて、公式サイトの頁の本文が合計で --min-chars 字以上
- 出力: rows_before.json（今の行）・assign_<組>.json（slug の配列）・thin.json（材料が薄い行と理由）
"""
import argparse
import os

from batchlib import CONTENT, load, save, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("--groups", type=int, default=4)
ap.add_argument("--min-chars", type=int, default=1500)
a = ap.parse_args()
work_dir()
targets = load("targets.json")
mats = load("materials.json")
L = {e["slug"]: e for e in load(os.path.join(CONTENT, "spots.json"))}
ok, thin = [], {}
for t in targets:
    m = mats.get(t["slug"])
    if not m:
        thin[t["slug"]] = "材料が取れていない"
        continue
    wp = len((m.get("wikipedia") or {}).get("text", ""))
    off = sum(len(p["text"]) for p in m.get("official", []))
    if not wp:
        thin[t["slug"]] = "Wikipedia が取れていない"
    elif off < a.min_chars:
        thin[t["slug"]] = f"公式サイトの本文が {off} 字（{a.min_chars} 字未満）。取れなかった理由: {'; '.join(m.get('skipped', []))[:120]}"
    else:
        ok.append(t["slug"])
rows = {}
for s in ok:
    e = L[s]
    rows[s] = {k: e.get(k) for k in ("name", "summary", "description", "highlights", "region", "category")}
save("rows_before.json", rows)
groups = [chr(65 + i) for i in range(a.groups)]
for gi, g in enumerate(groups):
    save(f"assign_{g}.json", ok[gi::a.groups])
save("thin.json", thin)
# 指示書の {{DIR}}・{{PG}} を束のフォルダ・作業ツリーに置き換えて prompts/ に書き出す
from batchlib import HERE, PG
os.makedirs("prompts", exist_ok=True)
for name in ("ENRICH_WRITER.md", "ENRICH_REVIEWER.md"):
    t = open(os.path.join(HERE, "prompts", name), encoding="utf-8").read()
    open(os.path.join("prompts", name), "w", encoding="utf-8").write(t.replace("{{DIR}}", os.getcwd()).replace("{{PG}}", PG))
print("材料が足りる", len(ok), "・薄い", len(thin), "・組", {g: len(ok[i::a.groups]) for i, g in enumerate(groups)})
