#!/usr/bin/env python3
"""Check font embedding restrictions through real Fontconfig and LuaJIT.

Fixtures are renamed copies of an installed DejaVu font in the test directory.
No fonts are added to the OS, repository, or release archive.
"""
import argparse
import json
import os
from pathlib import Path
import struct
import subprocess
from xml.sax.saxutils import escape


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lua", type=Path)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    directory = args.artifacts.resolve() / "font-policy"
    fonts, cache = directory / "fonts", directory / "cache"
    fonts.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "XDG_CACHE_HOME": str(cache),
           "LD_LIBRARY_PATH": str(args.lua.resolve() / "lib/x86_64-linux-gnu") + ":" + os.environ.get("LD_LIBRARY_PATH", "")}
    source = Path(subprocess.check_output(["fc-match", "-f", "%{file}", "DejaVu Sans Mono"], env=env, text=True))
    raw = source.read_bytes()
    tables = {raw[at:at + 4]: (at, *struct.unpack_from(">II", raw, at + 8))
              for at in range(12, 12 + 16 * struct.unpack_from(">H", raw, 4)[0], 16)}
    cases = [("Allowed Test!!!!", 0, True), ("Preview Test!!!!", 4, True),
             ("Restricted Test!", 2, False), ("BitmapOnly Test!", 0x200, False),
             ("NoPolicy Test!!!", None, False)]
    for family, flags, _ in cases:
        fixture = bytearray(raw)
        _, start, size = tables[b"name"]
        names = raw[start:start + size]
        for encoding in ("utf-16-be", "ascii"):
            old, new = "DejaVu Sans Mono".encode(encoding), family.encode(encoding)
            assert len(old) == len(new)
            names = names.replace(old, new)
            names = names.replace("DejaVuSansMono".encode(encoding), family.replace(" ", "")[:14].encode(encoding))
        fixture[start:start + size] = names
        table, os2, _ = tables[b"OS/2"]
        if flags is None:
            fixture[table:table + 4] = b"NONE"
        else:
            struct.pack_into(">H", fixture, os2 + 8, flags)
        (fonts / f"{family}.ttf").write_bytes(fixture)
    config = directory / "fonts.conf"
    config.write_text(f'<?xml version="1.0"?><fontconfig><dir>{escape(str(fonts))}</dir>'
                      f'<cachedir>{escape(str(cache))}</cachedir></fontconfig>', encoding="utf-8")
    env["FONTCONFIG_FILE"] = str(config)
    checks = ["installable embedding exports a local font", "preview/print embedding exports a local font",
              "restricted embedding returns no font bytes", "bitmap-only embedding returns no outline font bytes",
              "missing embedding metadata returns no font bytes"]
    lua_checks = ";\n".join(f"check({json.dumps(family)}, {'true' if allowed else 'false'})" for family, _, allowed in cases)
    script = directory / "check.lua"
    script.write_text('''local families, err = dofile("letters/runtime/fonts.lua").list("Allowed Test!!!!")
assert(err == "", err)
local webfonts = dofile("letters/runtime/webfonts.lua")
local function check(family, allowed)
    local found = false
    for _, name in ipairs(families) do if name == family then found = true end end
    assert(found, "fixture family was not enumerated: " .. family)
    local data, mime, pending = webfonts.get(family)
    local started = os.clock()
    while pending do
        assert(os.clock() - started < 5, "font preparation did not complete")
        webfonts.poll(os.clock)
        data, mime, pending = webfonts.get(family)
    end
    assert((data and true or false) == allowed, "unexpected embedding decision: " .. family)
    if allowed then assert(#data > 100000 and mime == "font/ttf")
    else assert(type(mime) == "string" and #mime > 0) end
end
''' + lua_checks + "\n", encoding="utf-8")
    subprocess.run([str(args.lua.resolve() / "bin/luajit"), str(script)], cwd=project, env=env, check=True)
    for check in checks:
        print("PASS: " + check)
    (args.artifacts / "font-policy.json").write_text(json.dumps({"passed": checks, "runtime": "Linux Fontconfig + LuaJIT"}, indent=2))


if __name__ == "__main__":
    main()
