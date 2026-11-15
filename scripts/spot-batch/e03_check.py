"""濃くする束 段3: 書いた説明を機械で検査する。

  SPOT_BATCH_DIR=… python3 scripts/spot-batch/e03_check.py out/A.json [out/B.json …]

見るもの（rows ごと）:
  - 形: description 320〜620字（注記を除く）・highlights 3〜6個（各8〜30字）・claims がある
  - 引用: claims の evidence.quote が、その出典（wp・o1〜）の本文に一字一句在る（空白を除いて照合）
  - 数字・年: description の数字は、公式サイトの頁のどれかに在るか、2つ以上の出典に在る
  - 写しすぎ: description の連続21字が、材料のどれかの本文と一致しない
  - 語: 禁止語・主観の語・英字・最新の情報の注記（judge.mjs と同じ規則）
問題0なら 0 で終わる。
"""
import re
import sys
import unicodedata

from batchlib import load, work_dir

work_dir()
mats = load("materials.json")
before = load("rows_before.json", {})
BANNED = ["撮りどき", "撮影地", "この場所", "ガイド", "捨て", "**"]
SUBJ = ["雰囲気", "静か", "静寂", "人気", "賑わ", "にぎわ", "混み", "混雑", "おすすめ", "オススメ", "必見", "絶景", "素晴らし", "見事", "圧巻", "壮観", "壮大", "癒", "魅了", "感動", "落ち着いた", "多くの人が訪れ"]
LATEST = re.compile(r"閉鎖|閉館|休館|休止|運休|規制|立入禁止|立ち入り禁止|通行止め|工事|再整備|更新事業|予約|拝観|開洞|開門|閉門|開館|開園|料金|有料|定休|廃止|休園|不定期|年現在|時点|現在")
NOTE = re.compile(r"※最新の情報は[^。]*。")


def norm(s):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s))


def sources(slug):
    m = mats.get(slug) or {}
    out = {}
    if m.get("wikipedia"):
        out["wp"] = norm(m["wikipedia"]["text"])
    for i, p in enumerate(m.get("official") or []):
        out[f"o{i + 1}"] = norm(p["text"])
    return out


def numbers(s):
    return set(re.findall(r"\d[\d,，.]*\d|\d", unicodedata.normalize("NFKC", s)))


problems = 0
files = sys.argv[1:]
for f in files:
    d = load(f)
    for r in d.get("rows", []):
        slug = r["slug"]
        p = []
        src = sources(slug)
        if not src:
            p.append("材料が無い")
        desc = r.get("description") or ""
        body = NOTE.sub("", desc)
        n = len(body)
        if not 320 <= n <= 620:
            p.append(f"description が{n}字（320〜620字）")
        hl = r.get("highlights") or []
        if not 3 <= len(hl) <= 6 or any(not 8 <= len(h) <= 30 for h in hl):
            p.append("highlights は3〜6個・各8〜30字")
        claims = r.get("claims") or []
        if not claims:
            p.append("claims が無い")
        for c in claims:
            for ev in c.get("evidence", []):
                q = norm(ev.get("quote", ""))
                if ev.get("src") not in src:
                    p.append(f"引用の出典が材料に無い: {ev.get('src')}")
                elif len(q) < 10 or q not in src[ev["src"]]:
                    p.append(f"引用が{ev.get('src')}の本文に無い: 「{ev.get('quote', '')[:30]}」")
        if not claims or not any(c.get("evidence") for c in claims):
            p.append("根拠の引用が無い")
        # 元の説明（すでに公開して照合済み）にある数字で、Wikipedia の本文にも在るものは残してよい。
        # 新しく足す数字は、公式サイトの頁に在るか、2つ以上の出典に在るものだけ
        b0 = before.get(slug) or {}
        old = numbers((b0.get("description") or "") + (b0.get("summary") or "") + " ".join(b0.get("highlights") or []))
        for num in sorted(numbers(body)):
            where = [k for k, t in src.items() if num in numbers(t) or num in t]
            kept = num in old and "wp" in where
            if not (any(k.startswith("o") for k in where) or len(where) >= 2 or kept):
                p.append(f"数字「{num}」の根拠が足りない（{where or '材料に無い'}）")
        nb = norm(body)
        hit = None
        for i in range(0, max(0, len(nb) - 21)):
            seg = nb[i:i + 21]
            for k, t in src.items():
                if seg in t:
                    hit = (k, body[max(0, i - 2):i + 30])
                    break
            if hit:
                break
        if hit:
            p.append(f"材料と連続21字が同じ（{hit[0]}）: 「{hit[1]}」")
        allt = desc + "\n" + "\n".join(hl) + "\n" + (r.get("summary") or "")
        for w in BANNED + SUBJ:
            if w in allt:
                p.append(f"使わない語「{w}」")
        if re.search(r"[A-Za-z]", allt):
            p.append("本文に英字")
        if LATEST.search(allt) and "※最新の情報は" not in desc:
            p.append("最新の情報の注記が無い")
        if p:
            problems += len(p)
            print(f"{f} {slug}:")
            for x in p:
                print("   -", x)
print(f"rows {sum(len(load(f).get('rows', [])) for f in files)}・問題あり {problems}")
sys.exit(1 if problems else 0)
