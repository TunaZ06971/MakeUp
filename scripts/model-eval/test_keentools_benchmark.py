"""Offline tests: no real API, account, image upload or paid resources."""

import argparse
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import keentools_benchmark as runner
import lam_public_demo_probe as demo


class GeometryBaselineTests(unittest.TestCase):
    def test_round_budget_includes_previous_requests_and_other_services(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "budget.json"
            self.assertEqual(runner.reserve_budget(ledger, "first", 6), 15)
            with self.assertRaisesRegex(ValueError, "exceed"):
                runner.reserve_budget(ledger, "second", 0)
            data = json.loads(ledger.read_text())
            self.assertEqual(data["usedElsewhereUsd"], 6)
            self.assertEqual(len(data["reservations"]), 1)

    def fixture(self, directory):
        root = Path(directory)
        # Synthetic bytes used exclusively by the fake HTTP transport below.
        raw = b"synthetic-public-fixture"
        (root / "example.jpg").write_bytes(raw)
        item = {"path": "example.jpg", "sourceUrl": "https://example.invalid/source",
                "licenseUrl": "https://example.invalid/license", "sha256": hashlib.sha256(raw).hexdigest()}
        data = {"schemaVersion": 1, "inputKind": "reviewed-public-sample", "images": [item, item]}
        path = root / "manifest.json"
        path.write_text(json.dumps(data))
        args = argparse.Namespace(manifest=path, output=root / "result", ledger=root / "budget.json", budget_used_elsewhere_usd=0)
        return args, data

    def test_stops_result_polling_after_redirect_and_does_not_send_key_to_asset_host(self):
        with tempfile.TemporaryDirectory() as directory:
            args, manifest = self.fixture(directory)
            requests = []
            counters = {"model": 0, "status": 0}

            class Transport:
                def open(self, req, timeout):
                    url = req.full_url
                    requests.append((url, req.get_method(), req.get_header("Authorization")))
                    if url.endswith("/init"):
                        data = {"avatar_id": "fake-avatar", "img_urls": ["https://assets.invalid/one", "https://assets.invalid/two"]}
                    elif req.get_method() == "PUT":
                        return io.BytesIO(b"")
                    elif url.endswith("/process"):
                        data = {}
                    elif url.endswith("/get-status"):
                        counters["status"] += 1
                        data = {"status": "running" if counters["status"] == 1 else "completed"}
                    elif "/get-3d-model?" in url:
                        counters["model"] += 1
                        data = {"event": "retry-after", "data": {"time_sec": 1}} if counters["model"] == 1 else {"event": "redirect", "data": {"url": "https://assets.invalid/head.glb"}}
                    elif url.endswith("head.glb"):
                        return io.BytesIO(b"glTF" + struct.pack("<II", 2, 12))
                    else:
                        raise AssertionError("Unexpected request " + url)
                    return io.BytesIO(json.dumps(data).encode())

            with patch.dict("os.environ", {"KEENTOOLS_API_KEY": "FAKE_OFFLINE_TEST_VALUE"}), patch.object(runner.urllib.request, "build_opener", return_value=Transport()), patch.object(runner.time, "sleep"):
                result = runner.execute(args, manifest)
            self.assertEqual(result["status"], "asset-downloaded-not-yet-rendered")
            self.assertFalse(result["fullPipelineAccepted"])
            self.assertEqual(counters["model"], 2)
            self.assertEqual(sum(url.endswith("/process") for url, _, _ in requests), 1)
            self.assertEqual(sum(url.endswith("head.glb") for url, _, _ in requests), 1)
            self.assertTrue(all(key is None for url, _, key in requests if url.startswith("https://assets.invalid")))

    def test_ambiguous_process_failure_keeps_reservation_and_never_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            args, manifest = self.fixture(directory)
            process_calls = []

            class Transport:
                def open(self, req, timeout):
                    if req.full_url.endswith("/init"):
                        return io.BytesIO(json.dumps({"avatar_id": "fake", "img_urls": ["https://assets.invalid/one", "https://assets.invalid/two"]}).encode())
                    if req.get_method() == "PUT":
                        return io.BytesIO(b"")
                    if req.full_url.endswith("/process"):
                        process_calls.append(req.full_url)
                        raise TimeoutError("Ambiguous timeout after submission")
                    raise AssertionError("Unexpected request")

            with patch.dict("os.environ", {"KEENTOOLS_API_KEY": "FAKE_OFFLINE_TEST_VALUE"}), patch.object(runner.urllib.request, "build_opener", return_value=Transport()):
                result = runner.execute(args, manifest)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(len(process_calls), 1)
            self.assertEqual(json.loads(args.ledger.read_text())["reservations"][0]["reservedUsd"], 9)

    def test_more_than_five_images_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            args, data = self.fixture(directory)
            data["images"] *= 3
            args.manifest.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "2–5"):
                runner.checked_manifest(args.manifest)

    def test_failed_execution_returns_nonzero_cli_status(self):
        with tempfile.TemporaryDirectory() as directory:
            args, _ = self.fixture(directory)
            with patch.object(runner, "execute", return_value={"status": "failed"}), redirect_stdout(io.StringIO()):
                self.assertEqual(runner.main(["--manifest", str(args.manifest), "--execute-public-sample"]), 1)
            with patch.object(demo, "run_probe", return_value={"status": "demo-failed"}), redirect_stdout(io.StringIO()):
                self.assertEqual(demo.main(["--run-demo"]), 1)


if __name__ == "__main__":
    unittest.main()
