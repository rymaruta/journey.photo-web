"""濃くする束 段1: 説明を厚くする行を選ぶ（公開済みの国内・公式サイトが https・Wikipedia の出典がある行）。

  SPOT_BATCH_DIR=/home/user/spot-batch/e1 python3 scripts/spot-batch/e01_select.py [--n 40] [--per-pref 3] [--max-len 200]

説明の短い順に、県ごとに --per-pref 件まで（偏らせない）。前の濃くする束で書き換えた行（state/enriched.json）は選ばない。
出力: targets.json
"""
import argparse
import json
import os
import re
import urllib.parse

from batchlib import CONTENT, STATE, load, save, work_dir

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=40)
ap.add_argument("--per-pref", type=int, default=3)
ap.add_argument("--max-len", type=int, default=200)
ap.add_argument("--prefs", default="", help="県名をカンマ区切りで指定（例 宮崎県,山形県）。空なら全県")
a = ap.parse_args()
work_dir()

L = load(os.path.join(CONTENT, "spots.json"))
done = {r["slug"] for r in load(os.path.join(STATE, "enriched.json"), [])}
want_pref = {p for p in a.prefs.split(",") if p}


def desc_len(e):
    return len(re.sub(r"※最新の情報は[^。]*。", "", e.get("description") or ""))


cands = []
for e in L:
    if e.get("status") != "published" or e["slug"] in done:
        continue
    reg = e.get("region") or {}
    if reg.get("country", "日本") not in ("日本", None, ""):
        continue
    if want_pref and reg.get("prefecture") not in want_pref:
        continue
    site = e.get("officialWebsiteUrl") or ""
    if not site.startswith("https://"):
        continue
    wp = next((s["url"] for s in (e.get("aiCheck") or {}).get("sources", []) if "ja.wikipedia.org/wiki/" in s["url"]), None)
    qid = next((s["url"].rsplit("/", 1)[-1] for s in (e.get("aiCheck") or {}).get("sources", []) if "wikidata.org/wiki/Q" in s["url"]), None)
    if not wp or desc_len(e) >= a.max_len:
        continue
    title = urllib.parse.unquote(wp.split("/wiki/", 1)[1]).replace("_", " ")
    cands.append({"slug": e["slug"], "name": e["name"], "prefecture": reg.get("prefecture", ""), "wpTitle": title, "wpUrl": wp,
                  "qid": qid, "site": site, "descLen": desc_len(e)})
cands.sort(key=lambda c: c["descLen"])
per, out = {}, []
for c in cands:
    if per.get(c["prefecture"], 0) >= a.per_pref:
        continue
    per[c["prefecture"]] = per.get(c["prefecture"], 0) + 1
    out.append(c)
    if len(out) >= a.n:
        break
save("targets.json", out)
print("候補", len(cands), "→ 選んだ", len(out), "・県", len(per), "・説明の長さ", out[0]["descLen"] if out else "-", "〜", out[-1]["descLen"] if out else "-")
