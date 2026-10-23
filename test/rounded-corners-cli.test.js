"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Drive the real lifecycle CLI; only platform configuration and D-Bus are mocked.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-corners-cli-"));
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
const save = () => fs.writeFileSync(file, JSON.stringify(state));
if (name === 'kreadconfig6') {
    console.log(state.config[argument('--group')+'/'+argument('--key')] ?? argument('--default'));
} else if (name === 'kwriteconfig6') {
    const key = argument('--group')+'/'+argument('--key');
    if (state.rejectWrite === key) { delete state.rejectWrite; save(); process.exit(1); }
    if (args.includes('--delete')) delete state.config[key];
    else state.config[key] = args.at(-1);
    state.writes.push(key);
} else if (name === 'gdbus') {
    const method = argument('--method');
    const value = args.at(-1);
    state.calls.push([method,value]);
    if (method.endsWith('isScriptLoaded')) console.log('('+state.loaded+',)');
    else if (method.endsWith('isEffectLoaded')) console.log('('+state.effects.includes(value)+',)');
    else if (method.endsWith('unloadScript')) { state.loaded = false; console.log('(true,)'); }
    else if (method.endsWith('loadScript')) console.log('(7,)');
    else if (method.endsWith('Script.run')) { state.loaded = true; console.log('()'); }
    else if (method.endsWith('loadEffect')) { state.effects.push(value); console.log('(true,)'); }
    else if (method.endsWith('unloadEffect')) { state.effects = state.effects.filter(e => e !== value); console.log('()'); }
    else if (method.endsWith('shortcutNames')) console.log("(['CCScrollEmergencyRestore'],)");
    else if (method.endsWith('reconfigureEffect') && value === 'kwin4_effect_shapecorners') {
        if (state.rejectApply) { delete state.rejectApply; save(); process.exit(1); }
        state.applied = { ...state.config }; console.log('()');
    } else console.log('()');
}
save();
`;
    for (const name of ["gdbus", "kwriteconfig6", "kreadconfig6", "systemctl", "sleep"]) {
        fs.writeFileSync(path.join(directory, name), helper, { mode: 0o755 });
    }
    const keys = ["DisableRoundTile", "UseSquircleShape"];
    const configKey = key => "Round-Corners/" + key;
    const savedKey = key => "CCNiriCompatibility/RoundCorners" + key + "Previous";
    const initialize = (config = {}, overrides = {}) => fs.writeFileSync(statePath, JSON.stringify({
        loaded: true, effects: ["kwin4_effect_shapecorners"], writes: [], calls: [], config, ...overrides,
    }));
    const read = () => JSON.parse(fs.readFileSync(statePath));
    const run = (command, status = 0) => {
        const result = spawnSync("/usr/bin/bash", [path.join(__dirname, "../cc-niri"), command], {
            encoding: "utf8", env: { ...process.env, PATH: directory+":"+process.env.PATH,
                XDG_DATA_HOME: path.join(directory, "data"), CC_NIRI_TEST_STATE: statePath },
        });
        assert.equal(result.status, status, result.stderr);
        return read();
    };
    for (const tile of [undefined, "true", "false"]) {
        for (const shape of [undefined, "true", "false"]) {
            const preferences = [tile, shape];
            const config = { "Round-Corners/Size": "12", "Round-Corners/InactiveCornerRadius": "12",
                "Round-Corners/DisableRoundFullScreen": "true", "Round-Corners/DisableRoundMaximize": "true" };
            keys.forEach((key,i) => { if (preferences[i] !== undefined) config[configKey(key)] = preferences[i]; });
            initialize(config);
            const started = run("start");
            assert.ok(!started.calls.some(([method]) => /unload|loadEffect|loadScript/.test(method)), "hot apply must leave all running components loaded");
            for (const key of keys) assert.equal(started.applied[configKey(key)], "false");
            const repeated = run("start");
            keys.forEach((key,i) => assert.equal(repeated.config[savedKey(key)], preferences[i] ?? "absent"));
            const stopped = run("stop");
            for (const [key,value] of Object.entries(config)) assert.equal(stopped.config[key], value);
            keys.forEach((key,i) => {
                assert.equal(stopped.config[configKey(key)], preferences[i]);
                assert.equal(stopped.config[savedKey(key)], undefined);
            });
            const twice = run("stop");
            assert.deepEqual(twice.config, stopped.config, "second stop changed restored preferences");
        }
    }
    initialize({}, { loaded: false });
    assert.equal(run("start").applied[configKey(keys[0])], "false", "cold start omitted compatibility");
    initialize({}, { effects: [] });
    assert.deepEqual(run("start").config, {}, "absent corner effect must remain optional");
    initialize(); run("start");
    const edited = read(); edited.config[configKey(keys[0])] = "true";
    fs.writeFileSync(statePath, JSON.stringify(edited));
    const stopped = run("stop");
    assert.equal(stopped.config[configKey(keys[0])], "true", "stop overwrote a later user edit");
    assert.equal(stopped.config[configKey(keys[1])], undefined);
    initialize({}, { rejectApply: true });
    const rejected = run("start", 1);
    for (const key of keys) {
        assert.equal(rejected.config[configKey(key)], undefined, "failed apply did not restore missing key");
        assert.equal(rejected.config[savedKey(key)], undefined);
    }
    initialize({}, { rejectWrite: configKey(keys[1]) });
    const writeFailure = run("start", 1);
    for (const key of keys) assert.equal(writeFailure.config[configKey(key)], undefined, "partial write was not rolled back");
    initialize({ [configKey(keys[1])]: "invalid" });
    assert.deepEqual(run("start", 1).writes, [], "invalid preference caused partial mutation");
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log("PASS rounded corner hot/cold lifecycle, exact preference restoration, optional effect and failed apply rollback");
