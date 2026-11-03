import unittest
import tempfile
from pathlib import Path
from scripts.publish_spot_candidates import read_spots
from scripts.publish_spot_candidates import reconcile

def spot(qid, name="Kyoto Temple"):
    return {"wikidataId": qid, "name": name, "coordinates": [135.7, 35.0], "source": "wikidata"}

class PublishTests(unittest.TestCase):
    def test_existing_is_untouched(self):
        old = {**spot("Q1", "User edited"), "image": {"url": "user.jpg"}, "reviewStatus": "published"}
        merged, stats = reconcile([old], [spot("Q1", "External"), {**spot("Q2"), "coordinates": [135.8, 35.0]}])
        self.assertEqual(merged[0], old)
        self.assertEqual(stats["inserted"], 1)
        self.assertEqual(stats["skipped"], 1)
    def test_duplicates_and_invalid_are_rejected(self):
        merged, stats = reconcile([], [spot("Q2"), spot("Q2"), spot("invalid")])
        self.assertEqual(len(merged), 1)
        self.assertEqual(stats, {"inserted": 1, "skipped": 1, "rejected": 1})
    def test_invalid_coordinates_and_duplicate_existing_are_skipped(self):
        invalid = spot("Q4")
        invalid["coordinates"] = [float("nan"), 35]
        merged, stats = reconcile([], [invalid])
        self.assertEqual(merged, [])
        self.assertEqual(stats["rejected"], 1)
        merged, stats = reconcile([spot("Q1"), spot("Q1")], [spot("Q1"), {**spot("Q2"), "coordinates": [135.8, 35.0]}])
        self.assertEqual(len(merged), 3)
        self.assertEqual(stats["inserted"], 1)
        self.assertEqual(stats["skipped"], 1)

    def test_unlicensed_image_is_not_published(self):
        candidate = spot("Q2")
        candidate["image"] = {"url": "https://example.com/a.jpg", "license": "unknown"}
        merged, _ = reconcile([], [candidate])
        self.assertNotIn("image", merged[0])

    def test_publish_all_800_new_from_1000(self):
        existing = [{**spot(f"Q{i}"), "coordinates": [135.7 + i * 0.001, 35.0]} for i in range(1, 201)]
        candidates = [{**spot(f"Q{i}"), "coordinates": [135.7 + i * 0.001, 35.0]} for i in range(1, 1001)]
        merged, stats = reconcile(existing, candidates)
        self.assertEqual(len(merged), 1000)
        self.assertEqual(stats, {"inserted": 800, "skipped": 200, "rejected": 0})

    def test_same_name_and_coordinates_with_different_id_skipped(self):
        merged, stats = reconcile([spot("Q1")], [spot("Q2")])
        self.assertEqual(len(merged), 1)
        self.assertEqual(stats["skipped"], 1)

    def test_legacy_existing_without_wikidata_id_is_preserved(self):
        legacy = {"spotId": "sp_abc", "name": "User maintained spot"}
        merged, stats = reconcile([legacy], [spot("Q9")])
        self.assertEqual(merged[0], legacy)
        self.assertEqual(stats["inserted"], 1)

    def test_missing_snapshot_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(FileNotFoundError):
                read_spots(Path(folder) / "missing.json")

    def test_optional_limit(self):
        merged, stats = reconcile([], [spot("Q2"), {**spot("Q3"), "coordinates": [135.8, 35.0]}], max_new=1)
        self.assertEqual(len(merged), 1)
        self.assertEqual(stats["skipped"], 1)

if __name__ == "__main__":
    unittest.main()
