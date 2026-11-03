import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/prepare-daily-world-spots.yml"

class PublicationWorkflowSafetyTests(unittest.TestCase):
    def test_scheduled_runs_cannot_publish(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("default: false", workflow)
        self.assertEqual(workflow.count("inputs.publish == true"), 1)
        self.assertEqual(workflow.count("github.event_name == 'workflow_dispatch'"), 1)

    def test_deployment_requires_successful_publication(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("gh workflow run deploy.yml --ref main", workflow)
        self.assertIn("git push origin HEAD:main", workflow)

if __name__ == "__main__":
    unittest.main()
