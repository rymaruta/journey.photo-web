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
    def test_daily_limit(self):
        merged, stats = reconcile([], [spot("Q2"), spot("Q3")], max_new=1)
        self.assertEqual(len(merged), 1)
        self.assertEqual(stats["skipped"], 1)

if __name__ == "__main__":
    unittest.main()
