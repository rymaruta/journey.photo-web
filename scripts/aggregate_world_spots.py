#!/usr/bin/env python3
"""Combine collected Wikidata snapshots without losing provenance."""
import argparse
import json
from pathlib import Path

def collect(paths):
    unique = {}
    for path in sorted(paths):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("spots"), list):
            raise ValueError(f"invalid snapshot: {path}")
        for spot in payload["spots"]:
            if not isinstance(spot, dict):
                continue
            qid = spot.get("wikidataId")
            if isinstance(qid, str) and qid.startswith("Q") and qid not in unique:
                unique[qid] = spot
    return {"spots": list(unique.values())}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    paths = list(args.input_dir.glob("*.json"))
    if not paths:
        raise SystemExit("No collected snapshots; refusing to publish")
    data = collect(paths)
    if not data["spots"]:
        raise SystemExit("No candidates; refusing to publish")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Collected {len(data['spots'])} unique candidates from {len(paths)} snapshots")

if __name__ == "__main__":
    main()
