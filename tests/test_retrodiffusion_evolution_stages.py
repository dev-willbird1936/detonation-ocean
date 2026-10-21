"""Offline tests for the 18-loop evolution stage pipeline: every API call is mocked, no secret is read."""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from PIL import Image, ImageSequence

TOOLS = Path(__file__).resolve().parents[1] / "tools"


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, TOOLS / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


exp = load("evolution_export", "export-evolution-stage-animations.py")
st = exp.stages  # One stages module instance shared with the exporter, so one patch covers both.
TOKEN = "SECRET-KEY-DO-NOT-LOG"


def open_image(path):
    return Image.open(io.BytesIO(Path(path).read_bytes()))


def quiet(function, *args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            return function(*args), out.getvalue() + err.getvalue()
        except Exception as error:
            error.captured = out.getvalue() + err.getvalue()
            raise


def fake_gif(frames=3):
    images = []
    for i in range(frames):
        frame = Image.new("P", (128, 128), 0)
        frame.putpalette([0, 0, 0, 200, 40 * i, 90] + [0] * 762)
        frame.paste(1, (30 + 4 * i, 30, 90, 90))
        images.append(frame)
    buffer = io.BytesIO()
    images[0].save(buffer, format="GIF", save_all=True, append_images=images[1:], duration=100, loop=0, transparency=0)
    return buffer.getvalue()


class FakeApi:
    """Stand-in for st.request. Logs every call; paid POSTs and tasks are configurable per seed."""

    def __init__(self, balance=10.0, quote=0.25, charge=0.25):
        self.balance, self.quote, self.charge = balance, quote, charge
        self.fail_post, self.fail_task, self.charge_by_seed, self.on_post = set(), set(), {}, None
        self.calls, self.seed_of_task = [], {}
        self.gif = fake_gif()

    def __call__(self, path, body=None, admission=None):
        if path == "/inferences/credits":
            self.calls.append(("credits",))
            return {"balance": self.balance, "credits": 50}
        if path == "/inferences" and body.get("check_cost"):
            self.calls.append(("quote", body["seed"]))
            return {"balance_cost": self.quote}
        if path == "/inferences":
            self.calls.append(("post", body["seed"], admission))
            if self.on_post:
                self.on_post(body, admission)
            if body["seed"] in self.fail_post:
                raise RuntimeError("uncertain transport failure")
            task = f"task-{body['seed']}"
            self.seed_of_task[task] = body["seed"]
            return {"task_id": task}
        task_id = path.rsplit("/", 1)[-1]
        seed = self.seed_of_task[task_id]
        self.calls.append(("task", seed))
        if seed in self.fail_task:
            return {"status": "failed", "error": "provider failure"}
        cost = self.charge_by_seed.get(seed, self.charge)
        import base64

        return {"status": "succeeded", "result": {"balance_cost": cost, "base64_images": [base64.b64encode(self.gif).decode()], "model": "fake"}}

    def posts(self):
        return [c for c in self.calls if c[0] == "post"]


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name) / "iteration"
        for target, value in (
            (st, {"OUT": self.out}),
            (st.time, {"sleep": lambda _s: None}),
            (st, {"read_key": lambda: (_ for _ in ()).throw(AssertionError("secret read"))}),
            (urllib.request, {"urlopen": self.no_network}),
            (urllib.request.OpenerDirector, {"open": self.no_network}),
        ):
            patcher = patch.multiple(target, **value)
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def no_network(*_a, **_k):
        raise AssertionError("network access attempted")

    def prepared(self):
        quiet(st.prepare)
        return st.load_plan()

    def run_with(self, api, which, cap="4.50"):
        with patch.object(st, "request", api):
            return quiet(st.run, which, cap)

    def run_pilot(self, api):
        if not (self.out / "plan.json").exists():
            self.prepared()
        self.run_with(api, "pilot")

    def accept_pilot(self):
        plan, sha = st.load_plan()
        masters = st.jload(self.out / "manifest.json")
        entry = next(m for m in masters["masters"] if m["id"] == st.PILOT)
        record = {"schema": "evolution-stage-qvl-v1", "scope": "pilot", "status": "accept", "overall": 8.5, "plan_sha256": sha, "loop_id": st.PILOT, "native_sha256": entry["sha256"]}
        st.write_json_new(st.pilot_qvl_path(), record)
        return record

    def files_text(self):
        return "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in self.out.rglob("*.json"))


