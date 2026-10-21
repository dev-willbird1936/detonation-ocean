"""Offline spending tests: no API requests, no secrets read."""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "study",
    Path(__file__).resolve().parents[1] / "tools/retrodiffusion-2d-ocean-study.py",
)
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.patch = patch.object(study, "OUT", self.out)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.job = {"id": "test", "body": {"num_images": 1, "prompt_style": "example"}}
        self.ledger = {"reservations": {}, "actual_charges": {}}

    def test_integer_money(self):
        self.assertEqual(study.money(0.14), 140000)
        self.assertEqual(study.money(3.5), study.LIMIT)

    def test_no_admission_above_budget(self):
        self.ledger["reservations"]["prior"] = study.LIMIT
        with patch.object(study, "request", return_value={"balance_cost": 0.06}) as api:
            with self.assertRaisesRegex(RuntimeError, "budget exhaustion"):
                study.paid(self.job, self.ledger, {"test": 60000})
        self.assertEqual(api.call_count, 1)
        self.assertTrue(api.call_args.args[1]["check_cost"])
        self.assertFalse((self.out / "jobs/test/admission.json").exists())

    def test_live_price_increase_refused(self):
        with patch.object(study, "request", return_value={"balance_cost": 0.18}) as api:
            with self.assertRaisesRegex(RuntimeError, "Live price increase"):
                study.paid(self.job, self.ledger, {"test": 60000})
        self.assertEqual(api.call_count, 1)

    def test_ambiguous_admission_never_resubmitted(self):
        digest = hashlib.sha256(
            json.dumps(self.job["body"], sort_keys=True).encode()
        ).hexdigest()
        study.save(
            self.out / "jobs/test/admission.json",
            {
                "body_digest": digest,
                "key": "safe-test-key",
                "estimated_microdollars": 60000,
            },
        )
        self.ledger["reservations"]["test"] = 60000
        with patch.object(study, "request") as api:
            with self.assertRaisesRegex(RuntimeError, "Uncertain existing admission"):
                study.paid(self.job, self.ledger, {"test": 60000})
        api.assert_not_called()

    def test_saved_task_resumed_without_post(self):
        digest = hashlib.sha256(
            json.dumps(self.job["body"], sort_keys=True).encode()
        ).hexdigest()
        study.save(self.out / "jobs/test/admission.json", {"body_digest": digest})
        study.save(self.out / "jobs/test/accepted.json", {"task_id": "saved"})
        with patch.object(study, "request") as api:
            self.assertEqual(
                study.paid(self.job, self.ledger, {"test": 60000}), {"task_id": "saved"}
            )
        api.assert_not_called()

    def test_subject_dependencies_isolated(self):
        def source(subject, placeholder):
            if subject == "anglerfish":
                raise RuntimeError("missing anglerfish")
            return "valid-placeholder"

        with patch.object(study, "source_image", side_effect=source):
            jobs = study.jobs(False, "octopus")
        self.assertEqual(len(jobs), 10)
        self.assertTrue(all(j["subject"] == "octopus" for j in jobs))

    def test_output_plan_count(self):
        with patch.object(study, "source_image", return_value="valid-placeholder"):
            jobs = study.jobs(True)
        self.assertEqual(len(jobs), 20)
        self.assertEqual(sum(j["body"]["num_images"] for j in jobs), 32)


if __name__ == "__main__":
    unittest.main()
