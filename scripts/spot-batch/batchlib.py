"""撮影スポットの束（docs/spot-batch-runbook.md）の台本が共通で使うもの。

- 作業用フォルダは環境変数 SPOT_BATCH_DIR（無ければ止める）。台本は全部そこを cwd にして動く
- リポジトリの根は、この台本の置き場所から決める（scripts/spot-batch/ の2つ上）
- Wikimedia への要求は polite() だけを通す: 2秒に1回・1本だけ・429/5xx は retry-after に従う
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PG = os.path.abspath(os.path.join(HERE, "..", ".."))
CONTENT = os.path.join(PG, "content")
STATE = os.path.join(HERE, "state")
UA = "JourneyPhotoSpotCheck/1.0 (https://journey-photo.com)"
CA = "/root/.ccr/ca-bundle.crt"
CTX = ssl.create_default_context(cafile=CA) if os.path.exists(CA) else None


def work_dir():
    d = os.environ.get("SPOT_BATCH_DIR")
    if not d:
        sys.exit("SPOT_BATCH_DIR に作業用フォルダを渡す（例: export SPOT_BATCH_DIR=/home/user/spot-batch/b6）")
    os.makedirs(d, exist_ok=True)
    os.chdir(d)
    return d


def load(path, default=None):
    if default is not None and not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, data, indent=1):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write("\n")
    os.replace(tmp, path)


_last = [0.0]
STATS = {"req": 0, "429": 0, "5xx": 0, "waited": 0.0, "noRetryAfter": 0}


def polite(url, data=None, headers=None, gap=2.0):
    """Wikimedia へ1本だけ・gap 秒に1回。429・5xx は retry-after に従って待つ。"""
    for attempt in range(10):
        w = _last[0] + gap - time.time()
        if w > 0:
            time.sleep(w)
        _last[0] = time.time()
        h = {"User-Agent": UA}
        if headers:
            h.update(headers)
        req = urllib.request.Request(url, data=data, headers=h)
        STATS["req"] += 1
        try:
            with urllib.request.urlopen(req, context=CTX, timeout=90) as r:
                body = r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                ra = e.headers.get("retry-after")
                STATS["429" if e.code == 429 else "5xx"] += 1
                if not (ra and ra.isdigit()):
                    STATS["noRetryAfter"] += 1
                w2 = float(ra) if ra and ra.isdigit() else 5 * (attempt + 1)
                STATS["waited"] += w2
                time.sleep(w2)
                continue
            raise
        except Exception:
            time.sleep(5 * (attempt + 1))
            continue
        # maxlag（HTTP 200 で本文がエラー）も待って取り直す
        if '"code":"maxlag"' in body.replace(" ", "") or "cirrussearch-too-busy-error" in body:
            STATS["waited"] += 30 * (attempt + 1)
            time.sleep(30 * (attempt + 1))
            continue
        return body
    raise RuntimeError("応答しません: " + url)


def sparql(q):
    body = urllib.parse.urlencode({"query": q}).encode()
    t = polite("https://query.wikidata.org/sparql", data=body,
               headers={"Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/sparql-results+json"})
    return json.loads(t)["results"]["bindings"]


def wiki_api(params):
    params = dict(params, format="json", formatversion=2, maxlag=5)
    return json.loads(polite("https://ja.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)))


def groups():
    """この束の組（assign_<組>.json がある組）"""
    return sorted(f[len("assign_"):-len(".json")] for f in os.listdir(".") if f.startswith("assign_") and f.endswith(".json"))


def out_files():
    return [os.path.join("out", f"{g}.json") for g in groups() if os.path.exists(os.path.join("out", f"{g}.json"))]


# 見送りの理由の種類（state/skipped.json の kind）。上から順に当てる。
# revisit: いつ見直せばよいか。None は見直さない（台帳と重なる・県が違う など、記事が変わっても書かない）。
# 「上限のため」は記事に問題が無い＝次の束でそのまま書ける（s01 が次の束の候補に戻す）。
SKIP_KINDS = [
    ("上限のため見送り（書ける）", "次の束でそのまま書く", r"上限|件を書いたため"),
    ("台帳と重なる", None, r"台帳|重な|と同じ|含む|中にある|内にある|の一部|の別名|見送り済み"),
    ("ほかの組・県", None, r"[ABCD] ?組が|組[ABCD] ?[がでに]|の記事で|県として書けない|担当の県|山頂は.+県"),
    ("記事が曖昧さ回避", None, r"曖昧さ回避"),
    ("立ち入れない・撮れない", "立ち入りや撮影の扱いが記事で変わったら",
     r"入山禁止|立入|立ち入|入れない|許可|撮影.{0,6}禁止|射爆|ダイビング|無人|上陸|渡る手段|非公開|領有|拝観不可|欠航|予約が困難"),
    ("縦走・山小屋・難路が前提", "日帰りで行けると記事に書かれたら",
     r"縦走|山小屋|日帰り|泊|日行程|複数日|登山道が無|藪|長丁場|難路|遡行|行程が長|健脚|岩稜|上級|急登"),
    ("災害・火山・通行止め", "記事に復旧や規制の解除が書かれたら", r"地震|崩落|通行止|倒壊|復旧|被災|豪雨|災害|噴火|火山|警戒レベル"),
    ("いまは見るものが無い", None, r"残っていない|面影|更地|解体|荒廃|廃墟|閉山|埋設|埋め戻"),
    ("座標を確かめられない", "記事に座標が足されたら", r"座標"),
    ("照合で落ちる・所在が書けない", "照合の台本か記事が直ったら", r"照合|県名が無|県の名が無|市町村名が無"),
    ("施設で撮影対象と言えない", "記事に建物や庭の記述が足されたら", r"博物館|天文台|プラネタリウム|施設で"),
    ("見学・撮影できるか分からない", "記事に公開・見学の記述が足されたら", r"見学|撮影ができる|撮影できる"),
    ("広すぎる・町や港", None, r"広すぎ|広い地域|地域の記事|町の記事|工業港|炭田|アイランド|島内の"),
    ("記事に景色の記述が乏しい", "記事の景色・見どころの記述が増えたら", r"乏し|短い|短く|少な|記述が無|記述がな|記事に無い|のみ|景色|見どころ|眺め|展示"),
]


def classify_skip(reason):
    """見送りの理由の文から、種類と見直す条件を決める。どれにも当たらなければ「その他」。

    「県の上限で見送り」は、上限の言葉を除いた残りの理由でもう一度分ける。残りに別の理由（記事が短い・
    山小屋が前提など）があればそちらの種類にし、無い（「記事は使える」「撮影向き」だけ）ときだけ
    「上限のため見送り（書ける）」＝次の束の候補に戻す。
    """
    import re
    text = reason or ""
    limit = SKIP_KINDS[0]
    if re.search(limit[2], text):
        rest = re.sub(r"[^（(、。]*(上限|件を書いたため)[^（(、。]*[、。]?", "", text)
        rest = re.sub(r"記事は使えるが|撮影向きの[^、。）)]*|上限のため", "", rest)
        for kind, revisit, pat in SKIP_KINDS[1:]:
            if re.search(pat, rest):
                return kind, revisit
        return limit[0], limit[1]
    for kind, revisit, pat in SKIP_KINDS[1:]:
        if re.search(pat, text):
            return kind, revisit
    return "その他", "理由を読んで判断"
