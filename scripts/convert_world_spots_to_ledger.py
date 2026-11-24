#!/usr/bin/env python3
"""Convert vetted Wikidata candidates to the existing Journey Photo spot ledger.

Only records with independently sourced editorial content qualify for publication.
Never fabricate descriptions, human verification, or an AI check.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path

def convert(candidate, editorial):
    qid = candidate.get("wikidataId")
    if not isinstance(qid, str) or not re.fullmatch(r"Q[1-9][0-9]*", qid):
        return None
    name = candidate.get("name")
    coords = candidate.get("coordinates")
    if not isinstance(name, str) or len(name.strip()) < 2 or not isinstance(coords, list) or len(coords) != 2:
        return None
    if not all(isinstance(n, (float, int)) and not isinstance(n, bool) and math.isfinite(n) for n in coords):
        return None
    if not (-180 <= coords[0] <= 180 and -90 <= coords[1] <= 90):
        return None
    if not isinstance(editorial, dict) or editorial.get("wikidataId") != qid:
        return None
    summary = editorial.get("summary")
    highlights = editorial.get("highlights")
    country = editorial.get("country")
    sources = editorial.get("sources")
    if not isinstance(summary, str) or len(summary.strip()) < 40:
        return None
    if not isinstance(highlights, list) or not any(isinstance(h, str) and h.strip() for h in highlights):
        return None
    if not isinstance(country, str) or not country.strip():
        return None
    if not isinstance(sources, list) or not sources or not all(isinstance(s, dict) and isinstance(s.get("url"), str) and s["url"].startswith("https://") and isinstance(s.get("title"), str) and s["title"].strip() for s in sources):
        return None
    # The editorial record must contain an explicit check; a source URL alone
    # does not establish that a factual claim was verified.
    if editorial.get("checked") is not True or not isinstance(editorial.get("checkedAt"), str) or not editorial["checkedAt"].strip() or not isinstance(editorial.get("delegatedBy"), str) or not editorial["delegatedBy"].strip():
        return None
    # Reject malformed or future editorial review dates.
    try:
        checked_date = datetime.date.fromisoformat(editorial["checkedAt"])
    except ValueError:
        return None
    if checked_date > datetime.date.today():
        return None
    today = datetime.date.today().isoformat()
    key = hashlib.sha256(qid.encode("ascii")).hexdigest()[:12]
    return {
        "spotId": "sp_" + key,
        "slug": "wikidata-" + qid.lower(),
        "name": name.strip(),
        "coords": {"lat": round(coords[1], 6), "lng": round(coords[0], 6)},
        "region": {"country": country.strip()},
        "summary": summary.strip(),
        "highlights": [h.strip() for h in highlights if isinstance(h, str) and h.strip()],
        "status": "published",
        "draftedAt": today,
        "draftedBy": "wikidata-import",
        "aiCheck": {"checkedAt": editorial["checkedAt"], "delegatedBy": editorial["delegatedBy"], "sources": [{"url": s["url"], "title": s["title"]} for s in sources]},
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "wikidataId": qid,
    }

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--candidates", type=Path, required=True)
    p.add_argument("--editorial", type=Path, required=True)
    p.add_argument("--existing", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--write", action="store_true")
    p.add_argument("--max-new", type=int, default=100, help="Maximum new spots per run; default 100")
    a = p.parse_args()
    if a.max_new < 0:
        p.error("--max-new must be nonnegative")
    for source in (a.candidates, a.editorial, a.existing):
        if not source.is_file():
            p.error(f"missing input: {source}")
        if a.output.resolve() == source.resolve():
            p.error("output cannot overwrite input")
    candidates = json.loads(a.candidates.read_text(encoding="utf-8"))["spots"]
    editorial = json.loads(a.editorial.read_text(encoding="utf-8"))
    existing = json.loads(a.existing.read_text(encoding="utf-8"))
    if not isinstance(existing, list) or not isinstance(editorial, list) or not isinstance(candidates, list) or any(not isinstance(e, dict) for e in existing):
        p.error("invalid ledger or editorial format")
    by_qid = {e.get("wikidataId") for e in existing if isinstance(e, dict)}
    by_slug = {e.get("slug") for e in existing if isinstance(e, dict)}
    by_id = {e.get("spotId") for e in existing if isinstance(e, dict)}
    def place_key(item):
        name = item.get("name")
        coords = item.get("coords")
        if not isinstance(name, str) or not isinstance(coords, dict):
            return None
        lat, lng = coords.get("lat"), coords.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            return None
        return (" ".join(name.casefold().split()), round(lat, 4), round(lng, 4))
    by_place = {key for e in existing if (key := place_key(e)) is not None}
    editorial_map = {e["wikidataId"]: e for e in editorial if isinstance(e, dict) and isinstance(e.get("wikidataId"), str)}
    inserted = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        spot = convert(candidate, editorial_map.get(candidate.get("wikidataId")))
        if spot is None or spot["wikidataId"] in by_qid or spot["slug"] in by_slug or spot["spotId"] in by_id or place_key(spot) in by_place:
            continue
        if len(inserted) >= a.max_new:
            break
        inserted.append(spot)
        by_qid.add(spot["wikidataId"])
        by_slug.add(spot["slug"])
        by_id.add(spot["spotId"])
        by_place.add(place_key(spot))
    print(json.dumps({"eligible": len(inserted), "rejected_or_duplicate": len(candidates) - len(inserted)}))
    if a.write:
        a.output.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".spots-", suffix=".json", dir=a.output.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                json.dump(existing + inserted, out, ensure_ascii=False, indent=2)
                out.write("\n")
            os.replace(tmp, a.output)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

if __name__ == "__main__":
    main()
