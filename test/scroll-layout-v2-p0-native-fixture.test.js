"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

for (const mode of ["--inside", "--clients", "--panel"]) {
    test(`P0 Native probe refuses ${mode} on a normal desktop before any app or write`, () => {
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-p0-guard-test-"));
        const output = path.join(temporary, "must-not-exist");
        const env = { ...process.env };
        delete env.CC_NIRI_P0_ISOLATED_ROOT;
        try {
            const result = spawnSync("python3", [path.join(__dirname,
                "../tools/scroll-layout-v2-p0-input-probe.py"), mode, "--output", output],
            { env, encoding: "utf8", timeout: 5000 });
            assert.equal(result.error, undefined);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /refuses? non-isolated environment/);
            assert.equal(fs.existsSync(output), false);
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    });
}
