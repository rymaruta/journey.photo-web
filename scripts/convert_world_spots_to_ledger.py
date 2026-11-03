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
from pathlib import Path

def convert(candidate, editorial):
    qid = candidate.get("wikidataId")
    if not isinstance(qid, str) or not qid.startswith("Q"):
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
    if editorial.get("checked") is not True:
        return None
    today = datetime.date.today().isoformat()
    key = hashlib.sha256(qid.encode("ascii")).hexdigest()[:12]
    return {
        "spotId": "sp_" + key,
        "slug": "wikidata-" + qid.lower(),
        "name": name.strip(),
        "coords": {"lat": round(coords[1], 2), "lng": round(coords[0], 2)},
        "region": {"country": country.strip()},
        "summary": summary.strip(),
        "highlights": [h.strip() for h in highlights if isinstance(h, str) and h.strip()],
        "status": "published",
        "draftedAt": today,
        "draftedBy": "wikidata-import",
        "aiCheck": {"checkedAt": today, "delegatedBy": "Journey Photo owner", "sources": [{"url": s["url"], "title": s["title"]} for s in sources]},
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
    a = p.parse_args()
    for source in (a.candidates, a.editorial, a.existing):
        if not source.is_file():
            p.error(f"missing input: {source}")
        if a.output.resolve() == source.resolve():
            p.error("output cannot overwrite input")
    candidates = json.loads(a.candidates.read_text(encoding="utf-8"))["spots"]
    editorial = json.loads(a.editorial.read_text(encoding="utf-8"))
    existing = json.loads(a.existing.read_text(encoding="utf-8"))
    if not isinstance(existing, list) or not isinstance(editorial, list):
        p.error("invalid ledger or editorial format")
    by_qid = {e.get("wikidataId") for e in existing if isinstance(e, dict)}
    by_slug = {e.get("slug") for e in existing if isinstance(e, dict)}
    by_id = {e.get("spotId") for e in existing if isinstance(e, dict)}
    editorial_map = {e["wikidataId"]: e for e in editorial if isinstance(e, dict) and isinstance(e.get("wikidataId"), str)}
    inserted = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        spot = convert(candidate, editorial_map.get(candidate.get("wikidataId")))
        if spot is None or spot["wikidataId"] in by_qid or spot["slug"] in by_slug or spot["spotId"] in by_id:
            continue
        inserted.append(spot)
        by_qid.add(spot["wikidataId"])
        by_slug.add(spot["slug"])
        by_id.add(spot["spotId"])
    print(json.dumps({"eligible": len(inserted), "rejected_or_duplicate": len(candidates) - len(inserted)}))
    if a.write:
        a.output.parent.mkdir(parents=True, exist_ok=True)
        a.output.write_text(json.dumps(existing + inserted, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")

if __name__ == "__main__":
    main()
