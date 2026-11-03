#!/usr/bin/env python3
"""Fetch a bounded batch of world landmark candidates from Wikidata.

Country rotation is controlled by GitHub Actions. Output is review-only.
"""
import argparse
import json
import html
import pathlib
import random
import email.utils
import datetime
import re
import time
import urllib.error
import urllib.parse
import urllib.request

COUNTRIES = [
    ("JP", "Q17"), ("US", "Q30"), ("FR", "Q142"), ("IT", "Q38"),
    ("GB", "Q145"), ("DE", "Q183"), ("ES", "Q29"), ("CH", "Q39"),
    ("CA", "Q16"), ("AU", "Q408"), ("NZ", "Q664"), ("KR", "Q884"),
    ("CN", "Q148"), ("IN", "Q668"), ("TH", "Q869"), ("VN", "Q881"),
    ("ID", "Q252"), ("MY", "Q833"), ("SG", "Q334"), ("PH", "Q928"),
    ("BR", "Q155"), ("MX", "Q96"), ("AR", "Q414"), ("CL", "Q298"),
    ("ZA", "Q258"), ("EG", "Q79"), ("MA", "Q1028"), ("KE", "Q114"),
    ("TR", "Q43"), ("GR", "Q41"), ("NO", "Q20"), ("SE", "Q34"),
    ("FI", "Q33"), ("IS", "Q189"), ("DK", "Q35"), ("NL", "Q55"),
    ("BE", "Q31"), ("AT", "Q40"), ("PT", "Q45"), ("PL", "Q36"),
    ("CZ", "Q213"), ("HR", "Q224"), ("HU", "Q28"), ("IE", "Q27"),
    ("AE", "Q878"), ("SA", "Q851"), ("IL", "Q801"), ("PE", "Q419"),
]
# Narrow direct types keep queries bounded and avoid expensive subclass traversals.
TYPES = ["Q570116", "Q23413", "Q33506", "Q46169", "Q34038", "Q8502", "Q23397"]
ENDPOINT = "https://query.wikidata.org/sparql"

