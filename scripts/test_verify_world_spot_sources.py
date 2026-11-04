import unittest
from unittest.mock import patch
from scripts import verify_world_spot_sources as source


class SourceVerificationTests(unittest.TestCase):
    def setUp(self):
        self.candidate = {
            "wikidataId": "Q243", "name": "Eiffel Tower",
            "countryCode": "FR", "coordinates": [2.2945, 48.8584],
            "source": "wikidata", "sourceUrl": "http://www.wikidata.org/entity/Q243"
        }
        self.entity = {"entities": {"Q243": {
            "claims": {
                "P625": [{"mainsnak": {"datavalue": {"value": {"longitude": 2.2945, "latitude": 48.8584}}}}],
                "P17": [{"mainsnak": {"datavalue": {"value": {"id": "Q142"}}}}]
            },
            "sitelinks": {"enwiki": {"title": "Eiffel Tower"}}
        }}}
        self.page = {"query": {"pages": {"1": {
            "pageprops": {"wikibase_item": "Q243"},
            "extract": "The Eiffel Tower is a landmark in Paris. " * 5
        }}}}

    def test_verified_article_creates_source_backed_editorial(self):
        with patch.object(source, "api", side_effect=[self.entity, self.page]):
            result = source.verify(self.candidate)
        self.assertEqual(result["wikidataId"], "Q243")
        self.assertEqual(result["verificationMode"], "wikimedia-api")
        self.assertEqual(len(result["sources"]), 2)

    def test_mismatched_wikipedia_identity_is_rejected(self):
        self.page["query"]["pages"]["1"]["pageprops"]["wikibase_item"] = "Q999"
        with patch.object(source, "api", side_effect=[self.entity, self.page]):
            self.assertIsNone(source.verify(self.candidate))

    def test_mismatched_country_is_rejected(self):
        self.candidate["countryCode"] = "JP"
        with patch.object(source, "api", return_value=self.entity):
            self.assertIsNone(source.verify(self.candidate))

    def test_mismatched_coordinates_are_rejected(self):
        self.candidate["coordinates"] = [10.0, 10.0]
        with patch.object(source, "api", return_value=self.entity):
            self.assertIsNone(source.verify(self.candidate))

    def test_missing_source_is_rejected(self):
        self.candidate["source"] = "untrusted"
        with patch.object(source, "api") as api:
            self.assertIsNone(source.verify(self.candidate))
            api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
