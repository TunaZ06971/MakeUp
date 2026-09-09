#!/usr/bin/env python3
"""KeenTools geometry baseline. Dry-run by default; never a full-head/hair acceptance test."""

import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import struct
import sys
import time
import urllib.parse
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parents[2]
API = "https://api.keentools.io"
MAX_ROUND_USD = 20
MAX_JOB_USD = 9  # 2–5 images: process 50 + mesh 20 + texture 20 credits, $0.10/cr.


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Unexpected authenticated API redirect; refusing to forward the API key")


def bounded(function):
    def wrapper(*args):
        def timeout(_signal, _frame):
            raise TimeoutError("300 second client deadline; remote cancellation is not confirmed")
        old_handler = signal.signal(signal.SIGALRM, timeout)
        signal.setitimer(signal.ITIMER_REAL, 300)
        try:
            return function(*args)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, old_handler)
    return wrapper


def save(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    os.replace(temp, path)


def checked_manifest(path):
    data = json.loads(path.read_text())
    if data.get("schemaVersion") != 1 or data.get("inputKind") != "reviewed-public-sample":
        raise ValueError("Only a reviewed-public-sample manifest version 1 is accepted")
    images = data.get("images", [])
    if not 2 <= len(images) <= 5:
        raise ValueError("Use 2–5 public sample images to keep the estimated cost at $9")
    for image in images:
        if not all(image.get(k) for k in ("path", "sourceUrl", "licenseUrl", "sha256")):
            raise ValueError("Every image needs path, sourceUrl, licenseUrl and sha256")
        for key in ("sourceUrl", "licenseUrl"):
            if urllib.parse.urlparse(image[key]).scheme != "https":
                raise ValueError(key + " must be an HTTPS provenance URL")
        if len(image["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in image["sha256"]):
            raise ValueError("sha256 must be a lowercase 64-character digest")
    return data


def reserve_budget(ledger, job_id, used_elsewhere):
    """Conservatively reserve $9, including on ambiguous failure and free credits."""
    if not 0 <= used_elsewhere <= MAX_ROUND_USD:
        raise ValueError("External round spend must be between $0 and $20")
    ledger.parent.mkdir(parents=True, exist_ok=True)
    with ledger.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.loads(ledger.read_text()) if ledger.exists() else {"schemaVersion": 1, "reservations": [], "usedElsewhereUsd": 0}
        outside = max(data.get("usedElsewhereUsd", 0), used_elsewhere)
        allocated = outside + sum(r["reservedUsd"] for r in data["reservations"])
        if allocated + MAX_JOB_USD > MAX_ROUND_USD:
            raise ValueError("This request would exceed the $20 round budget; no API call made")
        data["usedElsewhereUsd"] = outside
        data["reservations"].append({"id": job_id, "reservedUsd": MAX_JOB_USD, "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()})
        save(ledger, data)
        return allocated + MAX_JOB_USD


@bounded
def execute(args, manifest):
    start = time.monotonic()
    deadline = start + 300
    key = os.environ.get("KEENTOOLS_API_KEY")
    if not key:
        raise ValueError("Set KEENTOOLS_API_KEY in the local process environment; never put it in chat or VITE_ variables")
    photos = []
    for image in manifest["images"]:
        path = (args.manifest.parent / image["path"]).resolve()
        if path.suffix.lower() not in (".jpg", ".jpeg", ".png") or not 0 < path.stat().st_size <= 12_000_000:
            raise ValueError("Only JPEG/PNG images up to 12 MB are accepted")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != image["sha256"]:
            raise ValueError("Public sample file differs from its reviewed SHA-256")
        photos.append((raw, "image/png" if path.suffix.lower() == ".png" else "image/jpeg"))
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)  # Never overwrite or silently replay a previous billed job.
    record = {"schemaVersion": 1, "id": uuid.uuid4().hex, "provider": "keentools", "purpose": "geometry-baseline",
              "status": "prepared", "estimatedMaximumUsd": MAX_JOB_USD, "roundCapUsd": MAX_ROUND_USD,
              "inputKind": manifest["inputKind"], "privateDataAuthorized": False, "events": [],
              "fullHeadHairAccepted": False, "fullPipelineAccepted": False}
    receipt_path = output / "receipt.json"

    def remaining():
        value = deadline - time.monotonic()
        if value <= 0:
            raise TimeoutError("300 second client deadline; remote status/cost may still need reconciliation")
        return value

    def event(stage, **values):
        record["status"] = stage
        record["events"].append({"stage": stage, "elapsedSeconds": round(time.monotonic() - start, 3), **values})
        save(receipt_path, record)

    def request(url, data=None, method="GET", mime="application/json", authenticated=False):
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("Provider returned a non-HTTPS asset URL")
        if authenticated and not url.startswith(API + "/"):
            raise ValueError("Refusing to send the API key to an asset host")
        headers = {"Content-Type": mime}
        if authenticated:
            headers["Authorization"] = "Bearer " + key
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        opener = urllib.request.build_opener(NoRedirect()) if authenticated else urllib.request.build_opener()
        return opener.open(req, timeout=min(30, remaining()))

    def api(path, body=None, method="GET"):
        with request(API + path, None if body is None else json.dumps(body).encode(), method, authenticated=True) as response:
            return json.loads(response.read(2_000_000))

    def pause(seconds):
        time.sleep(min(seconds, remaining()))

    try:
        record["roundReservedUsd"] = reserve_budget(args.ledger.resolve(), record["id"], args.budget_used_elsewhere_usd)
        event("budget-reserved")
        initialized = api("/v1/avatar/init", {"image_count": len(photos)}, "POST")
        avatar_id = initialized["avatar_id"]
        if not isinstance(avatar_id, str) or not avatar_id or len(avatar_id) > 200:
            raise ValueError("Invalid avatar ID")
        record["avatarId"] = avatar_id
        prefix = "/v1/avatar/" + urllib.parse.quote(avatar_id, safe="")
        urls = initialized["img_urls"]
        if len(urls) != len(photos):
            raise ValueError("Provider returned an unexpected image URL count")
        event("initialized")
        for url, (raw, mime) in zip(urls, photos):
            with request(url, raw, "PUT", mime) as response:
                response.read(1024)
        event("public-photos-uploaded")
        # No automatic retry of either a process request or a completed result request.
        event("process-request-sending")
        api(prefix + "/process", {"expressions_enabled": False, "focal_length_type": {"focal_length_type": "estimate_common"}}, "POST")
        event("reconstructing")
        while True:
            status = api(prefix + "/get-status")
            if status["status"] == "completed":
                break
            if status["status"] in ("failed", "deleted"):
                raise RuntimeError("Provider reconstruction status: " + status["status"])
            pause(2)
        event("exporting")
        while True:
            result = api(prefix + "/get-3d-model?mesh_format=glb&texture=jpg&edges=false")
            if result["event"] == "redirect":
                record["downloadUrl"] = result["data"]["url"]
                event("result-redirect-received")  # Save before download; this response is billable.
                break
            if result["event"] != "retry-after":
                raise RuntimeError("Unknown model response; will not retry a potentially billed response")
            pause(max(1, min(float(result["data"]["time_sec"]), 60)))
        model = output / "head.glb"
        with request(record["downloadUrl"]) as response, model.open("wb") as target:
            length = 0
            digest = hashlib.sha256()
            while True:
                remaining()
                chunk = response.read(65536)
                if not chunk:
                    break
                length += len(chunk)
                if length > 128_000_000:
                    raise ValueError("GLB exceeds 128 MB evaluation download bound")
                target.write(chunk)
                digest.update(chunk)
        with model.open("rb") as file:
            header = file.read(12)
        if len(header) != 12 or header[:4] != b"glTF" or struct.unpack("<II", header[4:]) != (2, length):
            raise ValueError("Returned file is not a complete GLB 2.0 asset")
        record["asset"] = {"path": "head.glb", "bytes": length, "sha256": digest.hexdigest()}
        event("asset-downloaded-not-yet-rendered")
    except Exception as error:
        # Keep the conservative reservation; timeouts do not prove a charge was refunded.
        event("failed", error=str(error)[:1000])
    record["elapsedSeconds"] = round(time.monotonic() - start, 3)
    record["note"] = "No browser first-frame time measured. Hair fidelity not provided or accepted. Ledger reservation remains until manually reconciled."
    save(receipt_path, record)
    return {"status": record["status"], "receipt": str(receipt_path), "elapsedSeconds": record["elapsedSeconds"], "fullPipelineAccepted": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--execute-public-sample", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / ".artifacts/model-eval/keentools-first")
    parser.add_argument("--ledger", type=Path, default=ROOT / ".artifacts/model-eval/round-budget.json")
    parser.add_argument("--budget-used-elsewhere-usd", type=float, default=0)
    args = parser.parse_args(argv)
    try:
        manifest = checked_manifest(args.manifest.resolve()) if args.manifest else None
        if args.execute_public_sample:
            if manifest is None:
                raise ValueError("Execution requires a reviewed public sample manifest")
            result = execute(args, manifest)
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0 if result["status"] == "asset-downloaded-not-yet-rendered" else 1
        else:
            print(json.dumps({"mode": "dry-run", "networkRequests": 0, "mediaFilesRead": 0,
                              "estimatedMaximumUsd": MAX_JOB_USD, "roundCapUsd": MAX_ROUND_USD,
                              "sampleManifestValidated": manifest is not None,
                              "nextRequirement": "KeenTools Cloud account/API key plus a reviewed, licensed public sample manifest",
                              "purpose": "geometry baseline; cannot validate or reconstruct the person's real hair"}, indent=2))
            return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
