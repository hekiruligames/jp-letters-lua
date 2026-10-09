#!/usr/bin/env python3
"""Package the OBS Lua letters source without build or runtime dependencies."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    "jp-letters.lua", "runtime/http.lua", "runtime/fonts.lua", "runtime/webfonts.lua", "web/control.html", "web/display.html",
    "web/core.js", "web/control.js", "web/display.js", "web/themes.js", "web/style.css",
    "package.json", "README.md", "はじめに.txt", "samples/お便りサンプル.txt",
)


def add(archive, name, data):
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "library-files")
    parser.add_argument("--validation", type=Path, required=True, help="A successful letters test artifact directory")
    args = parser.parse_args()
    validation = json.loads((args.validation / "results.json").read_text(encoding="utf-8"))
    font_policy = json.loads((args.validation / "font-policy.json").read_text(encoding="utf-8"))
    native_log = (args.validation / "native.log").read_text(encoding="utf-8")
    native_checks = [line.split("PASS: ", 1)[1] for line in native_log.splitlines() if "PASS: " in line]
    if len(validation["passed"]) < 17 or len(font_policy["passed"]) < 5 or len(native_checks) < 6 or "FAIL:" in native_log:
        raise SystemExit("Successful web and native lifecycle checks are required before packaging")
    checked_sources = validation.get("sourceSHA256", {})
    if not checked_sources or any(hashlib.sha256((ROOT / "letters" / name).read_bytes()).hexdigest() != digest
                                  for name, digest in checked_sources.items()):
        raise SystemExit("Source must match the successful validation run")
    version = json.loads((ROOT / "letters/package.json").read_text(encoding="utf-8"))["version"]
    top = f"jp-letters-{version}"
    args.output.mkdir(parents=True, exist_ok=True)
    release = args.output / f"{top}.zip"
    assets = {name: (ROOT / "letters" / name).read_bytes() for name in FILES}
    assets["LICENSE"] = (ROOT / "LICENSE").read_bytes()
    manifest = {"version": version, "license": "GPL-2.0-or-later",
                "runtimeDependencies": "OBS built-in LuaJIT and browser source",
                "checks": {**validation, "native": native_checks, "fontPolicy": font_policy},
                "macOSRuntimeTested": False, "windowsRuntimeTested": False,
                "sha256": {name: hashlib.sha256(data).hexdigest() for name, data in assets.items()}}
    with zipfile.ZipFile(release, "w") as archive:
        for name, data in assets.items():
            add(archive, f"{top}/{name}", data)
        add(archive, f"{top}/validation.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    with zipfile.ZipFile(release) as archive:
        assert archive.testzip() is None, "Corrupt release archive"
        for name, digest in manifest["sha256"].items():
            assert hashlib.sha256(archive.read(f"{top}/{name}")).hexdigest() == digest
    for source, suffix in (("operation-panel.png", "preview.png"), ("letter-output.png", "output.png")):
        shutil.copyfile(args.validation / source, args.output / f"{top}-{suffix}")
    print(f"Packaged: {release} ({release.stat().st_size} bytes)")
    print(f"SHA-256: {hashlib.sha256(release.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