class PlanTests(Base):
    def test_eighteen_unique_loops_and_thirty_mappings(self):
        plan = st.build_plan()
        loops, variants = plan["loops"], plan["variants"]
        self.assertEqual([l["id"] for l in loops], [f"{f}-{s}" for f in st.FORMS for s in st.STAGES])
        self.assertEqual(len({l["id"] for l in loops}), 18)
        self.assertEqual(len({l["seed"] for l in loops}), 18)
        self.assertEqual(len({l["prompt"] for l in loops}), 18)
        self.assertEqual(len(variants), 30)
        self.assertEqual(len({v["id"] for v in variants}), 30)
        for form in st.FORMS:
            self.assertEqual(sum(l["form"] == form for l in loops), 3)
            self.assertEqual([l["stage"] for l in loops if l["form"] == form], ["base-rich", "midnight-abyss", "trench"])

    def test_depth_to_stage_mapping(self):
        expected = {"sunlight": "base-rich", "twilight": "base-rich", "midnight": "midnight-abyss", "abyss": "midnight-abyss", "trench": "trench"}
        plan = st.build_plan()
        for variant in plan["variants"]:
            self.assertEqual(variant["loop"], f"{variant['form']}-{expected[variant['depth']]}", variant["id"])
        for form in st.FORMS:
            self.assertEqual([v["depth"] for v in plan["variants"] if v["form"] == form], st.DEPTHS)
        users = {}
        for variant in plan["variants"]:
            users.setdefault(variant["loop"], []).append(variant["depth"])
        self.assertEqual({len(d) for l, d in users.items() if l.endswith("base-rich") or l.endswith("midnight-abyss")}, {2})
        self.assertEqual({len(d) for l, d in users.items() if l.endswith("trench")}, {1})

    def test_inputs_are_the_pinned_128_sources(self):
        manifest = st.jload(st.MANIFEST)
        self.assertEqual(st.sha256_file(st.MANIFEST), st.MANIFEST_SHA256)
        sources = {s["id"]: s for s in manifest["sources"]}
        for loop in st.build_plan()["loops"]:
            source = sources[loop["id"]]
            self.assertEqual(loop["source_sha256"], source["sha256"])
            self.assertEqual(loop["source_file"], source["file"])
            self.assertTrue(loop["source_file"].endswith("-128.png"))
            image = open_image(st.COLORS / loop["source_file"])
            self.assertEqual((image.size, image.mode), ((128, 128), "RGBA"))

    def test_squid_never_octopus(self):
        plan = st.build_plan()
        self.assertNotIn("octopus", json.dumps(plan).lower())
        for loop in plan["loops"]:
            if loop["form"] == "squid":
                self.assertTrue(loop["source_file"].startswith("morphology/squid-"))
                self.assertIn("quid", loop["prompt"])
        self.assertEqual(plan["pilot"], "squid-base-rich")
        self.assertNotIn("octopus", "".join(st.MOTION.values()).lower())

    def test_request_body_shape_and_upload(self):
        import base64

        plan = st.build_plan()
        for loop in plan["loops"]:
            body = st.body_for(loop)
            self.assertEqual({k: v for k, v in body.items() if k != "input_image"}, loop["request"])
            self.assertEqual(
                {k: body[k] for k in ("prompt_style", "width", "height", "num_images", "frames_duration", "remove_bg")},
                {"prompt_style": "rd_advanced_animation__custom_action", "width": 128, "height": 128, "num_images": 1, "frames_duration": 8, "remove_bg": True},
            )
            upload = Image.open(io.BytesIO(base64.b64decode(body["input_image"])))
            self.assertEqual((upload.size, upload.mode), ((128, 128), "RGB"))
            source = open_image(st.COLORS / loop["source_file"]).convert("RGBA")
            self.assertEqual(upload.getpixel((0, 0)), (0x24, 0x3B, 0x4B))
            for x, y in ((0, 0), (127, 127), (64, 64), (30, 90)):
                r, g, b, a = source.getpixel((x, y))
                self.assertEqual(upload.getpixel((x, y)), (r, g, b) if a == 255 else (0x24, 0x3B, 0x4B))

    def test_prompts_keep_anatomy_and_forbid_changes(self):
        for loop in st.build_plan()["loops"]:
            prompt = loop["prompt"].lower()
            self.assertLessEqual(len(loop["prompt"]), st.PROMPT_MAX)
            for phrase in ("exact silhouette", "no redesign", "no species substitution", "no camera movement", "centered", "no loop jump", "transparent background"):
                self.assertIn(phrase, prompt, loop["id"])
            self.assertIn(loop["form"].split("-")[0] if loop["form"] != "isopod-host" else "isopod", prompt)

    def test_plan_json_matches_sources(self):
        # Reads the prepared repository plan; offline.
        real = st.EVOLUTION / "animations/iteration-01/plan.json"
        plan = json.loads(real.read_text(encoding="utf-8"))
        self.assertEqual(plan, st.build_plan())
        self.assertEqual(plan["estimated_microdollars"], 4_500_000)
        self.assertEqual(plan["status"], "prepared-not-generated")

    def test_plan_validation_catches_tampering(self):
        plan = st.build_plan()
        plan["loops"][1]["seed"] = plan["loops"][0]["seed"]
        self.assertIn("seeds are not unique", st.plan_problems(plan))
        plan = st.build_plan()
        plan["loops"][0]["estimate_microdollars"] = 300_000
        self.assertTrue(any("cap" in p for p in st.plan_problems(plan)))


class PrepareTests(Base):
    def test_prepare_and_validate_are_offline_and_secret_free(self):
        with patch.object(st, "request", side_effect=AssertionError("api call")):
            self.assertEqual(quiet(st.main, ["--prepare"])[0], 0)
            self.assertEqual(quiet(st.main, ["--validate"])[0], 0)
        self.assertEqual(json.loads((self.out / "plan.json").read_text())["estimated_microdollars"], 4_500_000)
        self.assertEqual([p.name for p in self.out.iterdir()], ["plan.json"])

    def test_prepare_refuses_overwrite(self):
        self.prepared()
        before = (self.out / "plan.json").read_bytes()
        code, text = quiet(st.main, ["--prepare"])
        self.assertEqual(code, 1)
        self.assertIn("not overwriting", text)
        self.assertEqual((self.out / "plan.json").read_bytes(), before)

    def test_validate_rejects_changed_plan(self):
        self.prepared()
        plan = json.loads((self.out / "plan.json").read_text())
        plan["loops"][0]["prompt"] += " extra"
        (self.out / "plan.json").write_text(json.dumps(plan))
        self.assertEqual(quiet(st.main, ["--validate"])[0], 1)

    def test_write_new_never_overwrites(self):
        target = self.out / "x.bin"
        st.write_new(target, b"one")
        with self.assertRaisesRegex(RuntimeError, "not overwriting"):
            st.write_new(target, b"two")
        self.assertEqual(target.read_bytes(), b"one")

    def test_paid_modes_need_exact_authorization_and_make_no_call(self):
        self.prepared()
        api = FakeApi()
        for argv in (["--pilot"], ["--remaining"], ["--pilot", "--authorized-cap-usd", "4.51"], ["--pilot", "--authorized-cap-usd", "5"], ["--remaining", "--authorized-cap-usd", "abc"]):
            with patch.object(st, "request", api):
                code, text = quiet(st.main, argv)
            self.assertEqual(code, 1, argv)
            self.assertIn("authorization", text)
        self.assertEqual(api.calls, [])
        self.assertFalse((self.out / "jobs").exists())

    def test_money_is_exact_integer(self):
        self.assertEqual(st.money(0.25), 250_000)
        self.assertEqual(st.money("4.50"), st.CAP)
        self.assertEqual(st.money(1.39), 1_390_000)
        for bad in (None, True, -1, "nan", "inf", 0.0000001):
            with self.assertRaises(RuntimeError):
                st.money(bad)