def retry_delay(headers, attempt):
    value = headers.get("Retry-After")
    if value:
        try:
            seconds = float(value)
        except ValueError:
            try:
                target = email.utils.parsedate_to_datetime(value)
                seconds = (target - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                seconds = 0
        if seconds > 0:
            return min(seconds, 600)
    return min(180, 10 * 2 ** attempt + random.uniform(0, 5))


def fetch(country, limit, offset):
    types = " ".join("wd:" + x for x in TYPES)
    query = f"""SELECT DISTINCT ?item ?itemLabel ?coord ?image ?commonsCategory WHERE {{
      VALUES ?kind {{ {types} }}
      ?item wdt:P31 ?kind; wdt:P17 wd:{country}; wdt:P625 ?coord.
      OPTIONAL {{ ?item wdt:P18 ?image. }}
      OPTIONAL {{ ?item wdt:P373 ?commonsCategory. }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ja,en". }}
    }} ORDER BY ?item LIMIT {limit} OFFSET {offset}"""
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(url, headers={
        "Accept": "application/sparql-results+json",
        "User-Agent": "JourneyPhoto/1.1 (https://github.com/rymaruta/journey.photo-web; contact via issues)",
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=55) as response:
                return json.load(response)["results"]["bindings"]
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504):
                raise
            if attempt == 2:
                raise
            wait = retry_delay(exc.headers, attempt)
            print(f"HTTP {exc.code}: cooling down {wait:.1f}s", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 2:
                raise
            wait = retry_delay({}, attempt)
            print(f"Network error: cooling down {wait:.1f}s", flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
ALLOWED_LICENSES = ("cc0", "cc-by", "public domain", "pdm")


def commons_request(params):
    url = COMMONS_API + "?" + urllib.parse.urlencode(dict(params, format="json", formatversion=2))
    req = urllib.request.Request(url, headers={
        "User-Agent": "JourneyPhoto/1.1 (https://github.com/rymaruta/journey.photo-web; contact via issues)",
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
            time.sleep(retry_delay(exc.headers, attempt))
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(retry_delay({}, attempt))
    raise RuntimeError("Commons request failed")


def file_metadata(title):
    response = commons_request({
        "action": "query", "titles": title, "prop": "imageinfo",
        "iiprop": "url|size|extmetadata", "iiurlwidth": 960,
    })
    pages = response.get("query", {}).get("pages", [])
    info = pages[0].get("imageinfo", [{}])[0] if pages else {}
    ext = info.get("extmetadata", {})
    license_name = html.unescape(ext.get("LicenseShortName", {}).get("value", ""))
    license_url = ext.get("LicenseUrl", {}).get("value", "")
    author = ext.get("Artist", {}).get("value", "")
    if not info.get("descriptionurl") or not license_name:
        return None
    if not any(token in license_name.lower() for token in ALLOWED_LICENSES):
        return None
    return {
        "url": info.get("thumburl") or info.get("url"),
        "filePageUrl": info["descriptionurl"],
        "authorHtml": author,
        "license": license_name,
        "licenseUrl": license_url,
        "width": info.get("width"),
        "height": info.get("height"),
    }


def image_for_spot(row, max_fallback=True):
    # First priority: Wikidata P18; second: a file from its Commons category.
    p18 = row.get("image", {}).get("value")
    if p18:
        title = "File:" + urllib.parse.unquote(p18.rsplit("/", 1)[-1]).replace("_", " ")
        image = file_metadata(title)
        if image:
            return dict(image, source="wikidata_p18")
    category = row.get("commonsCategory", {}).get("value")
    if not category or not max_fallback:
        return None
    response = commons_request({
        "action": "query", "generator": "categorymembers",
        "gcmtitle": "Category:" + category, "gcmtype": "file",
        "gcmlimit": 5, "prop": "imageinfo",
        "iiprop": "url|size|extmetadata", "iiurlwidth": 960,
    })
    for page in response.get("query", {}).get("pages", []):
        info = page.get("imageinfo", [{}])[0]
        ext = info.get("extmetadata", {})
        license_name = html.unescape(ext.get("LicenseShortName", {}).get("value", ""))
        if not any(token in license_name.lower() for token in ALLOWED_LICENSES):
            continue
        if not info.get("descriptionurl"):
            continue
        return {
            "url": info.get("thumburl") or info.get("url"),
            "filePageUrl": info["descriptionurl"],
            "authorHtml": ext.get("Artist", {}).get("value", ""),
            "license": license_name,
            "licenseUrl": ext.get("LicenseUrl", {}).get("value", ""),
            "width": info.get("width"), "height": info.get("height"),
            "source": "commons_category",
        }
    return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--slot", type=int, required=True)
    p.add_argument("--limit", type=int, default=250)
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--image-limit", type=int, default=15)
    p.add_argument("--output-dir", default="data/imports/world")
    a = p.parse_args()
    if a.slot < 0 or not 1 <= a.limit <= 500 or a.offset < 0 or not 0 <= a.image_limit <= 50:
        p.error("invalid slot, limit or offset")
    code, country = COUNTRIES[a.slot % len(COUNTRIES)]
    records = {}
    image_requests = 0
    for row in fetch(country, a.limit, a.offset):
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        name = row["itemLabel"]["value"].strip()
        match = re.fullmatch(r"Point\((-?[\d.]+) (-?[\d.]+)\)", row["coord"]["value"])
        if not match or not re.fullmatch(r"Q\d+", qid) or name == qid:
            continue
        lon, lat = map(float, match.groups())
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            continue
        image = None
        if image_requests < a.image_limit:
            try:
                image = image_for_spot(row)
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                print(f"Image lookup failed for {qid}: {exc}", flush=True)
            image_requests += 1
            time.sleep(1)
        records[qid] = {
            "wikidataId": qid, "name": name, "coordinates": [lon, lat],
            "countryCode": code, "source": "wikidata",
            "sourceUrl": row["item"]["value"], "reviewStatus": "pending",
            "image": image,
        }
    out = pathlib.Path(a.output_dir) / f"{code.lower()}-{a.offset}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"country": code, "offset": a.offset, "count": len(records),
                               "status": "review_required", "spots": list(records.values())},
                              ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{code}: {len(records)} candidates at offset {a.offset}; output {out}")

if __name__ == "__main__":
    main()
