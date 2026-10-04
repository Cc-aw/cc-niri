"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {spawnSync} = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-immutable-test-"));
try {
  for (const effectId of ["cc-niri-viewport-clip", "cc-niri-focus-ring"]) {
    const prefix = path.join(root, effectId, "prefix");
    const build = path.join(root, effectId, "build");
    const bin = path.join(root, effectId, "bin");
    fs.mkdirSync(build, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
    const plugin = path.join(prefix, "lib64/qt6/plugins/kwin/effects/plugins/" + effectId + ".so");
    fs.mkdirSync(path.dirname(plugin), {recursive: true}); fs.writeFileSync(plugin, "old mapped library");
    fs.writeFileSync(path.join(build, "install_manifest.txt"), plugin + "\n");
    fs.writeFileSync(path.join(build, "payload"), "new spring library");
    fs.writeFileSync(path.join(bin, "cmake"), `#!/usr/bin/env python3
import os, pathlib, sys
build=pathlib.Path(sys.argv[2])
destination=pathlib.Path(os.environ["DESTDIR"])/(build/"install_manifest.txt").read_text().strip().lstrip("/")
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_bytes((build/"payload").read_bytes())
`, {mode: 0o755});
    const install = () => {
        const result = spawnSync("python3", [path.join(__dirname, "../tools/install-native-clip.py"), build, prefix, effectId],
            {encoding: "utf8", env: {...process.env, PATH: bin + path.delimiter + process.env.PATH}});
        assert.equal(result.status, 0, result.stderr);
        return fs.realpathSync(plugin);
    };
    // Hold a mapped/readable reference to the old inode while the link changes.
    const oldFile = fs.openSync(plugin, "r");
    const first = install();
    assert.ok(fs.lstatSync(plugin).isSymbolicLink());
    assert.equal(path.basename(first), effectId + ".so", "stable discovery ID");
    assert.equal(fs.readFileSync(oldFile, "utf8"), "old mapped library", "old inode was never overwritten");
    fs.closeSync(oldFile);
    const inode = fs.statSync(first).ino;
    assert.equal(install(), first);
    assert.equal(fs.statSync(first).ino, inode, "identical versions are immutable");
    fs.writeFileSync(path.join(build, "payload"), "next spring library");
    const second = install();
    assert.notEqual(second, first, "new library gets a fresh canonical loader path");
    assert.equal(fs.readFileSync(first, "utf8"), "new spring library", "prior mapped version survives subsequent install");
    assert.equal(fs.readFileSync(second, "utf8"), "next spring library");
  }
} finally { fs.rmSync(root, {recursive: true, force: true}); }
console.log("PASS immutable native deployment preserves mapped inodes and reloads a new canonical path");
