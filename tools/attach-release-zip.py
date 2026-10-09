#!/usr/bin/env python3
"""Attach an already validated, tagged ZIP using the GitHub CLI's authentication."""

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile


def run_gh(*arguments):
    result = subprocess.run(["gh", *arguments], capture_output=True)
    if result.returncode:
        # GitHub may include signed URLs in errors; do not echo its raw response.
        status = re.search(rb"HTTP (\d{3})", result.stderr)
        detail = " (HTTP " + status[1].decode() + ")" if status else ""
        raise RuntimeError("GitHub request failed" + detail)
    return result.stdout


def api_json(endpoint):
    return json.loads(run_gh("api", endpoint))


def download_asset(repo, tag, filename):
    with tempfile.TemporaryDirectory(prefix="jp-letters-download-") as directory:
        run_gh("release", "download", tag, "--repo", repo, "--pattern", filename, "--dir", directory)
        return (Path(directory) / filename).read_bytes()


def validate_archive(data, tag, expected):
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("ZIP does not match the requested SHA-256")
    version = tag[1:]
    prefix = f"jp-letters-{version}/"
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.testzip() is not None:
            raise ValueError("ZIP archive is corrupt")
        manifest = json.loads(archive.read(prefix + "validation.json"))
        if manifest.get("version") != version:
            raise ValueError("ZIP version does not match the Release tag")
        checks = manifest.get("checks", {})
        if (len(checks.get("passed", [])) < 21 or len(checks.get("native", [])) < 6 or
                len(checks.get("fontPolicy", {}).get("passed", [])) < 5):
            raise ValueError("ZIP lacks the required validation results")
        hashes = manifest.get("sha256", {})
        checked_sources = checks.get("sourceSHA256", {})
        if not hashes or not checked_sources:
            raise ValueError("ZIP lacks validated source hashes")
        for name, digest in hashes.items():
            if hashlib.sha256(archive.read(prefix + name)).hexdigest() != digest:
                raise ValueError("ZIP file does not match its manifest: " + name)
        for name, digest in checked_sources.items():
            if hashes.get(name) != digest:
                raise ValueError("Packaged source differs from its validation run: " + name)


def ensure_attached(repo, tag, expected, data):
    filename = f"jp-letters-{tag[1:]}.zip"
    endpoint = f"repos/{repo}/releases/tags/{tag}"
    release = api_json(endpoint)
    if release.get("tag_name") != tag or release.get("draft"):
        raise ValueError("An already published Release with this tag is required")
    matches = [asset for asset in release.get("assets", []) if asset["name"] == filename]
    uploaded = False
    if not matches:
        with tempfile.TemporaryDirectory(prefix="jp-letters-release-") as directory:
            path = Path(directory) / filename
            path.write_bytes(data)
            run_gh("release", "upload", tag, str(path), "--repo", repo)
        release = api_json(endpoint)
        matches = [asset for asset in release.get("assets", []) if asset["name"] == filename]
        uploaded = True
    if len(matches) != 1:
        raise ValueError("Release must have exactly one matching ZIP asset")
    asset = matches[0]
    if asset.get("state") != "uploaded" or asset.get("size") != len(data):
        raise ValueError("Release asset is incomplete or has a different size")
    downloaded = download_asset(repo, tag, filename)
    if hashlib.sha256(downloaded).hexdigest() != expected:
        raise ValueError("Existing or uploaded asset differs from the validated ZIP; it was not overwritten")
    return uploaded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--check-only", action="store_true", help="Verify the tagged ZIP without attaching it")
    args = parser.parse_args()
    repo = os.environ.get("GH_REPO", "")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        parser.error("GH_REPO must identify the publishing repository")
    if not re.fullmatch(r"v\d+\.\d+\.\d+", args.tag):
        parser.error("tag must have the form v0.3.3")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", args.sha256):
        parser.error("sha256 must contain 64 hexadecimal characters")
    expected = args.sha256.lower()
    filename = f"jp-letters-{args.tag[1:]}.zip"
    file = api_json(f"repos/{repo}/contents/releases/{args.tag}/{filename}?ref={args.tag}")
    if file.get("encoding") != "base64":
        raise ValueError("Tagged ZIP must be available from the repository contents API (at most 1 MB)")
    data = base64.b64decode(file["content"].replace("\n", ""), validate=True)
    validate_archive(data, args.tag, expected)
    if args.check_only:
        print(f"Validated {filename}: {expected}")
        return
    uploaded = ensure_attached(repo, args.tag, expected, data)
    print(f"{'Attached' if uploaded else 'Already attached'} {filename}; downloaded SHA-256 verified: {expected}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, KeyError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error)) from None
