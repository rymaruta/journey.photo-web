"""段14: 作例の候補の縮小版（横 1280px）を落とす。1枚目を全スポット → 2枚目を全スポット …の順。

  timeout 7000 python3 scripts/spot-batch/s14_dl_thumbs.py --max-index 3 > dl.log 2>&1   （背景で流す）
- 画像は curl で取る（Python の urllib は upload.wikimedia.org で1枚 約20秒かかった）
- 2秒に1回・1本だけ。429・5xx は retry-after に従う。Commons の画像サーバーはこの環境の出口を強く絞る
  （第4束: 要求の約半分が 429・1分に数枚）。1枚目だけ先に取り、目視を始めてよい
- 3,000 バイト以下（429 の本文など）は取れていない扱い。流し直すと、取れていない分だけ取る
"""
import argparse
import os
import re
import subprocess
import time

from batchlib import UA, load, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("--max-index", type=int, default=3, help="各スポットの何枚目まで取るか（1枚目=1）")
a = ap.parse_args()
work_dir()
ids = sorted(set(open("new_ids.txt").read().split()))
S = load("samples_before_visual.json")
st = {"req": 0, "429": 0, "ok": 0, "err": 0}
last = 0.0


def ok(p):
    return os.path.exists(p) and os.path.getsize(p) > 3000


for i in range(a.max_index):
    for sid in ids:
        e = S.get(sid)
        if not e or i >= len(e["samples"]):
            continue
        p = f"thumbs/{sid}/{i}.jpg"
        os.makedirs(f"thumbs/{sid}", exist_ok=True)
        if ok(p):
            continue
        u = e["samples"][i]["thumbUrl"]
        for attempt in range(40):
            w = last + 2 - time.time()
            if w > 0:
                time.sleep(w)
            last = time.time()
            st["req"] += 1
            r = subprocess.run(["curl", "-sS", "-o", p, "-D", "dl_headers.txt", "-w", "%{http_code}", "-A", UA, "--max-time", "60", u],
                               capture_output=True, text=True)
            code = r.stdout.strip()
            if code == "200":
                st["ok"] += 1
                break
            if code == "429" or code.startswith("5"):
                h = open("dl_headers.txt").read().lower()
                m = re.search(r"retry-after:\s*(\d+)", h)
                st["429"] += 1
                time.sleep((int(m.group(1)) if m else 10) + 1)
                continue
            st["err"] += 1
            print("err", sid, i, code, flush=True)
            break
        if st["ok"] % 20 == 0:
            print(i, sid, st, flush=True)
print("done", st, flush=True)
