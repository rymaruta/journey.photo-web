import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/prepare-daily-world-spots.yml"

class PublicationWorkflowSafetyTests(unittest.TestCase):
    def test_scheduled_runs_require_source_verification(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("default: false", workflow)
        self.assertEqual(workflow.count("inputs.publish == true"), 1)
        self.assertIn("github.event_name == 'schedule'", workflow)
        self.assertIn("scripts/verify_world_spot_sources.py", workflow)

    def test_publication_has_a_bounded_batch(self):
        converter = (ROOT / "scripts/convert_world_spots_to_ledger.py").read_text(encoding="utf-8")
        self.assertIn('default=100', converter)
        self.assertIn('len(inserted) >= a.max_new', converter)

    def test_deployment_requires_successful_publication(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("gh workflow run deploy.yml --ref main", workflow)
        self.assertIn("git push origin HEAD:main", workflow)

if __name__ == "__main__":
    unittest.main()
