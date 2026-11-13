"""段21: 時期で変わる情報のある行の説明の末尾に「※最新の情報は〇〇でご確認ください。」を付ける（2026-11-13 owner）。

  python3 scripts/spot-batch/s21_add_latest_note.py [--check] [content/spots.json]
- owner: 「最新がわからないときは注釈をつけてほしい。※最新の情報は〇〇」
- 対象: 閉鎖・休止・拝観・工事・予約・料金・開館時間・「〇年現在」など、いまの状態で変わる語が説明・見どころ・季節・時間帯・こつに出る行
- 〇〇: 公式サイトの欄がある行は「公式サイト」、無い行は「自治体や観光協会の案内」（案内先を指すだけで、事実は足さない）
- 既にある「訪れる前に…確認してください。」の文は、この注記に置き換える（二重にしない）。付いている行は触らない（何度流しても同じ）
- 行の塊を文字列のまま書き換える（台帳の書式を変えない）。--check は付く行の数だけ出して書かない
- 新しい行の書き方は WRITER.md、検査は judge.mjs（同じ語の一覧）
"""
import json
import re
import sys

NOTE = "※最新の情報は{p}でご確認ください。"
TRIGGER = re.compile(
    r"閉鎖|閉館|休館|休止|運休|規制|立入禁止|立ち入り禁止|通行止め|工事|再整備|更新事業|予約|拝観|開洞|開門|閉門|開館|開園|"
    r"料金|有料|定休|廃止|休園|不定期|年現在|時点|現在"
)
CONFIRM = re.compile(r"(訪れる前|行く前|出かける前|訪問前)に[^。]*確認してください$")


def texts(r):
    t = [r.get("description") or ""]
    t += r.get("highlights") or []
    for k in ("seasonalGuide", "timeOfDayGuide"):
        t += [x.get("text", "") for x in (r.get(k) or [])]
    t += r.get("compositionTips") or []
    return "\n".join(t)


def new_description(r):
    d = r.get("description") or ""
    if not d or "※最新の情報は" in d or not TRIGGER.search(texts(r)):
        return None
    sents = [s for s in d.split("。") if s != ""]
    sents = [s for s in sents if not CONFIRM.search(s)]
    pointer = "公式サイト" if r.get("officialWebsiteUrl") else "自治体や観光協会の案内"
    return "。".join(sents) + "。" + NOTE.format(p=pointer)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else "content/spots.json"
    check = "--check" in sys.argv
    t = open(path, encoding="utf-8").read()
    lines = t.split("\n")
    blocks, cur = [], None
    for i, l in enumerate(lines):
        if l == "  {":
            cur = i
        elif l in ("  }", "  },") and cur is not None:
            blocks.append((cur, i))
            cur = None
    changed = 0
    for a, b in blocks:
        body = "\n".join(lines[a:b + 1]).rstrip(",")
        r = json.loads(body)
        nd = new_description(r)
        if nd is None:
            continue
        for j in range(a, b + 1):
            if lines[j].startswith('    "description": '):
                tail = "," if lines[j].endswith(",") else ""
                old = json.loads(lines[j][len('    "description": '):].rstrip(",") if tail else lines[j][len('    "description": '):])
                assert old == r["description"], r["slug"]
                lines[j] = '    "description": ' + json.dumps(nd, ensure_ascii=False) + tail
                changed += 1
                break
    print(f"対象 {changed} 行 / {len(blocks)} 行")
    if not check and changed:
        out = "\n".join(lines)
        json.loads(out)
        open(path, "w", encoding="utf-8").write(out)


main()
