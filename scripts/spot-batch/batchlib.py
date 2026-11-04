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
