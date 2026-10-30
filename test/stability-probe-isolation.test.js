"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Never pass the caller's display, bus, HOME or XDG paths to this negative test.
// Even a broken guard receives a nonexistent bus inside our temporary directory.
for (const fault of ["root", "config", "display", "wayland"]) {
    test(`SA-10: private InputClip probe refuses mismatched ${fault} before creating evidence`, () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-p0-audit-"));
        const output = path.join(base, "must-not-exist");
        for (const directory of ["config", "runtime", "data", "state", "cache"])
            fs.mkdirSync(path.join(base, directory), { mode: 0o700 });
        const env = {
            PATH: process.env.PATH, LANG: "C.UTF-8", QT_QPA_PLATFORM: "offscreen",
            CC_NIRI_P0_ISOLATED_ROOT: base,
            XDG_RUNTIME_DIR: path.join(base, "runtime"), XDG_CONFIG_HOME: path.join(base, "config"),
            XDG_DATA_HOME: path.join(base, "data"), XDG_STATE_HOME: path.join(base, "state"),
            XDG_CACHE_HOME: path.join(base, "cache"),
            DBUS_SESSION_BUS_ADDRESS: `unix:path=${base}/not-a-bus`,
        };
        if (fault === "root") delete env.CC_NIRI_P0_ISOLATED_ROOT;
        if (fault === "config") env.XDG_CONFIG_HOME = path.join(base, "wrong-config");
        if (fault === "display") env.DISPLAY = ":audit-must-refuse";
        if (fault === "wayland") env.WAYLAND_DISPLAY = "audit-must-refuse";
        try {
            const result = spawnSync("python3", [path.join(__dirname,
                "../tools/scroll-layout-v2-p3-probe.py"), "--inside", "--scenario", "input-lifecycle",
            "--output", output], { env, encoding: "utf8", timeout: 5000 });
            assert.equal(result.error, undefined);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /P3 refuses non-isolated environment/);
            assert.equal(fs.existsSync(output), false);
        } finally {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });
}

test("SA-11: probe artifact identity accepts aliases and rejects missing or different binaries", () => {
    const result = spawnSync("python3", ["-c", `
import importlib.util
from pathlib import Path
import sys
import tempfile
spec = importlib.util.spec_from_file_location("audit_probe", sys.argv[1])
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
with tempfile.TemporaryDirectory(prefix="cc-niri-probe-identity-") as temporary:
    base = Path(temporary)
    binary = base / "plugin.so"
    binary.write_bytes(b"isolated fixture")
    alias = base / "build-alias.so"
    alias.symlink_to(binary)
    other = base / "different.so"
    other.write_bytes(binary.read_bytes())
    expected = {"clip": alias}
    assert probe.same_artifact_paths({"clip": str(binary)}, expected)
    assert probe.same_artifact_paths({"clip": str(alias)}, expected)
    for observed in [{"clip": str(other)}, {"clip": str(base / "missing.so")},
                     {"clip": "plugin.so"}, {"clip": None}, {}, {"ring": str(binary)}, None]:
        assert not probe.same_artifact_paths(observed, expected), observed
    binary.unlink()
    assert not probe.same_artifact_paths({"clip": str(alias)}, expected)
`, path.join(__dirname, "../tools/scroll-layout-v2-p3-probe.py")], {
        env: { PATH: process.env.PATH, LANG: "C.UTF-8" }, encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
});
