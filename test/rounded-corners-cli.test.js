"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Drive the real lifecycle CLI; only platform configuration and D-Bus are mocked.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-corners-cli-"));
try {
    const keys = ["DisableRoundTile", "UseSquircleShape"];
    const configKey = key => "Round-Corners/" + key;
    const savedKey = key => "CCNiriCompatibility/RoundCorners" + key + "Previous";
    const pendingKey = "CCNiriCompatibility/RoundCornersPending";
    const root = path.join(directory, "state");
    for (const name of ["gdbus", "kwriteconfig6", "kreadconfig6", "systemctl", "sleep"]) {
        fs.copyFileSync(path.join(__dirname, "helpers/corners-platform.sh"), path.join(directory, name));
        fs.chmodSync(path.join(directory, name), 0o755);
    }
    const installed = path.join(directory, "data/kwin/scripts/cc-niri-maximize/contents/code");
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, "main.js"), "");
    const put = (relative, value = "") => {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, value);
    };
    const get = relative => fs.existsSync(path.join(root, relative)) ? fs.readFileSync(path.join(root, relative), "utf8") : undefined;
    const setConfig = (key,value) => put("config/"+key,value);
    const config = key => get("config/"+key);
    const initialize = (values = {}, { loaded = true, effect = true } = {}) => {
        fs.rmSync(root, { recursive: true, force: true });
        for (const name of ["config", "effects", "applied", "faults"]) fs.mkdirSync(path.join(root, name), { recursive: true });
        put("loaded", String(loaded)); put("calls");
        if (effect) put("effects/kwin4_effect_shapecorners");
        for (const [key,value] of Object.entries(values)) setConfig(key,value);
    };
    const fault = (kind,key,occurrences = [1]) => put("faults/"+kind+"/"+key,occurrences.join(" "));
    const calls = () => get("calls").trim().split("\n").filter(Boolean).map(line => line.split("\t"));
    const mutations = list => list.filter(c => c[0] === "kwriteconfig6" || c.includes("org.kde.kwin.Effects.reconfigureEffect"));
    const run = (command, status = 0) => {
        const result = spawnSync("/usr/bin/bash", [path.join(__dirname, "../cc-niri"), command], {
            encoding: "utf8", timeout: 10000,
            env: { ...process.env, PATH: directory+":"+process.env.PATH,
                XDG_DATA_HOME: path.join(directory, "data"), CC_NIRI_CORNERS_TEST_ROOT: root },
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, status, result.stderr);
        return result;
    };
    const assertRestored = (preferences = [undefined,undefined]) => keys.forEach((key,i) => {
        assert.equal(config(configKey(key)), preferences[i], key);
        assert.equal(config(savedKey(key)), undefined, key+" backup");
    });
    for (const tile of [undefined, "true", "false"]) {
        for (const shape of [undefined, "true", "false"]) {
            const preferences = [tile,shape];
            const original = { "Round-Corners/Size":"12", "Round-Corners/InactiveCornerRadius":"12",
                "Round-Corners/DisableRoundFullScreen":"true", "Round-Corners/DisableRoundMaximize":"true" };
            keys.forEach((key,i) => { if (preferences[i] !== undefined) original[configKey(key)] = preferences[i]; });
            initialize(original); run("start");
            assert.ok(!calls().some(c => c.includes("org.kde.kwin.Effects.unloadEffect") || c.includes("org.kde.kwin.Scripting.unloadScript")));
            for (const key of keys) assert.equal(config(configKey(key)), "false");
            if (preferences.some(value => value !== "false")) for (const key of keys) assert.equal(get("applied/"+key), "false");
            const count = calls().length;
            run("start");
            assert.deepEqual(mutations(calls().slice(count)), [], "repeat start must not write or reconfigure");
            keys.forEach((key,i) => assert.equal(config(savedKey(key)), preferences[i] ?? "absent"));
            const beforeStatus = calls().length;
            assert.match(run("status").stdout, /compatibility configured: true; saved preferences: 2; pending: none/);
            assert.deepEqual(mutations(calls().slice(beforeStatus)), [], "status is read-only");
            run("stop"); assertRestored(preferences);
            for (const [key,value] of Object.entries(original)) assert.equal(config(key),value);
            assert.equal(config(pendingKey), undefined);
            const stoppedCount = calls().length;
            run("stop"); assertRestored(preferences);
            assert.ok(!mutations(calls().slice(stoppedCount)).some(c => c.includes("Round-Corners") || c.includes("CCNiriCompatibility") || c.at(-1) === "kwin4_effect_shapecorners"));
        }
    }
    initialize(Object.fromEntries(keys.map(key=>[configKey(key),"false"])), {loaded:false}); run("start");
    assert.equal(get("applied/"+keys[0]),"false","cold start must synchronize an already loaded effect");
    initialize({}, {effect:false}); run("start");
    assert.equal(config(savedKey(keys[0])),undefined);
    assert.match(run("status").stdout,/Rounded Corners loaded: \(false,\)/);
    put("effects/kwin4_effect_shapecorners");
    assert.match(run("status").stdout,/Run cc-niri start/);
    run("start"); assert.equal(config(configKey(keys[0])),"false","late-loaded effect can be explicitly applied");
    initialize(); run("start"); setConfig(configKey(keys[0]),"true"); run("stop");
    assertRestored(["true",undefined]);
    for (const key of keys) {
        initialize(); fault("read",configKey(key)); run("start",1);
        assert.deepEqual(mutations(calls()),[],"read failure must precede all writes");
        initialize(); fault("write",savedKey(key)); run("start",1); assertRestored();
        assert.ok(!calls().some(c=>c[0]==="kwriteconfig6" && c.includes("Round-Corners")),"backup failure changed live settings");
        initialize(); fault("write",configKey(key)); run("start",1); assertRestored();
    }
    initialize(); fault("dbus","reconfigureEffect"); run("start",1); assertRestored();
    assert.equal(config(pendingKey),undefined);
    initialize(); fault("write",pendingKey); run("start",1); assertRestored();
    initialize(); fault("write",pendingKey,[2]); run("start",1);
    assert.equal(config(pendingKey),"start","failed apply marker cleanup lost its retry record");
    run("start"); run("stop"); assertRestored();
    // A failed retry rolls back its entry snapshot, not the historical defaults.
    initialize(); run("start"); setConfig(configKey(keys[1]),"true"); fault("dbus","reconfigureEffect"); run("start",1);
    assert.equal(config(configKey(keys[0])),"false"); assert.equal(config(configKey(keys[1])),"true");
    for (const key of keys) assert.equal(config(savedKey(key)),"absent");
    initialize(); fault("dbus","reconfigureEffect",[1,2]); run("start",1);
    assert.equal(config(pendingKey),"start");
    assert.match(run("status").stdout,/pending: start/);
    run("start"); assert.equal(config(pendingKey),undefined); run("stop"); assertRestored();
    initialize(); fault("dbus","reconfigureEffect"); fault("write",configKey(keys[0]),[2]); run("start",1);
    assert.equal(config(pendingKey),"start","failed rollback write lost its retry record");
    for (const key of keys) assert.equal(config(savedKey(key)),"absent");
    run("start"); run("stop"); assertRestored();
    // Existing correct settings with an unfinished apply still need one reload.
    initialize(Object.fromEntries(keys.flatMap(key=>[[configKey(key),"false"],[savedKey(key),"absent"]])));
    setConfig(pendingKey,"start"); run("start"); assert.equal(get("applied/"+keys[0]),"false");
    for (const [kind,key,occurrences] of [["write",configKey(keys[0])],["read",configKey(keys[1])],
        ["write",savedKey(keys[1])],["write",pendingKey],["write",pendingKey,[2]],
        ["dbus","reconfigureEffect"],["dbus","isEffectLoaded"]]) {
        initialize(); run("start"); fault(kind,key,occurrences); run("stop",1);
        assert.equal(get("loaded"),"false","layout was not safely unloaded");
        assert.ok(fs.existsSync(path.join(root,"bridge-disabled")),"corner failure prevented Bridge cleanup");
        // Faults count calls independently, so their first failing call has been consumed.
        run("stop"); assertRestored(); assert.equal(config(pendingKey),undefined);
    }
    initialize(); run("start"); put("blocked-recovery"); const before = calls().length;
    run("stop",1);
    assert.equal(get("loaded"),"true"); assert.equal(get("bridge-disabled"),undefined);
    assert.deepEqual(mutations(calls().slice(before)),[],"unconfirmed parked recovery allowed mutation");
    initialize(); run("start"); fault("dbus","unloadScript"); run("stop",1);
    assert.equal(get("bridge-disabled"),undefined,"failed layout unload must keep Bridge");
    initialize({[configKey(keys[1])]:"invalid"}); run("start",1); assert.deepEqual(mutations(calls()),[]);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log("PASS rounded corner transactions, retry recovery, zero-write repeat start, safe stop and read-only status");
