#!/usr/bin/env python3
"""Fetch a bounded batch of world landmark candidates from Wikidata.

Country rotation is controlled by GitHub Actions. Output is review-only.
"""
import argparse
import json
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
    query = f"""SELECT DISTINCT ?item ?itemLabel ?coord WHERE {{
      VALUES ?kind {{ {types} }}
      ?item wdt:P31 ?kind; wdt:P17 wd:{country}; wdt:P625 ?coord.
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

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--slot", type=int, required=True)
    p.add_argument("--limit", type=int, default=250)
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--output-dir", default="data/imports/world")
    a = p.parse_args()
    if a.slot < 0 or not 1 <= a.limit <= 500 or a.offset < 0:
        p.error("invalid slot, limit or offset")
    code, country = COUNTRIES[a.slot % len(COUNTRIES)]
    records = {}
    for row in fetch(country, a.limit, a.offset):
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        name = row["itemLabel"]["value"].strip()
        match = re.fullmatch(r"Point\((-?[\d.]+) (-?[\d.]+)\)", row["coord"]["value"])
        if not match or not re.fullmatch(r"Q\d+", qid) or name == qid:
            continue
        lon, lat = map(float, match.groups())
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            continue
        records[qid] = {
            "wikidataId": qid, "name": name, "coordinates": [lon, lat],
            "countryCode": code, "source": "wikidata",
            "sourceUrl": row["item"]["value"], "reviewStatus": "pending",
        }
    out = pathlib.Path(a.output_dir) / f"{code.lower()}-{a.offset}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"country": code, "offset": a.offset, "count": len(records),
                               "status": "review_required", "spots": list(records.values())},
                              ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{code}: {len(records)} candidates at offset {a.offset}; output {out}")

if __name__ == "__main__":
    main()
