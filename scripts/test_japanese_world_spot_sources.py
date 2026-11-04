import unittest
from unittest.mock import patch
from scripts import verify_world_spot_sources as source


class JapaneseSpotVerificationTests(unittest.TestCase):
    def test_japanese_article_and_country_match(self):
        candidate = {
            "wikidataId": "Q999", "countryCode": "JP",
            "coordinates": [139.7, 35.6], "source": "wikidata",
            "sourceUrl": "https://www.wikidata.org/entity/Q999",
        }
        entity = {"entities": {"Q999": {
            "claims": {
                "P625": [{"mainsnak": {"datavalue": {"value": {"longitude": 139.7, "latitude": 35.6}}}}],
                "P17": [{"mainsnak": {"datavalue": {"value": {"id": "Q17"}}}}],
            },
            "sitelinks": {"jawiki": {"title": "テスト地点"}},
        }}}
        page = {"query": {"pages": {"1": {
            "pageprops": {"wikibase_item": "Q999"},
            "extract": "これは撮影スポットに関する説明文です。" * 12,
        }}}}
        with patch.object(source, "api", side_effect=[entity, page]):
            result = source.verify(candidate)
        self.assertIsNotNone(result)
        self.assertEqual(result["country"], "JP")
        self.assertEqual(result["sourceLanguage"], "ja")
        self.assertIn("ja.wikipedia.org", result["sources"][1]["url"])

    def test_japanese_article_identity_mismatch_rejected(self):
        candidate = {
            "wikidataId": "Q999", "countryCode": "JP",
            "coordinates": [139.7, 35.6], "source": "wikidata",
            "sourceUrl": "https://www.wikidata.org/entity/Q999",
        }
        entity = {"entities": {"Q999": {
            "claims": {
                "P625": [{"mainsnak": {"datavalue": {"value": {"longitude": 139.7, "latitude": 35.6}}}}],
                "P17": [{"mainsnak": {"datavalue": {"value": {"id": "Q17"}}}}],
            },
            "sitelinks": {"jawiki": {"title": "テスト地点"}},
        }}}
        page = {"query": {"pages": {"1": {
            "pageprops": {"wikibase_item": "Q123"},
            "extract": "これは撮影スポットに関する説明文です。" * 12,
        }}}}
        with patch.object(source, "api", side_effect=[entity, page]):
            self.assertIsNone(source.verify(candidate))


if __name__ == "__main__":
    unittest.main()