class QuoteTests(Base):
    def test_quote_is_free_and_reports_low_balance(self):
        self.prepared()
        api = FakeApi(balance=1.39)
        with patch.object(st, "request", api):
            code, text = quiet(st.quote_command)
        self.assertEqual(code, 2)
        self.assertEqual([c[0] for c in api.calls], ["quote"] * 18 + ["credits"])
        self.assertEqual(api.posts(), [])
        self.assertIn("NOT FUNDED", text)
        self.assertIn("$1.39", text)
        report = json.loads(next((self.out / "quotes").iterdir()).read_text())
        self.assertFalse(report["funded"])
        self.assertEqual(report["usd_balance_microdollars"], 1_390_000)
        self.assertEqual(report["total_microdollars"], 4_500_000)
        self.assertFalse((self.out / "jobs").exists())
        self.assertFalse((self.out / "ledger.json").exists())

    def test_quote_uses_usd_balance_not_credits(self):
        self.prepared()
        api = FakeApi(balance=1.39)
        with patch.object(st, "request", api):
            self.assertEqual(st.live_balance(), 1_390_000)  # credits: 50 is ignored
        with patch.object(st, "request", return_value={"credits": 5000}):
            with self.assertRaisesRegex(RuntimeError, "no USD balance"):
                st.live_balance()

    def test_quote_funded_still_submits_nothing(self):
        self.prepared()
        api = FakeApi(balance=4.50)
        with patch.object(st, "request", api):
            code, _ = quiet(st.quote_command)
        self.assertEqual(code, 0)
        self.assertEqual(api.posts(), [])
        self.assertTrue(all(c[0] in ("quote", "credits") for c in api.calls))

    def test_quote_over_cap_or_price_rise_is_not_funded(self):
        self.prepared()
        api = FakeApi(balance=100.0, quote=0.26)
        with patch.object(st, "request", api):
            code, text = quiet(st.quote_command)
        self.assertEqual(code, 2)
        self.assertIn("NOT FUNDED", text)
        self.assertEqual(api.posts(), [])


