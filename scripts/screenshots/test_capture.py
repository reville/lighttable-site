"""Regression coverage for reproducible homepage crops and provenance checks."""

import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import capture


class HomepageCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "screenshots"
        shutil.copytree(capture.SITE_ROOT / "screenshots", self.output)
        shutil.copy2(capture.SITE_ROOT / "index.html", self.root / "index.html")
        self.plan = copy.deepcopy(capture.load_json(capture.PLAN_PATH))
        patcher = patch.object(capture, "SITE_ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)

    def snapshot(self):
        return {str(path.relative_to(self.root)): capture.sha256(path)
                for path in self.root.rglob("*") if path.is_file()}

    def test_regeneration_is_reproducible_and_preserves_originals(self):
        before = self.snapshot()
        capture.build_homepage(self.plan, self.output)
        self.assertEqual(self.snapshot(), before)
        capture.check_homepage(self.plan, self.output)

    def test_changed_source_is_rejected_before_any_output_write(self):
        source = self.output / "film-controls.webp"
        source.write_bytes(source.read_bytes() + b"changed")
        before = self.snapshot()
        with self.assertRaisesRegex(capture.PipelineError, "differs from recorded capture"):
            capture.build_homepage(self.plan, self.output)
        self.assertEqual(self.snapshot(), before)

    def test_new_capture_cannot_reuse_old_crop_provenance(self):
        path = self.output / capture.GENERATED_MANIFEST
        manifest = capture.load_json(path)
        manifest["appRevision"] = "new-app-revision"
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(capture.PipelineError, "different app capture"):
            capture.check_homepage(self.plan, self.output)

    def test_changed_framing_requires_regeneration(self):
        self.plan["homepage"]["hero"]["crop"][3] -= 40
        with self.assertRaisesRegex(capture.PipelineError, "stale homepage crop"):
            capture.check_homepage(self.plan, self.output)
        capture.build_homepage(self.plan, self.output)
        capture.check_homepage(self.plan, self.output)
        self.assertEqual(capture.dimensions(self.output / "hero-film.webp"), (900, 1129))

    def test_invalid_crop_plans_leave_existing_files_untouched(self):
        cases = [
            {"crop": [1800, 0, 900, 1169]},
            {"crop": [-2, 0, 900, 1169]},
            {"crop": [901, 0, 898, 1169]},
            {"asset": "film-controls.webp"},
            {"asset": "../escape.webp"},
            {"sourceShot": "missing-mode"},
        ]
        before = self.snapshot()
        for changes in cases:
            with self.subTest(changes=changes):
                plan = copy.deepcopy(self.plan)
                plan["homepage"]["hero"].update(changes)
                with self.assertRaises(capture.PipelineError):
                    capture.build_homepage(plan, self.output)
                self.assertEqual(self.snapshot(), before)

    def test_damaged_crop_and_manual_html_drift_are_detected(self):
        path = self.output / "detail-film.webp"
        original = path.read_bytes()
        path.write_bytes(original + b"changed")
        with self.assertRaisesRegex(capture.PipelineError, "crop file drifted"):
            capture.check_homepage(self.plan, self.output)
        path.write_bytes(original)
        page = self.root / "index.html"
        label = self.plan["homepage"]["details"][0]["label"]
        page.write_text(page.read_text().replace(f"<figcaption>{label}</figcaption>", "<figcaption>Manual label</figcaption>"))
        with self.assertRaisesRegex(capture.PipelineError, "markup drifted"):
            capture.check_homepage(self.plan, self.output)


if __name__ == "__main__":
    unittest.main()
