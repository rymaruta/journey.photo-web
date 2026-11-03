import json
import tempfile
import unittest
from pathlib import Path

from scripts.aggregate_world_spots import collect


class AggregateWorldSpotsTests(unittest.TestCase):
    def test_rejects_malformed_qids_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "a.json"
            second = Path(tmp) / "b.json"
            first.write_text(json.dumps({"spots": [
                {"wikidataId": "Q123", "name": "Original"},
                {"wikidataId": "Qabc", "name": "Invalid"},
                {"wikidataId": "Q0", "name": "Invalid"},
            ]}), encoding="utf-8")
            second.write_text(json.dumps({"spots": [
                {"wikidataId": "Q123", "name": "Duplicate"},
                {"wikidataId": "Q456", "name": "New"},
            ]}), encoding="utf-8")
            self.assertEqual([x["name"] for x in collect([second, first])["spots"]], ["Original", "New"])

    def test_invalid_snapshot_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "invalid.json"
            path.write_text('{"spots": {}}', encoding="utf-8")
            with self.assertRaises(ValueError):
                collect([path])


if __name__ == "__main__":
    unittest.main()
