#!/usr/bin/env python3
"""Build conservative, source-backed editorial records from Wikipedia.

Only Wikipedia pages whose pageprops.wikibase_item matches the candidate QID
are eligible. No claim of human review is made.
"""
import argparse
import datetime
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from scripts.import_world_spots import COUNTRIES

USER_AGENT = "JourneyPhoto/1.2 (https://github.com/rymaruta/journey.photo-web)"
QID = re.compile(r"Q[1-9][0-9]*")


def api(url, params):
    request = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def verify(candidate):
    qid = candidate.get("wikidataId")
    if not isinstance(qid, str) or not QID.fullmatch(qid):
        return None
    if candidate.get("source") != "wikidata" or candidate.get("sourceUrl", "").replace("http://", "https://") != "https://www.wikidata.org/entity/" + qid:
        return None
    entity = api("https://www.wikidata.org/w/api.php", {
        "action": "wbgetentities", "ids": qid, "props": "sitelinks|claims", "format": "json"
    }).get("entities", {}).get(qid, {})
    claims = entity.get("claims", {})
    # Confirm that the candidate's coordinates and country match Wikidata.
    coordinates = candidate.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) != 2:
        return None
    coords = [statement.get("mainsnak", {}).get("datavalue", {}).get("value", {}) for statement in claims.get("P625", [])]
    if not any(isinstance(v, dict) and abs(v.get("longitude", 999) - coordinates[0]) < 0.0001 and abs(v.get("latitude", 999) - coordinates[1]) < 0.0001 for v in coords):
        return None
    country_ids = [statement.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id") for statement in claims.get("P17", [])]
    expected_country = dict(COUNTRIES).get(candidate.get("countryCode"))
    if not expected_country or expected_country not in country_ids:
        return None
    for language in ("ja", "en"):
        sitelink = entity.get("sitelinks", {}).get(language + "wiki")
        if not sitelink:
            continue
        title = sitelink["title"]
        data = api("https://" + language + ".wikipedia.org/w/api.php", {
            "action": "query", "prop": "extracts|pageprops", "exintro": 1,
            "explaintext": 1, "redirects": 1, "titles": title, "format": "json"
        })
        pages = list(data.get("query", {}).get("pages", {}).values())
        if len(pages) != 1 or pages[0].get("pageprops", {}).get("wikibase_item") != qid:
            continue
        summary = " ".join(pages[0].get("extract", "").split())
        if len(summary) < 80 or len(summary) > 12000:
            continue
        # Excerpt only; do not invent highlights or assert human verification.
        excerpt = summary[:450].rsplit("。", 1)[0] if language == "ja" else summary[:450].rsplit(". ", 1)[0]
        if len(excerpt) < 40:
            excerpt = summary[:450]
        source_url = "https://" + language + ".wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        return {
            "wikidataId": qid, "country": candidate.get("countryCode", ""),
            "summary": excerpt, "highlights": [title],
            "sources": [
                {"title": "Wikidata " + qid, "url": "https://www.wikidata.org/wiki/" + qid},
                {"title": "Wikipedia: " + title, "url": source_url}
            ],
            "verificationMode": "wikimedia-api", "checkedAt": datetime.date.today().isoformat(),
            "sourceLanguage": language, "attribution": "Wikipedia contributors (CC BY-SA 4.0)"
        }
    return None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--candidates", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--max-checks", type=int, default=30)
    args = p.parse_args()
    if not 1 <= args.max_checks <= 100:
        p.error("--max-checks must be between 1 and 100")
    spots = json.loads(args.candidates.read_text(encoding="utf-8"))["spots"]
    records = []
    # Rotate through the full candidate pool instead of rechecking the same first 30.
    start = (datetime.date.today().toordinal() * args.max_checks) % len(spots) if spots else 0
    batch = [spots[(start + index) % len(spots)] for index in range(min(len(spots), args.max_checks))]
    for candidate in batch:
        try:
            result = verify(candidate)
            if result:
                records.append(result)
        except (OSError, ValueError, KeyError, TypeError, OverflowError) as exc:
            print("Skipping candidate:", candidate.get("wikidataId"), type(exc).__name__, flush=True)
        time.sleep(0.2)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"checked": min(len(spots), args.max_checks), "verified": len(records)}))


if __name__ == "__main__":
    main()
