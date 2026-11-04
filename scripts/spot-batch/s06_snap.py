"""段6: 組の分の記事がそろったら articles_<組>.json に切り出す（書く担当は取得中の articles.json を読まない）。

  python3 scripts/spot-batch/s06_snap.py A      # そろうまで 15 秒ごとに待つ
"""
import sys
import time

from batchlib import load, save, work_dir

work_dir()
g = sys.argv[1]
ids = [q for v in load(f"assign_{g}.json").values() for q in v]
while True:
    try:
        a = load("articles.json")
    except Exception:
        time.sleep(5)
        continue
    if all(q in a for q in ids):
        break
    time.sleep(15)
save(f"articles_{g}.json", {q: a[q] for q in ids}, indent=None)
print("snap", g, len(ids))
