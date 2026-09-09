#!/usr/bin/env python3
"""One bounded, anonymous evaluation of LAM's own hosted example.

No local media, credentials, weights, or payment endpoints are read. This is a
demo probe, not a MakeUp reconstruction backend. Uses Gradio's public call API.
"""

import argparse
import datetime
import json
import concurrent.futures
import multiprocessing
import queue
import sys
import time
import urllib.request


BASE = "https://3daigc-lam.hf.space"
LIMIT = 300


def worker(messages):
    """Official client handles session state/heartbeat; no saved token is used."""
    from gradio_client import Client

    def report(stage, **details):
        messages.put({"stage": stage, **details})

    client = None
    try:
        with urllib.request.urlopen(BASE + "/config", timeout=20) as response:
            config = json.load(response)
        if config.get("auth_required"):
            raise RuntimeError("Public demo requires authentication; no account access attempted")
        datasets = [c["props"] for c in config["components"] if c.get("type") == "dataset"]
        image = next(sample[0] for d in datasets for sample in d["samples"]
                     if isinstance(sample[0], dict) and sample[0].get("orig_name") == "status.png")
        video = next(sample[0] for d in datasets for sample in d["samples"]
                     if isinstance(sample[0], dict) and sample[0].get("video", {}).get("orig_name") == "Look_In_My_Eyes.mp4")
        for item in (image, video["video"]):
            if not item.get("url", "").startswith(BASE + "/gradio_api/file="):
                raise RuntimeError("Example source changed; refusing non-provider file URL")
            # Tell the public SDK to use the provider's URL, never a local file.
            item["path"] = item["url"]
        report("public-examples-resolved", gradioVersion=config.get("version"))
        client = Client(BASE, hf_token=False, verbose=False, download_files=False)
        client.submit(api_name="/prepare_working_dir").result(timeout=30)
        report("session-prepared")
        job = client.submit(image, video, api_name="/core_fn")
        report("inference-submitted")
        last_status = None
        while True:
            try:
                outputs = job.result(timeout=5)
                break
            except concurrent.futures.TimeoutError:
                status = job.status()
                code = str(status.code)
                if code != last_status:
                    report("provider-status", code=code)
                    last_status = code

        def describe(value):
            if isinstance(value, dict):
                return {k: describe(v) for k, v in value.items() if k in ("orig_name", "mime_type", "size", "video", "subtitles")}
            if isinstance(value, (list, tuple)):
                return [describe(v) for v in value]
            return value

        report("demo-completed", outputs=describe(outputs))
    except Exception as error:
        report("demo-failed", error=str(error)[:1500])
    finally:
        if client is not None:
            client.close()


def run_probe():
    started = time.monotonic()
    receipt = {
        "schemaVersion": 1,
        "provider": "official-lam-huggingface-demo",
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "deadlineSeconds": LIMIT,
        "inputs": {"image": "status.png", "driver": "Look_In_My_Eyes.mp4"},
        "inputOrigin": "provider-built-in-examples",
        "privateDataUploaded": False,
        "credentialsUsed": False,
        "paidServicesStarted": False,
        "events": [],
        "status": "started",
        "measuredStages": "client elapsed only; server stage breakdown unavailable",
        "fullPipelineAccepted": False,
    }

    messages = multiprocessing.Queue()
    process = multiprocessing.Process(target=worker, args=(messages,), daemon=True)
    process.start()
    while time.monotonic() - started < LIMIT - 0.25:
        try:
            event = messages.get(timeout=max(0, min(0.2, LIMIT - 0.25 - (time.monotonic() - started))))
        except queue.Empty:
            if not process.is_alive():
                receipt.update(status="demo-failed", error="Client process exited without a result")
                break
            continue
        event["elapsedSeconds"] = round(time.monotonic() - started, 3)
        receipt["events"].append(event)
        if event["stage"] in ("demo-completed", "demo-failed"):
            receipt["status"] = event["stage"]
            break
    if receipt["status"] == "started":
        receipt.update(status="client-deadline", remoteCancellationConfirmed=False)
    # SDK threads must not make the local process wait past the deadline.
    if process.is_alive():
        process.terminate()
    process.join(timeout=0.2)
    if process.is_alive():
        process.kill()
    receipt["elapsedSeconds"] = round(time.monotonic() - started, 3)
    receipt["limitation"] = "Demo returns rendered media, not a verified browser-loadable head model; no output download or first-frame render was measured."
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-demo", action="store_true", help="Make one anonymous call using only the official built-in example; max 300 seconds.")
    args = parser.parse_args(argv)
    if not args.run_demo:
        print(json.dumps({"mode": "dry-run", "networkRequests": 0, "deadlineSeconds": LIMIT,
                          "inputs": "Official demo's own status.png and Look_In_My_Eyes.mp4",
                          "nextCommand": "Use --run-demo with gradio_client 1.8.0 installed to start one anonymous call."}, indent=2))
        return 0
    else:
        result = run_probe()
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result["status"] == "demo-completed" else 1


if __name__ == "__main__":
    sys.exit(main())
