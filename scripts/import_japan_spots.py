#!/usr/bin/env python3
"""Import Japanese landmarks from Wikidata into a reviewable JSON snapshot.

Usage: python3 scripts/import_japan_spots.py --limit 5000
No production database is changed. Review the output before publishing.
"""
import argparse
import json
import os
import pathlib
import time
import urllib.parse
import urllib.request

ENDPOINT = "https://query.wikidata.org/sparql"
CLASSES = {
    "Q570116": "tourist_attraction",
    "Q839954": "archaeological_site",
    "Q23413": "castle",
    "Q44539": "temple",
    "Q16970": "church",
    "Q12280": "bridge",
    "Q33506": "museum",
    "Q46169": "national_park",
    "Q3375722": "natural_monument",
    "Q35509": "cave",
    "Q34038": "waterfall",
    "Q8502": "mountain",
    "Q4022": "river",
    "Q23397": "lake",
    "Q54050": "hill",
    "Q24354": "theater",
    "Q4989906": "monument",
}
# Fetch only items explicitly located in Japan with coordinates. This is a
# candidate pool, not a guarantee of public access or photography suitability.
QUERY = """
SELECT DISTINCT ?item ?itemLabel ?coord ?article WHERE {
  VALUES ?kind { %s }
  ?item wdt:P31/wdt:P279* ?kind ;
        wdt:P17 wd:Q17 ;
        wdt:P625 ?coord .
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://ja.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}
ORDER BY ?item
LIMIT %d OFFSET %d
"""

def request_json(query, retries=4):
    params = urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(
        ENDPOINT + "?" + params,
        headers={
            "Accept": "application/sparql-results+json",
            "User-Agent": "JourneyPhotoSpotImporter/0.1 (public geographic dataset; contact via project repository)",
        },
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                return json.load(response)
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(min(60, 3 * 2 ** attempt))

def parse_point(value):
    # Wikidata SPARQL coordinate literal: Point(longitude latitude)
    if not value.startswith("Point(") or not value.endswith(")"):
        return None
    try:
        lon, lat = map(float, value[6:-1].split())
    except (ValueError, TypeError):
        return None
    if not (20 <= lat <= 46 and 122 <= lon <= 154):
        return None
    return [lon, lat]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--page-size", type=int, default=250)
    parser.add_argument("--output", default="data/imports/japan-wikidata-spots.json")
    parser.add_argument("--delay", type=float, default=2.0)
    args = parser.parse_args()
    if args.limit < 1 or args.page_size < 1 or args.page_size > 500:
        parser.error("limit must be positive; page-size must be 1..500")
    existing = {}
    output = pathlib.Path(args.output)
    if output.exists():
        old = json.loads(output.read_text(encoding="utf-8"))
        existing = {s["wikidataId"]: s for s in old.get("spots", [])}
    spots = dict(existing)
    offset = 0
    kinds = " ".join("wd:" + key for key in CLASSES)
    while len(spots) < args.limit:
        query = QUERY % (kinds, args.page_size, offset)
        rows = request_json(query)["results"]["bindings"]
        if not rows:
            break
        for row in rows:
            item = row["item"]["value"]
            qid = item.rsplit("/", 1)[-1]
            coords = parse_point(row["coord"]["value"])
            label = row["itemLabel"]["value"].strip()
            if not coords or not qid.startswith("Q") or not label or label == qid:
                continue
            article = row.get("article", {}).get("value")
            # Wikidata attribution is preserved; Wikipedia text/images are NOT copied.
            spots[qid] = {
                "wikidataId": qid,
                "name": label,
                "coordinates": coords,
                "wikipediaUrl": article,
                "sourceUrl": item,
                "source": "wikidata",
                "reviewStatus": "pending",
            }
            if len(spots) >= args.limit:
                break
        offset += args.page_size
        print(f"Fetched {offset} rows; {len(spots)} unique candidates", flush=True)
        time.sleep(max(args.delay, 0))
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 1,
        "status": "review_required",
        "license": "CC0 (Wikidata structured data); Wikipedia links only",
        "count": len(spots),
        "spots": sorted(spots.values(), key=lambda x: x["wikidataId"]),
    }
    temp = output.with_suffix(output.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, output)
    print(f"Saved {len(spots)} candidates to {output}")

if __name__ == "__main__":
    main()
