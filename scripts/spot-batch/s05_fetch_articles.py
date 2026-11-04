"""段5: 担当に割り当てた候補の日本語版 Wikipedia の記事を、全文で1件ずつ取る（2秒に1回・1本だけ）。

  timeout 7000 python3 scripts/spot-batch/s05_fetch_articles.py > fetch.log 2>&1   （背景で流す）
本文は切らない（終わりの方の「歴史」の節に最近の災害・閉鎖がある）。10件ごとに保存し、止まっても続きから走る。
1記事あたり実質 約12秒（429 の待ちを含む）＝ 300 記事で約1時間。
"""

import batchlib
from batchlib import groups, load, save, wiki_api, work_dir

work_dir()
c = load("cands_f.json")
byq = {it["qid"]: (p, it) for p, items in c.items() for it in items}
want = []
for g in groups():
    for p, qs in load(f"assign_{g}.json").items():
        want += [q for q in qs if q not in want]
arts = load("articles.json", {})
todo = [q for q in want if q not in arts]
print("todo", len(todo), flush=True)
for i, q in enumerate(todo):
    p, it = byq[q]
    d = wiki_api({"action": "query", "prop": "extracts|revisions|pageprops", "explaintext": 1, "rvprop": "ids",
                  "titles": it["title"], "redirects": 1})
    pg = d["query"]["pages"][0]
    arts[q] = {"pref": p, "title": pg.get("title"), "revid": (pg.get("revisions") or [{}])[0].get("revid"),
               "extract": pg.get("extract", ""), "disambig": "disambiguation" in (pg.get("pageprops") or {}), "cand": it}
    if i % 10 == 0:
        save("articles.json", arts, indent=None)
        print(i, batchlib.STATS, flush=True)
save("articles.json", arts, indent=None)
print("done", len(arts), batchlib.STATS)
