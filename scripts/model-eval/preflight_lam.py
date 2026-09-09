#!/usr/bin/env python3
"""Read-only LAM environment/source preflight; never downloads weights or runs inference."""

import argparse
import datetime
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import subprocess
import urllib.request


ROOT = Path(__file__).resolve().parents[2]


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def source_evidence(repo):
    checks = {
        "requirements.txt": ["diff-gaussian-rasterization", "nvdiffrast", "simple-knn"],
        "app_lam.py": ['device, dtype = "cuda"', "lam.to('cuda')"],
        "tools/flame_tracking_single_image.py": ["self.device = 'cuda:0'"],
        "lam/models/rendering/gs_renderer.py": ["from diff_gaussian_rasterization import"],
        "vhap/util/render_nvdiffrast.py": ["import nvdiffrast.torch"],
    }
    evidence = []
    for relative, needles in checks.items():
        path = repo / relative
        if not path.is_file():
            continue
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if any(needle in line for needle in needles):
                evidence.append({"file": relative, "line": number, "code": line.strip()})
    return evidence


def public_json(url):
    # These are fixed public metadata endpoints; never an image, upload or account API.
    with urllib.request.urlopen(url, timeout=15) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError("Metadata exceeds 2 MB bound")
    return json.loads(raw)


def preflight(repo, probe_public):
    nvidia = shutil.which("nvidia-smi")
    gpu = command([nvidia, "--query-gpu=name,memory.total", "--format=csv,noheader"]) if nvidia else None
    memory = command(["sysctl", "-n", "hw.memsize"]) if platform.system() == "Darwin" else None
    evidence = source_evidence(repo)
    required = [
        "model_zoo/lam_models/releases/lam/lam-20k/step_045500/model.safetensors",
        "assets/sample_input/status.png",
        "assets/sample_motion/export/Look_In_My_Eyes/flame_params.json",
        "pretrain_model/68_keypoints_model.pkl",
        "pretrain_model/matting/stylematte_synth.pt",
    ]
    blockers = []
    if not repo.is_dir():
        blockers.append("LAM source checkout is absent; clone separately to inspect it.")
    if not gpu:
        blockers.append("No NVIDIA CUDA device detected; inspected stock LAM has no MPS execution route.")
    missing = [name for name in required if not (repo / name).is_file()]
    if missing:
        blockers.append("Required model/sample/tracker assets are absent; no downloads attempted.")
    blockers.append("Model, sample and third-party asset permissions have not been approved by this preflight.")
    result = {
        "schemaVersion": 1,
        "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "dataHandling": "No media inputs, tokens, account APIs or paid resources accessed.",
        "host": {
            "os": platform.system(), "architecture": platform.machine(),
            "chip": command(["sysctl", "-n", "machdep.cpu.brand_string"]) if platform.system() == "Darwin" else None,
            "memoryBytes": int(memory) if memory and memory.isdigit() else None,
            "nvidiaDevices": gpu, "nvccFound": bool(shutil.which("nvcc")),
            "torchImportable": importlib.util.find_spec("torch") is not None,
            "torchExecutionTested": False,
        },
        "source": {"path": str(repo), "commit": command(["git", "-C", str(repo), "rev-parse", "HEAD"]) if repo.is_dir() else None,
                   "cudaEvidence": evidence},
        "missingAssets": missing,
        "readiness": "not-validated",
        "blockers": blockers,
        "inferenceExecuted": False,
        "fiveMinuteClaimVerified": False,
    }
    if probe_public:
        metadata = {}
        for repo_id in ("3DAIGC/LAM-20K", "3DAIGC/LAM-assets"):
            try:
                files = public_json("https://huggingface.co/api/models/" + repo_id + "/tree/main?recursive=false&expand=false")
                metadata[repo_id] = [{k: item.get(k) for k in ("path", "type", "size")} for item in files]
            except Exception as error:
                metadata[repo_id] = {"error": str(error)}
        try:
            runtime = public_json("https://huggingface.co/api/spaces/3DAIGC/LAM/runtime")
            metadata["demo"] = {k: runtime.get(k) for k in ("stage", "hardware", "sha")}
            metadata["demo"]["hardwareCaution"] = "Boot hardware label does not describe dynamically allocated ZeroGPU inference."
        except Exception as error:
            metadata["demo"] = {"error": str(error)}
        result["publicMetadata"] = metadata
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lam-repo", type=Path, default=ROOT / ".artifacts/model-eval/LAM")
    parser.add_argument("--public-metadata", action="store_true", help="Read fixed official public Hub metadata endpoints; no weights are downloaded.")
    args = parser.parse_args()
    print(json.dumps(preflight(args.lam_repo.resolve(), args.public_metadata), indent=2, ensure_ascii=False))
