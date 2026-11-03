import unittest
from scripts.publish_spot_candidates import reconcile

def spot(qid, name="Kyoto Temple"):
    return {"wikidataId": qid, "name": name, "coordinates": [135.7, 35.0], "source": "wikidata"}

class PublishTests(unittest.TestCase):
    def test_existing_is_untouched(self):
        old = {**spot("Q1", "User edited"), "image": {"url": "user.jpg"}, "reviewStatus": "published"}
        merged, stats = reconcile([old], [spot("Q1", "External"), spot("Q2")])
        self.assertEqual(merged[0], old)
        self.assertEqual(stats["inserted"], 1)
        self.assertEqual(stats["skipped"], 1)
    def test_duplicates_and_invalid_are_rejected(self):
        merged, stats = reconcile([], [spot("Q2"), spot("Q2"), spot("invalid")])
        self.assertEqual(len(merged), 1)
        self.assertEqual(stats, {"inserted": 1, "skipped": 1, "rejected": 1})
    def test_invalid_coordinates_and_duplicate_existing_fail_closed(self):
        invalid = spot("Q4")
        invalid["coordinates"] = [float("nan"), 35]
        merged, stats = reconcile([], [invalid])
        self.assertEqual(merged, [])
        self.assertEqual(stats["rejected"], 1)
        with self.assertRaises(ValueError):
            reconcile([spot("Q1"), spot("Q1")], [spot("Q2")])

    def test_unlicensed_image_is_not_published(self):
        candidate = spot("Q2")
        candidate["image"] = {"url": "https://example.com/a.jpg", "license": "unknown"}
        merged, _ = reconcile([], [candidate])
        self.assertNotIn("image", merged[0])

    def test_daily_limit(self):
        merged, stats = reconcile([], [spot("Q2"), spot("Q3")], max_new=1)
        self.assertEqual(len(merged), 1)
        self.assertEqual(stats["skipped"], 1)

if __name__ == "__main__":
    unittest.main()
