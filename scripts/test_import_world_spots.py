import pathlib
import sys
import tempfile
import unittest
from unittest import mock

from scripts import import_world_spots as iws

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/import-world-spots.yml"

# 2026-11-15 に Wikidata で数えた、fetch() と同じ条件の件数（journey.photo-ios#614）。
# 固定の offset 3000 では、どちらも 0 件になっていた。
DK_TOTAL = 840
NL_TOTAL = 1526
LIMIT = 250
# 2026-11-13、14 の回の「何周目か」（tick 20770、20771 を 48 で割った商 432）。古い式ではこの周が offset 3000 になった。
CYCLE_2026_11_13 = 20770 // 48


class RotatingOffsetTests(unittest.TestCase):
    def test_offset_stays_inside_small_countries(self):
        for total in (DK_TOTAL, NL_TOTAL):
            for cycle in range(0, 60):
                offset = iws.rotating_offset(cycle, total, LIMIT)
                self.assertLess(offset, total, (total, cycle))
                self.assertEqual(offset % LIMIT, 0)

    def test_failed_days_now_get_an_offset_inside_the_country(self):
        self.assertEqual(iws.rotating_offset(CYCLE_2026_11_13, DK_TOTAL, LIMIT) % LIMIT, 0)
        self.assertLess(iws.rotating_offset(CYCLE_2026_11_13, DK_TOTAL, LIMIT), DK_TOTAL)
        self.assertLess(iws.rotating_offset(CYCLE_2026_11_13, NL_TOTAL, LIMIT), NL_TOTAL)

    def test_every_page_of_a_country_is_visited(self):
        pages = {iws.rotating_offset(c, NL_TOTAL, LIMIT) for c in range(7)}
        self.assertEqual(pages, {0, 250, 500, 750, 1000, 1250, 1500})

    def test_empty_country_uses_zero(self):
        self.assertEqual(iws.rotating_offset(5, 0, LIMIT), 0)

    def test_cycle_uses_counted_total_when_fetching(self):
        for slot, total in ((34, DK_TOTAL), (35, NL_TOTAL)):
            with tempfile.TemporaryDirectory() as tmp, \
                    mock.patch.object(iws, "count_items", return_value=total) as count, \
                    mock.patch.object(iws, "fetch", return_value=[]) as fetch, \
                    mock.patch.object(sys, "argv", ["x", "--slot", str(slot), "--cycle",
                                                    str(CYCLE_2026_11_13), "--limit", "250",
                                                    "--output-dir", tmp]):
                iws.main()
            count.assert_called_once()
            offset = fetch.call_args.args[2]
            self.assertLess(offset, total)


class ScheduleWorkflowTests(unittest.TestCase):
    def test_schedule_lets_the_script_pick_the_offset(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('"--cycle", str(tick // 48)', workflow)
        self.assertNotIn("offset = ((tick // 48) % 20) * 250", workflow)


if __name__ == "__main__":
    unittest.main()