class PilotTests(Base):
    def test_low_balance_refuses_pilot_before_any_paid_call(self):
        self.prepared()
        api = FakeApi(balance=1.39)
        with self.assertRaisesRegex(RuntimeError, "live USD balance \\$1.39 is below the \\$4.50"):
            self.run_with(api, "pilot")
        self.assertEqual(api.posts(), [])
        self.assertFalse((self.out / "jobs").exists())
        self.assertFalse((self.out / "ledger.json").exists())
        self.assertFalse((self.out / "masters").exists())

    def test_balance_one_microdollar_short_refuses(self):
        self.prepared()
        api = FakeApi(balance=4.499999)
        with self.assertRaisesRegex(RuntimeError, "below"):
            self.run_with(api, "pilot")
        self.assertEqual(api.posts(), [])

    def test_quote_above_estimate_refuses(self):
        self.prepared()
        api = FakeApi(quote=0.26)
        with self.assertRaisesRegex(RuntimeError, "Live price increase"):
            self.run_with(api, "pilot")
        self.assertEqual(api.posts(), [])

    def test_quote_total_over_cap_refuses(self):
        self.prepared()
        plan, sha = st.load_plan()
        api = FakeApi(quote=0.25)
        self.out.mkdir(exist_ok=True)
        ledger = st.load_ledger(sha)
        ledger["reservations"]["earlier"] = 1
        st.save_ledger(ledger)
        with self.assertRaisesRegex(RuntimeError, "exceeds the authorized \\$4.50 cap"):
            self.run_with(api, "pilot")
        self.assertEqual(api.posts(), [])

    def test_pilot_runs_exactly_one_paid_call_with_persisted_reservation(self):
        self.prepared()
        api = FakeApi(balance=4.50)
        seen = {}

        def before_post(body, key):
            folder = self.out / "jobs" / st.PILOT
            admission = json.loads((folder / "admission.json").read_text())
            ledger = json.loads((self.out / "ledger.json").read_text())
            seen.update(admission=admission, ledger=ledger, key=key, output_exists=(self.out / "masters").exists())

        api.on_post = before_post
        _, text = self.run_with(api, "pilot")
        self.assertEqual(len(api.posts()), 1)
        self.assertEqual(seen["admission"]["idempotency_key"], seen["key"])
        self.assertEqual(seen["ledger"]["reservations"], {st.PILOT: 250_000})
        self.assertFalse(seen["output_exists"])
        plan, _ = st.load_plan()
        squid = next(l for l in plan["loops"] if l["id"] == st.PILOT)
        self.assertEqual(api.posts()[0][1], squid["seed"])
        masters = json.loads((self.out / "manifest.json").read_text())
        self.assertEqual([m["id"] for m in masters["masters"]], [st.PILOT])
        self.assertEqual(masters["masters"][0]["frames"], 3)
        self.assertEqual(masters["masters"][0]["charge_microdollars"], 250_000)
        self.assertEqual(json.loads((self.out / "ledger.json").read_text())["actual_charges"], {st.PILOT: 250_000})
        self.assertTrue((self.out / "masters/squid-base-rich-native.gif").exists())
        self.assertFalse((self.out / "run.lock").exists())

    def test_pilot_never_repeats_after_completion(self):
        self.run_pilot(FakeApi())
        api = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "Pilot already complete"):
            self.run_with(api, "pilot")
        self.assertEqual(api.calls, [])

    def test_ambiguous_post_is_not_retried_or_recovered(self):
        self.prepared()
        plan, _ = st.load_plan()
        seed = next(l["seed"] for l in plan["loops"] if l["id"] == st.PILOT)
        api = FakeApi()
        api.fail_post.add(seed)
        with self.assertRaises(st.AmbiguousAdmission):
            self.run_with(api, "pilot")
        self.assertEqual(len(api.posts()), 1)
        folder = self.out / "jobs" / st.PILOT
        self.assertTrue((folder / "admission.json").exists())
        self.assertTrue((folder / "ambiguous.json").exists())
        self.assertFalse((folder / "accepted.json").exists())
        self.assertEqual(json.loads((self.out / "ledger.json").read_text())["reservations"], {st.PILOT: 250_000})
        again = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "no retry or recovery"):
            self.run_with(again, "pilot")
        self.assertEqual(again.calls, [])  # not even a quote

    def test_admission_without_task_is_ambiguous_even_without_marker(self):
        self.prepared()
        folder = self.out / "jobs" / st.PILOT
        st.write_json_new(folder / "admission.json", {"loop_id": st.PILOT})
        api = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "ambiguous"):
            self.run_with(api, "pilot")
        self.assertEqual(api.calls, [])

    def test_failed_task_stops_and_is_not_retried(self):
        self.prepared()
        plan, _ = st.load_plan()
        seed = next(l["seed"] for l in plan["loops"] if l["id"] == st.PILOT)
        api = FakeApi()
        api.fail_task.add(seed)
        with self.assertRaisesRegex(RuntimeError, "no paid retry"):
            self.run_with(api, "pilot")
        self.assertEqual(len(api.posts()), 1)
        self.assertTrue((self.out / "jobs" / st.PILOT / "failed.json").exists())
        again = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "failed: no retry"):
            self.run_with(again, "pilot")
        self.assertEqual(again.calls, [])

    def test_charge_above_quote_stops_and_preserves_output(self):
        self.prepared()
        plan, _ = st.load_plan()
        seed = next(l["seed"] for l in plan["loops"] if l["id"] == st.PILOT)
        api = FakeApi()
        api.charge_by_seed[seed] = 0.30
        with self.assertRaisesRegex(RuntimeError, "above its quote"):
            self.run_with(api, "pilot")
        self.assertEqual(len(api.posts()), 1)
        self.assertTrue((self.out / "masters/squid-base-rich-native.gif").exists())
        masters = json.loads((self.out / "manifest.json").read_text())
        self.assertEqual(masters["failures"][0]["id"], st.PILOT)

    def test_non_animated_output_is_preserved_and_stops(self):
        self.prepared()
        api = FakeApi()
        api.gif = fake_gif(1)
        with self.assertRaisesRegex(RuntimeError, "failed its gate"):
            self.run_with(api, "pilot")
        self.assertTrue((self.out / "masters/squid-base-rich-native.gif").exists())

    def test_existing_output_is_never_overwritten(self):
        self.prepared()
        target = self.out / "masters/squid-base-rich-native.gif"
        st.write_new(target, b"keep")
        api = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "not overwriting"):
            self.run_with(api, "pilot")
        self.assertEqual(target.read_bytes(), b"keep")
        self.assertEqual(api.posts(), [])

    def test_concurrent_run_is_refused(self):
        self.prepared()
        st.write_new(self.out / "run.lock", b"")
        api = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "Another run"):
            self.run_with(api, "pilot")
        self.assertEqual(api.calls, [])


