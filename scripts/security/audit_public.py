#!/usr/bin/env python3
"""Audit Git files for private artifacts and recognizable secrets; never print values."""
import argparse
from pathlib import PurePosixPath
import re
import subprocess
import sys

PRIVATE_DIRS = {'.artifacts', '.firebase', '.git', 'node_modules', 'dist', 'test_faces', 'test-faces', 'captures', 'exports', 'private', 'model_zoo', 'checkpoints', '__pycache__', 'xcuserdata', 'DerivedData', '.build', 'test-results', 'playwright-report'}
PRIVATE_SUFFIXES = {'.makeupcapture', '.makeupscan', '.glb', '.gltf', '.ply', '.usdz', '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.heic', '.webm', '.mp4', '.mov', '.safetensors', '.ckpt', '.pt', '.pth', '.pkl', '.zip', '.gz', '.pem', '.key', '.p12', '.p8', '.mobileprovision', '.provisionprofile', '.log', '.pyc'}
PRIVATE_NAMES = {'GoogleService-Info.plist', 'google-services.json', 'credentials.json', 'project.local.yml', '.npmrc', '.pypirc', 'QA.md', '本轮执行与准备清单.md', '头部重建方案调研与改造建议.md'}
PATTERNS = {
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'github-token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
    'aws-key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'google-key': re.compile(rb'\bAIza[A-Za-z0-9_-]{30,}\b'),
    'service-account-private-key': re.compile(rb'"private_key"\s*:\s*"[^"\n]+'),
    'embedded-private-media': re.compile(rb'data:(?:image|video|audio)/[\w.+-]+;base64,[A-Za-z0-9+/]{100}'),
    'personal-absolute-path': re.compile(rb'/Users/[A-Za-z][A-Za-z0-9_.-]+/'),
    'personal-email': re.compile(rb'\b[A-Za-z0-9_.+-]+@(?:gmail\.com|berkeley\.edu|icloud\.com|outlook\.com)\b'),
    'hardcoded-signing-team': re.compile(rb'DEVELOPMENT_TEAM\s*[:=]\s*[A-Z0-9]{10}\b'),
}

def inspect(path, raw):
    p = PurePosixPath(path)
    problems = []
    if (set(p.parts) & PRIVATE_DIRS or p.suffix.lower() in PRIVATE_SUFFIXES or p.name in PRIVATE_NAMES
        or p.name.startswith(('HANDOVER', 'serviceAccount', 'service-account', 'client_secret'))
        or (p.name.startswith('.env') and p.name != '.env.example')
        or path.startswith(('web/public/dev/', 'docs/research/'))):
        problems.append('private-path')
    if p.suffix == '.obj' and path != 'scripts/canonical/canonical_face_model.obj':
        problems.append('unreviewed-model')
    if b'\0' in raw:
        problems.append('unreviewed-binary')
    problems.extend(label for label, pattern in PATTERNS.items() if pattern.search(raw))
    return problems

def git(*args):
    return subprocess.check_output(['git', *args])

def scan(staged=False, history=False):
    entries = []
    if history:
        for line in git('rev-list', '--objects', '--all').decode().splitlines():
            oid, _, path = line.partition(' ')
            if git('cat-file', '-t', oid).strip() == b'blob':
                entries.append((path, oid, git('cat-file', 'blob', oid)))
    else:
        for entry in git('ls-files', '--stage', '-z').decode().split('\0'):
            if not entry:
                continue
            metadata, path = entry.split('\t', 1)
            mode, oid, stage = metadata.split()
            if stage != '0':
                raise ValueError('Resolve merge conflicts before the public audit')
            if mode not in ('100644', '100755'):
                raise ValueError('Symlinks/submodules need explicit review: ' + path)
            entries.append((path, oid, git('cat-file', 'blob', oid)))
    errors = []
    for path, oid, raw in entries:
        errors.extend(f'{path} [{oid[:10]}]: {reason}' for reason in inspect(path, raw))
    for error in sorted(set(errors)):
        print(error, file=sys.stderr)
    print(f'Public audit: {len(entries)} file objects checked; {len(errors)} findings. No secret values printed.')
    return bool(errors)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staged', action='store_true', help='Audit the exact Git index (also the default)')
    parser.add_argument('--history', action='store_true', help='Audit all reachable Git file objects in this checkout')
    args = parser.parse_args()
    sys.exit(scan(args.staged, args.history))
