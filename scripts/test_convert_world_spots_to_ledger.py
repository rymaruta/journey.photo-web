import unittest
import datetime
from scripts.convert_world_spots_to_ledger import convert

class ConversionTests(unittest.TestCase):
    def setUp(self):
        self.candidate = {"wikidataId": "Q123", "name": "Historic Landmark", "coordinates": [139.75, 35.68]}
        self.editorial = {"wikidataId": "Q123", "country": "日本", "summary": "歴史的な景観が残る撮影地として知られ、周辺の建築物や自然環境を含む風景を楽しめる場所です。撮影前に現地の案内を確認してください。", "highlights": ["歴史的な建築"], "sources": [{"url": "https://www.wikidata.org/wiki/Q123", "title": "Wikidata"}], "checked": True, "checkedAt": datetime.date.today().isoformat(), "delegatedBy": "Owner"}

    def test_checked_candidate_is_converted(self):
        spot = convert(self.candidate, self.editorial)
        self.assertIsNotNone(spot)
        self.assertEqual(spot["coords"], {"lat": 35.68, "lng": 139.75})
        self.assertNotIn("verifiedBy", spot)

    def test_missing_check_is_not_published(self):
        self.editorial["checked"] = False
        self.assertIsNone(convert(self.candidate, self.editorial))

    def test_missing_delegation_is_not_published(self):
        del self.editorial["delegatedBy"]
        self.assertIsNone(convert(self.candidate, self.editorial))

    def test_invalid_review_date_is_rejected(self):
        self.editorial["checkedAt"] = "not-a-date"
        self.assertIsNone(convert(self.candidate, self.editorial))

    def test_future_review_date_is_rejected(self):
        self.editorial["checkedAt"] = "2099-01-01"
        self.assertIsNone(convert(self.candidate, self.editorial))

    def test_auto_verified_requires_attribution(self):
        self.editorial["verificationMode"] = "wikimedia-api"
        self.editorial["sources"].append({"url": "https://en.wikipedia.org/wiki/Eiffel_Tower", "title": "Wikipedia"})
        self.assertIsNone(convert(self.candidate, self.editorial))
        self.editorial["attribution"] = "Wikipedia contributors (CC BY-SA 4.0)"
        spot = convert(self.candidate, self.editorial)
        self.assertIsNotNone(spot)
        self.assertEqual(spot["attribution"], self.editorial["attribution"])

    def test_missing_editorial_is_not_published(self):
        self.assertIsNone(convert(self.candidate, None))

    def test_invalid_coordinates_are_not_published(self):
        self.candidate["coordinates"] = [float("nan"), 35]
        self.assertIsNone(convert(self.candidate, self.editorial))

if __name__ == "__main__":
    unittest.main()
