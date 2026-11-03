#!/usr/bin/env python3
"""Stage and publish vetted Wikidata candidates without modifying existing spots.

This operates on local JSON snapshots only. Production DB integration is separate.
"""
import argparse
import datetime
import json
import math
import re
import os
from pathlib import Path

def valid(spot):
    coords = spot.get("coordinates")
    return (
        isinstance(spot.get("wikidataId"), str)
        and spot["wikidataId"].startswith("Q")
        and re.fullmatch(r"Q[1-9][0-9]*", spot["wikidataId"]) is not None
        and isinstance(spot.get("name"), str)
        and len(spot["name"].strip()) >= 2
        and isinstance(coords, list)
        and len(coords) == 2
        and all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in coords)
        and all(math.isfinite(n) for n in coords)
        and -180 <= coords[0] <= 180 and -90 <= coords[1] <= 90
        and spot.get("source") == "wikidata"
    )

def same_place_key(spot):
    """Conservative fallback for different Wikidata IDs at identical coordinates."""
    name = spot.get("name")
    coords = spot.get("coordinates")
    if not isinstance(name, str) or not isinstance(coords, list) or len(coords) != 2:
        return None
    if not all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) for n in coords):
        return None
    normalized_name = " ".join(name.casefold().split())
    if not normalized_name:
        return None
    return (normalized_name, coords[0], coords[1])

def reconcile(existing, candidates, max_new=None):
    """Immutable existing records; only new IDs are appended."""
    if max_new is not None and max_new < 0:
        raise ValueError("max_new must be nonnegative")
    by_id = {}
    for spot in existing:
        qid = spot.get("wikidataId")
        if not isinstance(qid, str) or not qid:
            raise ValueError("existing snapshot contains a record without Wikidata ID")
        if qid in by_id:
            continue
        by_id[qid] = dict(spot)
    place_keys = {key for spot in by_id.values() if (key := same_place_key(spot)) is not None}
    inserted, skipped, rejected = 0, 0, 0
    for spot in candidates:
        if not valid(spot):
            rejected += 1
            continue
        qid = spot["wikidataId"]
        place_key = same_place_key(spot)
        if qid in by_id or (place_key is not None and place_key in place_keys):
            skipped += 1
            continue
        if max_new is not None and inserted >= max_new:
            skipped += 1
            continue
        record = dict(spot)
        # External image URLs are never published unless the license is
        # explicitly approved and source/attribution are present.
        image = record.get("image")
        if image is not None:
            allowed = ("cc0", "cc-by", "public domain", "pdm")
            license_name = image.get("license", "").lower() if isinstance(image, dict) else ""
            if not (
                isinstance(image, dict)
                and isinstance(image.get("url"), str) and image["url"].startswith("https://")
                and isinstance(image.get("filePageUrl"), str) and image["filePageUrl"].startswith("https://")
                and any(license_name == item or license_name.startswith(item + " ") for item in allowed)
                and image.get("authorHtml") is not None
            ):
                record.pop("image", None)
        # Automated validation is not equivalent to human verification.
        record["reviewStatus"] = "auto_checked"
        record["publishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        by_id[qid] = record
        if place_key is not None:
            place_keys.add(place_key)
        inserted += 1
    return list(by_id.values()), {"inserted": inserted, "skipped": skipped, "rejected": rejected}

def read_spots(path):
    if not path.is_file():
        raise FileNotFoundError(f"spot snapshot missing: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("spots"), list) or any(not isinstance(s, dict) for s in data["spots"]):
        raise ValueError(f"invalid spot snapshot: {path}")
    return data["spots"]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--existing", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-new", type=int, default=None, help="Optional safety limit; by default publish all valid new spots")
    parser.add_argument("--write", action="store_true", help="Explicitly write snapshot; otherwise dry run")
    args = parser.parse_args()
    existing = read_spots(args.existing)
    candidates = []
    for path in args.candidates:
        candidates.extend(read_spots(path))
    protected = [args.existing, *args.candidates]
    if any(args.output.resolve() == source.resolve() for source in protected):
        raise ValueError("output must differ from all input snapshots to protect source data")
    merged, summary = reconcile(existing, candidates, args.max_new)
    print(json.dumps(summary, ensure_ascii=False))
    if not args.write:
        print("DRY RUN: no data written")
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.output.with_suffix(args.output.suffix + ".tmp")
    tmp.write_text(json.dumps({"count": len(merged), "spots": merged}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, args.output)

if __name__ == "__main__":
    main()
