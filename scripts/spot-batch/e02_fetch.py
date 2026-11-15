"""濃くする束 段2: 材料を取る（Wikipedia の全文＋公式サイトの頁）。1本・間隔を守る・止まっても続きから走る。

  SPOT_BATCH_DIR=… timeout 7000 python3 scripts/spot-batch/e02_fetch.py > fetch.log 2>&1   （背景で流す）

- Wikipedia: 日本語版の全文（切らない）。1記事ずつ・2秒に1回（batchlib.wiki_api）
- 公式サイト: 行の officialWebsiteUrl の頁と、同じサイトの中で「歴史・由緒・見どころ・施設・概要・案内」らしい頁を最大3つ。
  robots.txt が禁じる頁は取らない。同じサイトへは2秒に1回。ログイン・予約・求人・お知らせなどは取らない
- 出力: materials.json  {slug: {"wikipedia": {...}, "official": [{"url","title","text","readAt"}], "skipped": [理由]}}
"""
import datetime
import html.parser
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

import batchlib
from batchlib import UA, load, save, wiki_api, work_dir

work_dir()
CTX = ssl.create_default_context()
GOOD = re.compile(r"歴史|由緒|沿革|概要|紹介|見どころ|みどころ|見所|施設|展示|収蔵|ご案内|案内|について|はじめに|魅力|特徴|about|history|guide|outline|overview|spot|highlight|intro", re.I)
BAD = re.compile(r"予約|チケット|求人|採用|お問い?合わせ|問合せ|プライバシー|個人情報|サイトマップ|ニュース|お知らせ|イベント|blog|login|cart|shop|ショップ|通販|寄付|会員|アクセス|交通|駐車|English|ENGLISH|中文|한국|\.pdf|\.jpe?g|\.png|\.zip|mailto:|tel:|javascript:", re.I)
SKIP_TAGS = {"script", "style", "noscript", "nav", "header", "footer", "form", "aside", "svg", "iframe", "button", "select"}
_last = {}
_robots = {}


class TextParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.lines = []
        self.cur = []
        self.links = []
        self._href = None
        self._atext = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self.depth += 1
        if tag == "title":
            self._in_title = True
        if tag in ("br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "dt", "dd", "section", "article"):
            self._flush()
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._atext = []

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and self.depth:
            self.depth -= 1
        if tag == "title":
            self._in_title = False
        if tag == "a" and self._href is not None:
            self.links.append((self._href, "".join(self._atext).strip()))
            self._href = None
        if tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "dt", "dd", "section", "article"):
            self._flush()

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._href is not None:
            self._atext.append(data)
        if self.depth == 0:
            self.cur.append(data)

    def _flush(self):
        t = re.sub(r"\s+", " ", "".join(self.cur)).strip()
        self.cur = []
        if len(t) >= 6:
            self.lines.append(t)

    def text(self):
        self._flush()
        seen, out = set(), []
        for l in self.lines:
            if l not in seen:
                seen.add(l)
                out.append(l)
        return "\n".join(out)


def robots_ok(url):
    host = urllib.parse.urlsplit(url)
    key = f"{host.scheme}://{host.netloc}"
    rp = _robots.get(key)
    if rp is None:
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(key + "/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
                rp.parse(r.read().decode("utf-8", "replace").splitlines())
        except Exception:
            rp = None
        _robots[key] = rp or False
        rp = _robots[key]
    return True if rp is False else rp.can_fetch(UA, url)


def get_html(url):
    # 日本語のパス・クエリを含む URL は、符号化してから取る（urllib は ASCII しか送れない）
    url = urllib.parse.quote(url, safe=":/?&=%#+,;@~-._!$'()*")
    host = urllib.parse.urlsplit(url).netloc
    w = _last.get(host, 0) + 2.0 - time.time()
    if w > 0:
        time.sleep(w)
    _last[host] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, context=CTX, timeout=40) as r:
        ct = r.headers.get("content-type", "")
        if "html" not in ct:
            raise ValueError("html でない: " + ct)
        raw = r.read(3_000_000)
        final = r.geturl()
    m = re.search(r"charset=([\w-]+)", ct, re.I) or re.search(rb"charset=[\"']?([\w-]+)", raw[:4000])
    cs = (m.group(1) if isinstance(m.group(1), str) else m.group(1).decode()) if m else "utf-8"
    for enc in (cs, "utf-8", "cp932", "euc-jp"):
        try:
            return raw.decode(enc), final
        except Exception:
            continue
    return raw.decode("utf-8", "replace"), final


def read_page(url):
    body, final = get_html(url)
    p = TextParser()
    p.feed(body)
    return {"url": final, "title": re.sub(r"\s+", " ", p.title).strip(), "text": p.text()[:20000], "readAt": datetime.date.today().isoformat()}, p.links, final


def pick_links(base, links):
    bh = urllib.parse.urlsplit(base).netloc.replace("www.", "")
    scored, seen = [], {base.rstrip("/")}
    for href, text in links:
        if not href:
            continue
        u = urllib.parse.urljoin(base, href.split("#")[0])
        sp = urllib.parse.urlsplit(u)
        if sp.scheme != "https" or sp.netloc.replace("www.", "") != bh or u.rstrip("/") in seen:
            continue
        if BAD.search(text + " " + u):
            continue
        s = 3 if GOOD.search(text) else 1 if GOOD.search(sp.path) else 0
        if s:
            scored.append((s, len(sp.path), u))
            seen.add(u.rstrip("/"))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [u for _, _, u in scored[:3]]


targets = load("targets.json")
mats = load("materials.json", {})
todo = [t for t in targets if t["slug"] not in mats]
print("todo", len(todo), flush=True)
for i, t in enumerate(todo):
    m = {"wikipedia": None, "official": [], "skipped": []}
    try:
        d = wiki_api({"action": "query", "prop": "extracts|revisions", "explaintext": 1, "rvprop": "ids", "titles": t["wpTitle"], "redirects": 1})
        pg = d["query"]["pages"][0]
        m["wikipedia"] = {"title": pg.get("title"), "url": t["wpUrl"], "revid": (pg.get("revisions") or [{}])[0].get("revid"),
                          "text": pg.get("extract", ""), "readAt": datetime.date.today().isoformat()}
    except Exception as e:
        m["skipped"].append(f"Wikipedia: {e}")
    site = t["site"]
    try:
        if robots_ok(site):
            page, links, final = read_page(site)
            m["official"].append(page)
            for u in pick_links(final, links):
                try:
                    if not robots_ok(u):
                        m["skipped"].append(f"robots.txt が禁じる: {u}")
                        continue
                    pg2, _, _ = read_page(u)
                    m["official"].append(pg2)
                except Exception as e:
                    m["skipped"].append(f"{u}: {str(e)[:80]}")
        else:
            m["skipped"].append(f"robots.txt が禁じる: {site}")
    except Exception as e:
        m["skipped"].append(f"{site}: {str(e)[:80]}")
    mats[t["slug"]] = m
    if i % 5 == 0:
        save("materials.json", mats, indent=None)
        print(i, t["slug"], "wp", len((m["wikipedia"] or {}).get("text", "")), "公式", [len(p["text"]) for p in m["official"]], batchlib.STATS, flush=True)
save("materials.json", mats, indent=None)
print("done", len(mats), batchlib.STATS)
