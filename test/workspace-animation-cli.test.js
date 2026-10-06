"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Exercise the actual start/stop entry points with platform I/O substituted.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-animation-cli-"));
try {
    const statePath = path.join(directory, "state.json");
    const installed = path.join(directory, "data/kwin/scripts/cc-niri-maximize/contents/code");
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, "main.js"), "");
    const helper = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const file = process.env.CC_NIRI_TEST_STATE;
const state = JSON.parse(fs.readFileSync(file));
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const argument = key => args[args.indexOf(key)+1];
if (name === 'kreadconfig6') {
    const key = argument('--group')+'/'+argument('--key');
    console.log(state.config[key] ?? argument('--default'));
} else if (name === 'kwriteconfig6') {
    const key = argument('--group')+'/'+argument('--key');
    if (args.includes('--delete')) delete state.config[key];
    else state.config[key] = args.at(-1);
    state.writes.push(key);
} else if (name === 'gdbus') {
    const method = argument('--method');
    const value = args.at(-1);
    if (method.endsWith('isScriptLoaded')) console.log('('+state.loaded+',)');
    else if (method.endsWith('unloadScript')) { state.loaded = false; console.log('(true,)'); }
    else if (method.endsWith('loadScript')) console.log('(7,)');
    else if (method.endsWith('Script.run')) {
        if (!state.clipReconfigured) throw new Error('layout started before native settings applied');
        state.loaded = true; console.log('()');
    }
    else if (method.endsWith('unloadEffect')) { state.effects = state.effects.filter(e => e !== value); state.unloaded.push(value); console.log('()'); }
    else if (method.endsWith('loadEffect')) { state.effects.push(value); console.log('(true,)'); }
    else if (method.endsWith('shortcutNames')) console.log("(['CCScrollEmergencyRestore'],)");
    else if (method.endsWith('invokeShortcut')) console.log('()');
    else if (method.endsWith('reconfigureEffect')) {
        if (value !== 'cc-niri-viewport-clip' || !state.effects.includes(value)) throw new Error('reconfigure before native load');
        state.clipReconfigured = true; console.log('()');
    }
    else if (method.endsWith('GetScrollMotionStatus')) {
        console.log("('" + JSON.stringify(state.unsupported ? {} : {workspaceAnimationEnabled:true}) + "',)");
    }
    else if (method.endsWith('reconfigure')) console.log('()');
    else throw new Error('Unexpected D-Bus method '+method);
}
fs.writeFileSync(file, JSON.stringify(state));
`;
    for (const name of ["gdbus", "kwriteconfig6", "kreadconfig6", "systemctl", "sleep"]) {
        fs.writeFileSync(path.join(directory, name), helper, { mode: 0o755 });
    }
    const run = (command, status = 0) => {
        const result = spawnSync("/usr/bin/bash", [path.join(__dirname, "../cc-niri"), command], {
            encoding: "utf8", env: { ...process.env, PATH: directory+":"+process.env.PATH,
                XDG_DATA_HOME: path.join(directory, "data"), CC_NIRI_TEST_STATE: statePath },
        });
        assert.equal(result.status, status, result.stderr);
        return JSON.parse(fs.readFileSync(statePath));
    };
    for (const optimized of [false, true]) {
        for (const preference of [undefined, "true", "false"]) {
            const config = { "Effect-cc-niri-viewport-clip/OptimizedWorkspaceAnimation": String(optimized) };
            if (preference !== undefined) config["Plugins/slideEnabled"] = preference;
            fs.writeFileSync(statePath, JSON.stringify({ config, loaded: false, effects: ["slide"], writes: [], unloaded: [] }));
            const started = run("start");
            if (optimized) {
                assert.equal(started.config["Plugins/slideEnabled"], "false");
                assert.equal(started.config["CCNiriCompatibility/SlideWasEnabled"], preference ?? "true");
                assert.equal(started.effects.includes("slide"), false, "only one workspace animation owner may load");
            } else {
                assert.equal(started.config["Plugins/slideEnabled"], preference, "legacy animation preference changed");
                assert.equal(started.unloaded.includes("slide"), false);
            }
            const restarted = run("start");
            assert.equal(restarted.config["CCNiriCompatibility/SlideWasEnabled"], started.config["CCNiriCompatibility/SlideWasEnabled"], "repeat start overwrote saved preference");
            const stopped = run("stop");
            assert.equal(stopped.loaded, false);
            assert.equal(stopped.config["CCNiriCompatibility/SlideWasEnabled"], undefined, "saved ownership must retire after stop");
            assert.equal(stopped.config["Plugins/slideEnabled"], optimized ? (preference ?? "true") : preference, "stop did not restore Slide preference");
            assert.equal(stopped.writes.includes("KDE/AnimationDurationFactor"), false, "workspace animation must not change global KDE speed");
            run("stop"); // A second stop cannot restore a stale saved preference.
        }
    }
    for (const preference of ["true", "false"]) {
        fs.writeFileSync(statePath, JSON.stringify({ config: {
            "Effect-cc-niri-viewport-clip/OptimizedWorkspaceAnimation": "true", "Plugins/slideEnabled": preference },
            loaded: false, effects: ["slide"], writes: [], unloaded: [], unsupported: true }));
        const rejected = run("start", 1);
        assert.equal(rejected.loaded, false, "unsupported native settings cannot start the layout");
        assert.equal(rejected.config["Plugins/slideEnabled"], preference, "rejection must restore Slide preference");
        assert.equal(rejected.config["Plugins/cc-niri-viewport-clipEnabled"], "false");
        assert.equal(rejected.effects.includes("cc-niri-viewport-clip"), false);
        assert.equal(rejected.config["CCNiriCompatibility/SlideWasEnabled"], undefined);
    }
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log("PASS workspace animation start/stop isolates one owner and restores enabled/disabled Slide preferences");