class RemainingTests(Base):
    def pilot_done(self, **kwargs):
        api = FakeApi(**kwargs)
        self.run_pilot(api)
        return api

    def test_refuses_without_pilot_or_qvl(self):
        self.prepared()
        api = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "Pilot has not run"):
            self.run_with(api, "remaining")
        self.assertEqual(api.calls, [])
        self.pilot_done()
        api = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "QVL record missing"):
            self.run_with(api, "remaining")
        self.assertEqual(api.calls, [])

    def test_refuses_unbound_or_failing_qvl(self):
        self.pilot_done()
        record = self.accept_pilot()
        path = st.pilot_qvl_path()
        for change in ({"native_sha256": "0" * 64}, {"plan_sha256": "0" * 64}, {"overall": 8.0}, {"overall": True}, {"status": "reject"}, {"scope": "final"}, {"loop_id": "anglerfish-base-rich"}):
            path.write_text(json.dumps({**record, **change}))
            api = FakeApi()
            with self.assertRaisesRegex(RuntimeError, "QVL record is not"):
                self.run_with(api, "remaining")
            self.assertEqual(api.calls, [], change)

    def test_refuses_if_pilot_master_changed_after_qvl(self):
        self.pilot_done()
        self.accept_pilot()
        gif = self.out / "masters/squid-base-rich-native.gif"
        gif.write_bytes(gif.read_bytes() + b"x")
        api = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "changed since"):
            self.run_with(api, "remaining")
        self.assertEqual(api.calls, [])

    def test_low_balance_refuses_remaining(self):
        self.pilot_done()
        self.accept_pilot()
        api = FakeApi(balance=4.00)  # needs 17 x 0.25 = 4.25
        with self.assertRaisesRegex(RuntimeError, "below the \\$4.25"):
            self.run_with(api, "remaining")
        self.assertEqual(api.posts(), [])
        self.assertEqual(list((self.out / "jobs").iterdir())[0].name, st.PILOT)

    def test_gross_cap_counts_every_reservation(self):
        self.pilot_done()
        self.accept_pilot()
        ledger = st.load_ledger(st.load_plan()[1])
        ledger["reservations"]["extra"] = 1
        st.save_ledger(ledger)
        api = FakeApi(balance=100.0)
        with self.assertRaisesRegex(RuntimeError, "exceeds the authorized"):
            self.run_with(api, "remaining")
        self.assertEqual(api.posts(), [])

    def test_seventeen_sequential_calls_each_after_fresh_quote_and_balance(self):
        self.pilot_done()
        self.accept_pilot()
        api = FakeApi(balance=4.25)
        _, text = self.run_with(api, "remaining")
        posts = api.posts()
        self.assertEqual(len(posts), 17)
        self.assertEqual(len({p[1] for p in posts}), 17)
        self.assertEqual(len({p[2] for p in posts}), 17)  # distinct idempotency keys
        plan, _ = st.load_plan()
        self.assertNotIn(next(l["seed"] for l in plan["loops"] if l["id"] == st.PILOT), {p[1] for p in posts})
        for index, call in enumerate(api.calls):
            if call[0] == "post":
                self.assertEqual(api.calls[index - 1], ("credits",))
                self.assertEqual(api.calls[index - 2], ("quote", call[1]))
                self.assertEqual(api.calls[index + 1], ("task", call[1]))  # finished before the next submission
        ledger = json.loads((self.out / "ledger.json").read_text())
        self.assertEqual(len(ledger["reservations"]), 18)
        self.assertEqual(sum(ledger["actual_charges"].values()), 4_500_000)
        self.assertEqual(len(json.loads((self.out / "manifest.json").read_text())["masters"]), 18)
        self.assertIn("DONE remaining: 18/18", text)

    def test_ambiguous_remaining_call_stops_all_later_submissions(self):
        self.pilot_done()
        self.accept_pilot()
        plan, _ = st.load_plan()
        third = [l for l in plan["loops"] if l["id"] != st.PILOT][2]
        api = FakeApi()
        api.fail_post.add(third["seed"])
        with self.assertRaises(st.AmbiguousAdmission):
            self.run_with(api, "remaining")
        self.assertEqual(len(api.posts()), 3)
        again = FakeApi()
        with self.assertRaisesRegex(RuntimeError, "no retry or recovery"):
            self.run_with(again, "remaining")
        self.assertEqual(again.calls, [])

    def test_overcharge_stops_later_submissions(self):
        self.pilot_done()
        self.accept_pilot()
        plan, _ = st.load_plan()
        second = [l for l in plan["loops"] if l["id"] != st.PILOT][1]
        api = FakeApi()
        api.charge_by_seed[second["seed"]] = 0.26
        with self.assertRaisesRegex(RuntimeError, "above its quote"):
            self.run_with(api, "remaining")
        self.assertEqual(len(api.posts()), 2)

    def test_mid_run_price_rise_stops_before_submitting(self):
        self.pilot_done()
        self.accept_pilot()
        api = FakeApi()
        original = api.__call__
        counter = {"quotes": 0}

        def rising(path, body=None, admission=None):
            if path == "/inferences" and body and body.get("check_cost"):
                counter["quotes"] += 1
                if counter["quotes"] > 17 + 1:  # after the batch quote and the first submit quote
                    return {"balance_cost": 0.26}
            return original(path, body, admission)

        with self.assertRaisesRegex(RuntimeError, "Live price increase"):
            self.run_with(rising, "remaining")
        self.assertEqual(len(api.posts()), 1)


class LoggingSafetyTests(Base):
    def test_no_base64_or_token_written_or_printed(self):
        import base64

        self.prepared()
        api = FakeApi()
        bodies = []
        api.on_post = lambda body, key: bodies.append(body)
        with patch.object(st, "read_key", return_value=TOKEN):
            _, text = self.run_with(api, "pilot")
        body = bodies[0]
        output_b64 = base64.b64encode(api.gif).decode()
        corpus = self.files_text() + text
        self.assertNotIn(body["input_image"], corpus)
        self.assertNotIn(output_b64, corpus)
        self.assertNotIn(TOKEN, corpus)
        self.assertNotIn("base64_images", json.dumps(json.loads((self.out / "jobs" / st.PILOT / "task.json").read_text())).replace("<omitted>", "").replace('"base64_images": ""', ""))
        self.assertNotRegex(corpus, r"[A-Za-z0-9+/=]{200,}")

    def test_sanitize_strips_payloads_and_signed_query(self):
        clean = st.sanitize({"result": {"base64_images": ["A" * 500], "output_urls": ["https://cdn.example/x.gif?sig=SECRET"], "note": "B" * 300}})
        text = json.dumps(clean)
        self.assertNotIn("A" * 50, text)
        self.assertNotIn("SECRET", text)
        self.assertNotIn("B" * 300, text)

    def test_api_errors_never_contain_the_token_or_payload(self):
        class Opener:
            def __init__(self, error):
                self.error = error

            def open(self, req, timeout=0):
                raise self.error

        body = ("bad token " + TOKEN + " " + "Q" * 400).encode()
        http = urllib.error.HTTPError("https://x", 401, "no", {}, io.BytesIO(body))
        with patch.object(st, "read_key", return_value=TOKEN), patch.object(urllib.request, "build_opener", return_value=Opener(http)):
            with self.assertRaises(RuntimeError) as caught:
                st.request("/inferences", {"input_image": "Z" * 500})
        message = str(caught.exception)
        self.assertNotIn(TOKEN, message)
        self.assertNotIn("Q" * 150, message)
        self.assertIn("401", message)
        with patch.object(st, "read_key", return_value=TOKEN), patch.object(urllib.request, "build_opener", return_value=Opener(urllib.error.URLError(f"dns {TOKEN}"))):
            with self.assertRaises(RuntimeError) as caught:
                st.request("/inferences/credits")
        self.assertNotIn(TOKEN, str(caught.exception))

    def test_redirects_are_refused(self):
        with self.assertRaisesRegex(RuntimeError, "redirect refused"):
            st.NoApiRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere")


