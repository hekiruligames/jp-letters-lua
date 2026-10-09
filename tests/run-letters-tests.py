#!/usr/bin/env python3
"""Exercise the real OBS Lua runtime together with Chromium and the operation UI.

Development dependencies: a Linux libobs SDK, LuaJIT library, Xvfb, Chromium,
Node.js and Playwright. None are needed to use the distributed OBS script.
"""
import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sdk", type=Path, help="OBS SDK prefix (usr)")
    parser.add_argument("lua", type=Path, help="LuaJIT prefix (usr)")
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    sdk, lua, artifacts = args.sdk.resolve(), args.lua.resolve(), args.artifacts.resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
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
            host = subprocess.Popen([str(executable), str(sdk), str(project), str(artifacts)], env=env, stdout=log, stderr=subprocess.STDOUT)
            for _ in range(100):
                if host.poll() is not None: raise RuntimeError((artifacts / "native.log").read_text())
                if (artifacts / "connection.json").exists(): break
                time.sleep(.1)
            else: raise RuntimeError("Lua source startup timed out")
            result = subprocess.run([shutil.which("node"), str(project / "tests/letters-e2e.mjs"), str(artifacts)], env=env, timeout=180)
            (artifacts / "stop").touch()
            host_result = host.wait(timeout=15)
            for line in (artifacts / "native.log").read_text().splitlines():
                if "PASS:" in line or "FAIL:" in line or "LUA:" in line: print(line)
            if host_result: print("\n".join((artifacts / "native.log").read_text().splitlines()[-45:]))
            return result.returncode or host_result
        finally:
            if host and host.poll() is None:
                (artifacts / "stop").touch()
                try: host.wait(timeout=10)
                except subprocess.TimeoutExpired: host.terminate(); host.wait(timeout=5)
            display.terminate(); display.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
