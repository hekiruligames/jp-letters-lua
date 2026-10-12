#!/usr/bin/env python3
"""Exercise the real OBS Lua runtime together with Chromium and the operation UI.

Development dependencies: a Linux libobs SDK, LuaJIT library, Xvfb, Chromium,
Node.js and Playwright. None are needed to use the distributed OBS script.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sdk", type=Path, help="OBS SDK prefix (usr)")
    parser.add_argument("lua", type=Path, help="LuaJIT prefix (usr)")
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--lifecycle-only", action="store_true", help="Only exercise source deletion, script removal/re-addition, and reload")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    sdk, lua, artifacts = args.sdk.resolve(), args.lua.resolve(), args.artifacts.resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    source_files = [project / "letters/jp-letters.lua", project / "letters/package.json",
                    *(project / "letters/runtime").glob("*.lua"), *(project / "letters/web").glob("*")]
    def source_hashes():
        return {str(path.relative_to(project / "letters")): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(source_files) if path.is_file()}
    checked_sources = source_hashes()
    subprocess.run([shutil.which("node"), str(project / "tests/letters-marshmallow-style.mjs")], check=True)
    if not args.lifecycle_only:
        subprocess.run([shutil.which("python3"), str(project / "tests/letters-font-policy.py"), str(lua),
                        "--artifacts", str(artifacts)], check=True)
    for name in ("stop", "connection.json", "native-stats.json", "save.request", "restore.request", "restored", "saved-source.json", "hotkey.request", "results.json", "failure.png"):
        (artifacts / name).unlink(missing_ok=True)
    executable = artifacts / "letters-host"
    subprocess.run(["c++", "-std=c++17", "-O1", "-g", "-Wall", "-Wextra", "-Werror",
                    f"-I{sdk / 'include/obs'}", f"-I{sdk / 'include'}",
                    str(project / "tests/letters-integration.cpp"), f"-L{sdk / 'lib/x86_64-linux-gnu'}",
                    f"-Wl,-rpath,{sdk / 'lib/x86_64-linux-gnu'}", "-lobs", "-ldl", "-o", str(executable)], check=True)
    directory = Path("/tmp/.X11-unix")
    if not directory.exists():
        directory.mkdir(mode=0o1777)
        directory.chmod(0o1777)
    number = next(n for n in range(99, 200) if not (directory / f"X{n}").exists() and not Path(f"/tmp/.X{n}-lock").exists())
    env = {**os.environ, "DISPLAY": f":{number}", "LIBGL_ALWAYS_SOFTWARE": "1",
           "LD_LIBRARY_PATH": f"{lua / 'lib/x86_64-linux-gnu'}:{sdk / 'lib/x86_64-linux-gnu'}:" + os.environ.get("LD_LIBRARY_PATH", ""),
           "LUA_PATH": f"{lua / 'share/luajit-2.1'}/?.lua;;",
           "LUA_CPATH": f"{sdk / 'lib/x86_64-linux-gnu/obs-scripting'}/?.so;;",
           "XDG_CACHE_HOME": str(artifacts / "cache"), "LETTERS_CHROMIUM": args.chromium}
    xvfb = sdk / "bin/Xvfb"
    if not xvfb.exists(): xvfb = Path(shutil.which("Xvfb") or "/usr/bin/Xvfb")
    with (artifacts / "xvfb.log").open("w") as xlog, (artifacts / "native.log").open("w") as log:
        display = subprocess.Popen([str(xvfb), f":{number}", "-screen", "0", "1920x1080x24", "-nolisten", "tcp", "-ac"], env=env, stdout=xlog, stderr=subprocess.STDOUT)
        host = None
        try:
            for _ in range(50):
                if display.poll() is not None: raise RuntimeError((artifacts / "xvfb.log").read_text())
                with socket.socket(socket.AF_UNIX) as probe:
                    try: probe.connect(str(directory / f"X{number}")); break
                    except OSError: time.sleep(.1)
            else: raise RuntimeError("Xvfb startup timed out")
            host_args = [str(executable), str(sdk), str(project), str(artifacts)]
            if args.lifecycle_only: host_args.append("--lifecycle-only")
            host = subprocess.Popen(host_args, env=env, stdout=log, stderr=subprocess.STDOUT)
            for _ in range(100):
                if host.poll() is not None: raise RuntimeError((artifacts / "native.log").read_text())
                if (artifacts / "connection.json").exists(): break
                time.sleep(.1)
            else: raise RuntimeError("Lua source startup timed out")
            web_result = 0
            if not args.lifecycle_only:
                web_result = subprocess.run([shutil.which("node"), str(project / "tests/letters-e2e.mjs"), str(artifacts)], env=env, timeout=420).returncode
                (artifacts / "stop").touch()
            host_result = host.wait(timeout=30)
            for line in (artifacts / "native.log").read_text().splitlines():
                if "PASS:" in line or "FAIL:" in line or "LUA:" in line: print(line)
            if host_result: print("\n".join((artifacts / "native.log").read_text().splitlines()[-45:]))
            if host_result < 0: print("FAIL: host terminated by " + signal.Signals(-host_result).name)
            if not web_result and not host_result:
                if checked_sources != source_hashes(): raise RuntimeError("Source changed during validation")
                if not args.lifecycle_only:
                    result_path = artifacts / "results.json"
                    report = json.loads(result_path.read_text())
                    report["sourceSHA256"] = checked_sources
                    result_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            return web_result or host_result
        finally:
            if host and host.poll() is None:
                (artifacts / "stop").touch()
                try: host.wait(timeout=10)
                except subprocess.TimeoutExpired: host.terminate(); host.wait(timeout=5)
            display.terminate(); display.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
