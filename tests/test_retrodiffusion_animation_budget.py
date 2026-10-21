"""Offline tests: paid admission cap and ambiguous-admission safety."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("rd", Path(__file__).resolve().parents[1]/"tools/retrodiffusion-2d-ocean-study.py")
rd = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rd)


class AnimationAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.old_out, self.old_limit = rd.OUT, rd.LIMIT
        rd.OUT, rd.LIMIT = Path(self.folder.name), 1_500_000
        self.job = {"id":"motion-test","body":{"prompt":"generic marine animation","num_images":1}}
        self.ledger = {"reservations":{},"actual_charges":{}}

    def tearDown(self):
        rd.OUT, rd.LIMIT = self.old_out, self.old_limit
        self.folder.cleanup()

    def test_live_price_increase_never_admitted(self):
        with patch.object(rd,"request",return_value={"balance_cost":0.26}) as request:
            with self.assertRaisesRegex(RuntimeError,"Live price increase"):
                rd.paid(self.job,self.ledger,{"motion-test":250_000})
        self.assertEqual(request.call_count,1)
        self.assertEqual(self.ledger["reservations"],{})

    def test_gross_cap_never_reuses_other_reservations(self):
        self.ledger["reservations"]["existing"] = 1_500_000
        with patch.object(rd,"request",return_value={"balance_cost":0.25}) as request:
            with self.assertRaisesRegex(RuntimeError,"budget exhaustion"):
                rd.paid(self.job,self.ledger,{"motion-test":250_000})
        self.assertEqual(request.call_count,1)
        self.assertNotIn("motion-test",self.ledger["reservations"])

    def test_uncertain_paid_post_is_not_repeated(self):
        def fake(path,body=None,admission=None):
            if body.get("check_cost"):
                return {"balance_cost":0.25}
            raise RuntimeError("uncertain transport failure")
        with patch.object(rd,"request",side_effect=fake) as request:
            with self.assertRaisesRegex(RuntimeError,"uncertain transport"):
                rd.paid(self.job,self.ledger,{"motion-test":250_000})
            with self.assertRaisesRegex(RuntimeError,"Uncertain existing admission"):
                rd.paid(self.job,self.ledger,{"motion-test":250_000})
        self.assertEqual(request.call_count,2)  # one free quote, one paid attempt
        self.assertEqual(self.ledger["reservations"]["motion-test"],250_000)
        self.assertEqual(json.loads((rd.OUT/"ledger.json").read_text())["reservations"]["motion-test"],250_000)


if __name__ == "__main__":
    unittest.main()