class ExporterNotReadyTests(Base):
    def test_not_ready_without_masters_and_writes_nothing(self):
        self.prepared()
        before = sorted(p.name for p in self.out.rglob("*"))
        code, text = quiet(exp.main, ["--export"])
        self.assertEqual(code, 1)
        self.assertIn("NOT READY", text)
        self.assertIn("masters manifest missing", text)
        self.assertEqual(sorted(p.name for p in self.out.rglob("*")), before)
        self.assertEqual(quiet(exp.main, ["--check"])[0], 1)

    def test_not_ready_with_only_the_pilot(self):
        self.run_pilot(FakeApi())
        self.accept_pilot()
        code, text = quiet(exp.main, ["--export"])
        self.assertEqual(code, 1)
        self.assertIn("missing native master anglerfish-base-rich", text)
        self.assertFalse((self.out / "exports").exists())


def synthetic_masters(out_dir, plan, plan_sha, drift=None):
    """Test fixtures only: native-like GIFs built from each source sprite with one-pixel motion."""
    shifts = [(0, 0), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (0, 0), (0, -1)]
    entries, ledger = [], {"schema": "evolution-stage-ledger-v1", "cap_microdollars": st.CAP, "plan_sha256": plan_sha, "reservations": {}, "actual_charges": {}}
    for loop in plan["loops"]:
        source = open_image(st.COLORS / loop["source_file"]).convert("RGBA")
        colours = sorted({p[:3] for p in source.getdata() if p[3]})
        index = {c: i + 1 for i, c in enumerate(colours)}
        frames = []
        for k, (dx, dy) in enumerate(shifts):
            canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
            canvas.paste(source, (dx, dy))
            if drift == loop["id"]:
                canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
                canvas.paste((colours[0] + (255,)), (40 + k, 40, 80 + k, 80))
            frame = Image.new("P", (128, 128), 0)
            frame.putpalette([0, 0, 0] + [v for c in colours for v in c] + [0] * (768 - 3 - 3 * len(colours)))
            frame.putdata([index.get(p[:3], 1) if p[3] else 0 for p in canvas.getdata()])
            frames.append(frame)
        path = out_dir / loop["output_file"]
        path.parent.mkdir(parents=True, exist_ok=True)
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=[100 + k for k in range(len(frames))], loop=0, transparency=0, disposal=2, optimize=False)
        entries.append({"id": loop["id"], "form": loop["form"], "stage": loop["stage"], "file": loop["output_file"], "sha256": st.sha256_file(path)})
        ledger["reservations"][loop["id"]] = ledger["actual_charges"][loop["id"]] = 250_000
    masters = {"schema": "evolution-stage-masters-v1", "plan_sha256": plan_sha, "status": "candidate", "masters": entries, "failures": []}
    st.replace_json(out_dir / "manifest.json", masters)
    st.replace_json(out_dir / "ledger.json", ledger)
    by_id = {e["id"]: e["sha256"] for e in entries}
    st.write_json_new(st.pilot_qvl_path(), {"schema": "evolution-stage-qvl-v1", "scope": "pilot", "status": "accept", "overall": 8.6, "plan_sha256": plan_sha, "loop_id": st.PILOT, "native_sha256": by_id[st.PILOT]})
    st.write_json_new(
        st.final_qvl_path(),
        {"schema": "evolution-stage-qvl-v1", "scope": "final", "status": "accept", "overall": 8.4, "plan_sha256": plan_sha, "masters_manifest_sha256": st.sha256_file(out_dir / "manifest.json"), "masters": by_id},
    )
    return by_id


class ExporterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.temp.name) / "iteration"
        cls.patch = patch.object(st, "OUT", cls.out)
        cls.patch.start()
        cls.guards = [patch.object(urllib.request, "urlopen", Base.no_network), patch.object(urllib.request.OpenerDirector, "open", Base.no_network), patch.object(st, "request", side_effect=AssertionError("api call")), patch.object(st, "read_key", side_effect=AssertionError("secret read"))]
        for guard in cls.guards:
            guard.start()
        cls.depth_manifest_hash = st.sha256_file(st.MANIFEST)
        quiet(st.prepare)
        cls.plan, cls.sha = st.load_plan()
        cls.masters = synthetic_masters(cls.out, cls.plan, cls.sha)
        cls.native_before = {n: st.sha256_file(cls.out / "masters" / f"{n}-native.gif") for n in cls.masters}
        _, cls.text = quiet(exp.export)
        cls.manifest = json.loads((cls.out / "exports/export-manifest.json").read_text())

    @classmethod
    def tearDownClass(cls):
        for guard in cls.guards:
            guard.stop()
        cls.patch.stop()
        cls.temp.cleanup()

    def folder(self):
        return self.out / "exports"

    def test_counts_and_files(self):
        variants = self.manifest["variants"]
        self.assertEqual((len(variants), self.manifest["counts"]), (30, {"masters": 18, "variants": 30, "loop_files": 120, "review_aids": 7}))
        self.assertEqual(len({v["id"] for v in variants}), 30)
        names = {p.name for p in self.folder().rglob("*") if p.is_file()}
        for v in variants:
            for suffix in ("-128.gif", "-256.gif", "-spritesheet-128.png", "-spritesheet-256.png"):
                self.assertIn(v["id"] + suffix, names)
        self.assertEqual(len(names), 120 + 7 + 1)
        self.assertEqual(self.manifest["status"], "candidate")
        self.assertIn("review", self.manifest["notes"].lower())

    def test_three_stage_masters_per_family_and_depth_mapping(self):
        expected = {"sunlight": "base-rich", "twilight": "base-rich", "midnight": "midnight-abyss", "abyss": "midnight-abyss", "trench": "trench"}
        by_form = {}
        for v in self.manifest["variants"]:
            self.assertEqual(v["stage"], expected[v["depth"]])
            self.assertEqual(v["loop"], f"{v['form']}-{expected[v['depth']]}")
            self.assertEqual(v["native_sha256"], self.native_before[v["loop"]])
            by_form.setdefault(v["form"], set()).add(v["native_sha256"])
        self.assertEqual(sorted(by_form), sorted(st.FORMS))
        self.assertTrue(all(len(s) == 3 for s in by_form.values()))
        variants = {v["id"]: v for v in self.manifest["variants"]}
        for form in st.FORMS:
            for a, b in (("sunlight", "twilight"), ("midnight", "abyss")):
                self.assertEqual(variants[f"{form}-{a}"]["native_sha256"], variants[f"{form}-{b}"]["native_sha256"])
                self.assertEqual(variants[f"{form}-{a}"]["alpha_sha256"], variants[f"{form}-{b}"]["alpha_sha256"])
                self.assertEqual(variants[f"{form}-{a}"]["clip_shift"], variants[f"{form}-{b}"]["clip_shift"])
            self.assertEqual(len({variants[f"{form}-{d}"]["alpha_sha256"] for d in st.DEPTHS}), 3)

    def test_depth_palettes_match_the_accepted_stills(self):
        for v in self.manifest["variants"]:
            still = open_image(st.COLORS / v["still_file"]).convert("RGBA")
            self.assertEqual(st.sha256_file(st.COLORS / v["still_file"]), v["still_sha256"])
            allowed = {p[:3] for p in still.getdata() if p[3]}
            gif = open_image(self.folder() / (v["id"] + "-128.gif"))
            used = set()
            for frame in ImageSequence.Iterator(gif):
                used |= {p[:3] for p in frame.convert("RGBA").getdata() if p[3]}
            self.assertTrue(used <= allowed, v["id"])
            self.assertEqual(len(v["palette"]), len(set(v["palette"])))
        squid = next(v for v in self.manifest["variants"] if v["id"] == "squid-twilight")
        self.assertEqual(squid["still_file"], "squid-twilight-128.png")
        sunlight = next(v for v in self.manifest["variants"] if v["id"] == "squid-sunlight")
        self.assertNotEqual(squid["palette"], sunlight["palette"])

    def test_common_geometry_binary_alpha_and_no_reframing(self):
        for v in self.manifest["variants"]:
            gif = open_image(self.folder() / (v["id"] + "-128.gif"))
            frames = [f.convert("RGBA") for f in ImageSequence.Iterator(gif)]
            self.assertEqual(len(frames), 14)
            self.assertEqual(v["loop_frame_order"], list(range(8)) + list(range(6, 0, -1)))
            for frame in frames:
                self.assertEqual(frame.size, (128, 128))
                alpha = frame.getchannel("A")
                self.assertEqual(set(alpha.getdata()) - {0, 255}, set())
                self.assertEqual({p[:3] for p in frame.getdata() if p[3] == 0}, {(0, 0, 0)})
                box = alpha.getbbox()
                self.assertTrue(box[0] >= 8 and box[1] >= 8 and box[2] <= 120 and box[3] <= 120)
            self.assertEqual(len(set(f.tobytes() for f in frames)), 7)  # eight native poses, pose 0 repeats

    def test_depth_variants_of_one_stage_share_frame_geometry(self):
        def alphas(name):
            gif = open_image(self.folder() / (name + "-128.gif"))
            return [f.convert("RGBA").getchannel("A").tobytes() for f in ImageSequence.Iterator(gif)]

        for form in st.FORMS:
            self.assertEqual(alphas(f"{form}-sunlight"), alphas(f"{form}-twilight"))
            self.assertEqual(alphas(f"{form}-midnight"), alphas(f"{form}-abyss"))

    def test_256_is_nearest_neighbour_of_128_and_sheets_match(self):
        for v in self.manifest["variants"]:
            small = [f.convert("RGBA") for f in ImageSequence.Iterator(open_image(self.folder() / (v["id"] + "-128.gif")))]
            big = [f.convert("RGBA") for f in ImageSequence.Iterator(open_image(self.folder() / (v["id"] + "-256.gif")))]
            self.assertEqual(len(small), len(big))
            for a, b in zip(small, big):
                self.assertEqual(b.size, (256, 256))
                self.assertEqual(a.resize((256, 256), Image.Resampling.NEAREST).tobytes(), b.tobytes())
            sheet = open_image(self.folder() / (v["id"] + "-spritesheet-128.png"))
            self.assertEqual(sheet.size, (128 * len(small), 128))
            self.assertEqual(open_image(self.folder() / (v["id"] + "-spritesheet-256.png")).size, (256 * len(small), 256))
            self.assertEqual(sheet.convert("RGBA").crop((128, 0, 256, 128)).tobytes(), small[1].tobytes())

    def test_hashes_are_recorded_and_correct(self):
        for v in self.manifest["variants"]:
            self.assertEqual(len(v["files"]), 4)
            for name, info in v["files"].items():
                self.assertEqual(st.sha256_file(self.folder() / name), info["sha256"])
        for name, digest in self.manifest["review_aids"].items():
            self.assertEqual(st.sha256_file(self.folder() / name), digest)

    def test_masters_and_depth_manifest_untouched(self):
        self.assertEqual({n: st.sha256_file(self.out / "masters" / f"{n}-native.gif") for n in self.masters}, self.native_before)
        self.assertEqual(st.sha256_file(st.MANIFEST), self.depth_manifest_hash)
        self.assertEqual(self.depth_manifest_hash, st.MANIFEST_SHA256)

    def test_review_aids_are_labelled_and_candidates_only(self):
        text = json.dumps(self.manifest).lower()
        self.assertNotIn("approved", text.replace("not approved", ""))
        self.assertEqual(self.manifest["qvl"], "pending-export-review")
        self.assertTrue((self.folder() / "review/contact-sheet-frame0.png").exists())

    def test_second_export_refuses_to_overwrite(self):
        before = st.sha256_file(self.folder() / "export-manifest.json")
        code, text = quiet(exp.main, ["--export"])
        self.assertEqual(code, 1)
        self.assertIn("not overwriting", text)
        self.assertEqual(st.sha256_file(self.folder() / "export-manifest.json"), before)


