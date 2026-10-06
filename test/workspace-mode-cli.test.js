"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-workspace-cli-"));
try {
    const statePath = path.join(directory, "state.json");
    const helper = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const statePath = process.env.CC_NIRI_TEST_STATE;
const state = JSON.parse(fs.readFileSync(statePath));
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
if (name === 'kwriteconfig6') {
    if (!args.includes('PerOutputVirtualDesktops')) throw new Error('unexpected setting');
    state.setting = args.at(-1);
    state.writes.push(state.setting);
} else if (name === 'gdbus') {
    const method = args[args.indexOf('--method') + 1];
    if (method.endsWith('supportInformation')) {
        if (state.queryRejected) process.exit(1);
        if (state.pending > 0 && --state.pending === 0) state.runtime = state.setting;
        console.log(state.unsupported ? "('old KWin',)" : "('perOutputVirtualDesktops: " + state.runtime + "',)");
    } else if (method.endsWith('reconfigure')) {
        if (state.reconfigureRejected) process.exit(1);
        if (state.delay) state.pending = state.delay;
        else state.runtime = state.setting;
        console.log('()');
    } else throw new Error('unexpected D-Bus method ' + method);
}
fs.writeFileSync(statePath, JSON.stringify(state));
`;
    for (const name of ["gdbus", "kwriteconfig6", "kreadconfig6", "systemctl"]) {
        fs.writeFileSync(path.join(directory, name), helper, { mode: 0o755 });
    }
    const run = (mode, overrides = {}) => {
        fs.writeFileSync(statePath, JSON.stringify({ setting: "false", runtime: "false", writes: [], ...overrides }));
        const result = spawnSync("/usr/bin/bash", [path.join(__dirname, "../cc-niri"), "workspace", mode], {
            encoding: "utf8", env: { ...process.env, PATH: directory + ":" + process.env.PATH, CC_NIRI_TEST_STATE: statePath },
        });
        return { ...result, state: JSON.parse(fs.readFileSync(statePath)) };
    };
    const primary = run("primary");
    assert.equal(primary.status, 0, primary.stderr);
    assert.equal(primary.state.runtime, "true");
    assert.deepEqual(primary.state.writes, ["true"]);
    const delayed = run("primary", { delay: 3 });
    assert.equal(delayed.status, 0, delayed.stderr);
    assert.equal(delayed.state.runtime, "true", "queued KWin reconfigure must be verified after it applies");
    const global = run("global", { setting: "true", runtime: "true" });
    assert.equal(global.status, 0, global.stderr);
    assert.equal(global.state.runtime, "false");
    const status = run("status");
    assert.equal(status.status, 0);
    assert.deepEqual(status.state.writes, []);
    const already = run("primary", { setting: "true", runtime: "true" });
    assert.equal(already.status, 0);
    assert.deepEqual(already.state.writes, []);
    for (const overrides of [{ unsupported: true }, { queryRejected: true }]) {
        const rejected = run("primary", overrides);
        assert.equal(rejected.status, 1);
        assert.deepEqual(rejected.state.writes, []);
    }
    const applyFailure = run("primary", { reconfigureRejected: true });
    assert.equal(applyFailure.status, 1);
    assert.deepEqual(applyFailure.state.writes, ["true", "false"]);
    assert.equal(applyFailure.state.setting, "false", "failed reconfigure cannot leave next-login mode changed");
    assert.equal(applyFailure.state.runtime, "false");
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
console.log("PASS workspace mode CLI uses native per-output desktops and restores rejected settings");