class ExporterGateTests(Base):
    def ready(self, drift=None):
        plan, sha = self.prepared()
        return synthetic_masters(self.out, plan, sha, drift)

    def test_failing_master_is_preserved_and_nothing_exported(self):
        by_id = self.ready(drift="squid-trench")
        code, text = quiet(exp.main, ["--export"])
        self.assertEqual(code, 1)
        self.assertIn("squid-trench", text)
        self.assertIn("preserved", text)
        self.assertFalse((self.out / "exports").exists())
        self.assertEqual(st.sha256_file(self.out / "masters/squid-trench-native.gif"), by_id["squid-trench"])

    def test_unbound_final_qvl_blocks_export(self):
        self.ready()
        record = json.loads(st.final_qvl_path().read_text())
        record["masters"]["squid-trench"] = "0" * 64
        st.final_qvl_path().write_text(json.dumps(record))
        code, text = quiet(exp.main, ["--export"])
        self.assertEqual(code, 1)
        self.assertIn("NOT READY", text)
        self.assertFalse((self.out / "exports").exists())

    def test_failing_pilot_qvl_blocks_export(self):
        self.ready()
        record = json.loads(st.pilot_qvl_path().read_text())
        record["overall"] = 7.9
        st.pilot_qvl_path().write_text(json.dumps(record))
        self.assertEqual(quiet(exp.main, ["--check"])[0], 1)

    def test_master_failures_or_changed_master_block_export(self):
        self.ready()
        manifest = json.loads((self.out / "manifest.json").read_text())
        manifest["failures"].append({"id": "x"})
        (self.out / "manifest.json").write_text(json.dumps(manifest))
        code, text = quiet(exp.main, ["--check"])
        self.assertEqual(code, 1)
        self.assertIn("records failures", text)

    def test_exporter_refuses_existing_exports_folder(self):
        self.ready()
        (self.out / "exports").mkdir()
        code, text = quiet(exp.main, ["--export"])
        self.assertEqual(code, 1)
        self.assertIn("not overwriting", text)


class HygieneTests(unittest.TestCase):
    def test_only_stdlib_and_pillow_and_no_network_in_exporter(self):
        for file in ("retrodiffusion-evolution-stages.py", "export-evolution-stage-animations.py", "../tests/test_retrodiffusion_evolution_stages.py"):
            tree = ast.parse((TOOLS / file).read_text(encoding="utf-8"))
            roots = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    roots |= {a.name.split(".")[0] for a in node.names}
                elif isinstance(node, ast.ImportFrom) and node.level == 0:
                    roots.add(node.module.split(".")[0])
            self.assertTrue(roots <= set(sys.stdlib_module_names) | {"PIL"}, (file, roots))
        exporter = (TOOLS / "export-evolution-stage-animations.py").read_text(encoding="utf-8")
        for word in ("urllib", "request(", "read_key", "Idempotency"):
            self.assertNotIn(word, exporter)

    def test_no_secret_value_or_git_use_in_new_files(self):
        for file in ("retrodiffusion-evolution-stages.py", "export-evolution-stage-animations.py"):
            text = (TOOLS / file).read_text(encoding="utf-8")
            self.assertNotIn("subprocess", text)
            self.assertNotIn("git ", text)

    def test_constants(self):
        self.assertEqual((st.CAP, st.UNIT, st.UNIT * 18), (4_500_000, 250_000, 4_500_000))
        self.assertEqual(st.STYLE, "rd_advanced_animation__custom_action")
        self.assertEqual(len(st.FORMS) * len(st.STAGES), 18)


if __name__ == "__main__":
    unittest.main()
