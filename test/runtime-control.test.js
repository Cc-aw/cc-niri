"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-control-"));
const bin = path.join(temp, "bin"); fs.mkdirSync(bin);
const mock = `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const command = path.basename(process.argv[1]); const args = process.argv.slice(2);
fs.appendFileSync(process.env.CONTROL_LOG, JSON.stringify([command, ...args]) + '\\n');
let state = JSON.parse(fs.readFileSync(process.env.CONTROL_STATE));
function save() { fs.writeFileSync(process.env.CONTROL_STATE, JSON.stringify(state)); }
if (command === 'gdbus') {
 const method = args[args.indexOf('--method') + 1]; const last = args.at(-1);
 if (method.endsWith('.isScriptLoaded')) {
  if (process.env.QUERY_FAIL) process.exit(1);
  console.log(state.loaded ? '(true,)' : '(false,)');
 } else if (method.endsWith('.shortcutNames')) console.log(process.env.RECOVERY_FAIL ? "([], )" : "(['CCScrollEmergencyRestore', 'CCScrollApplyDockCommand'],)");
 else if (method.endsWith('.RequestEmergencyRestore')) console.log('(false,)');
 else if (method.endsWith('.unloadScript')) { state.loaded = false; save(); console.log('(true,)'); }
 else if (method.endsWith('.loadScript')) { state.loaded = true; save(); console.log('(42,)'); }
 else if (method.endsWith('.loadEffect') || method.endsWith('.isEffectLoaded')) console.log('(true,)');
 else console.log('()');
} else if (command === 'kreadconfig6') console.log('false');
else if (command === 'systemctl' && args.includes('is-active')) console.log('active');
`;
for (const command of ["gdbus", "kwriteconfig6", "kreadconfig6", "systemctl", "sleep"]) {
    fs.writeFileSync(path.join(bin, command), mock, { mode: 0o755 });
}
const installed = path.join(temp, "data/kwin/scripts/cc-niri-maximize/contents/code/main.js");
fs.mkdirSync(path.dirname(installed), { recursive: true }); fs.writeFileSync(installed, "");
const log = path.join(temp, "log"); const stateFile = path.join(temp, "state");
function run(action, loaded, extra = {}) {
    fs.writeFileSync(log, ""); fs.writeFileSync(stateFile, JSON.stringify({ loaded }));
    const result = spawnSync("bash", [path.join(root, "cc-niri"), action], { encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_DATA_HOME: path.join(temp, "data"),
            CONTROL_LOG: log, CONTROL_STATE: stateFile, ...extra } });
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    return { ...result, calls, methods: calls.filter(c => c[0] === "gdbus").map(c => c[c.indexOf("--method") + 1]) };
}
try {
    let result = run("stop", true); assert.equal(result.status, 0, result.stderr);
    assert.ok(result.methods.indexOf("org.kde.kglobalaccel.Component.invokeShortcut") < result.methods.indexOf("org.kde.kwin.Scripting.unloadScript"));
    const unload = result.calls.findIndex(c => c.includes("org.kde.kwin.Scripting.unloadScript"));
    const bridgeStop = result.calls.findIndex(c => c[0] === "systemctl" && c.includes("disable"));
    assert.ok(unload < bridgeStop, "Bridge stops after runtime recovery/unload");
    result = run("stop", false); assert.equal(result.status, 0); assert.ok(!result.methods.some(m => m.endsWith(".invokeShortcut")));
    result = run("stop", true, { RECOVERY_FAIL: "1" }); assert.equal(result.status, 1);
    assert.ok(!result.methods.some(m => m.endsWith(".unloadScript"))); assert.ok(!result.calls.some(c => c[0] === "systemctl"));
    result = run("stop", true, { QUERY_FAIL: "1" }); assert.equal(result.status, 1); assert.equal(result.calls.length, 1);
    result = run("start", false); assert.equal(result.status, 0, result.stderr);
    assert.ok(result.methods.includes("org.kde.kwin.Script.run"));
    assert.ok(result.calls.some(c => c.includes("/Scripting/Script42")), "runs only the requested script");
    const effectLoads = result.calls.filter(c => c.includes("org.kde.kwin.Effects.loadEffect")).map(c => c.at(-1));
    assert.deepEqual(effectLoads, ["cc-niri-viewport-clip", "cc-niri-maximize-scroll-transition"]);
    assert.ok(result.methods.indexOf("org.kde.kwin.Effects.loadEffect") < result.methods.indexOf("org.kde.kwin.Scripting.loadScript"));
    result = run("start", true); assert.equal(result.status, 0); assert.equal(result.calls.length, 1);
    result = run("restart", true); assert.equal(result.status, 0, result.stderr);
    assert.ok(result.methods.indexOf("org.kde.kwin.Scripting.unloadScript") < result.methods.indexOf("org.kde.kwin.Scripting.loadScript"));
    result = run("status", true); assert.equal(result.status, 0); assert.match(result.stdout, /Script loaded: true/);
    result = run("invalid", true); assert.equal(result.status, 2); assert.equal(result.calls.length, 0);
    const installer = fs.readFileSync(path.join(root, "install.sh"), "utf8");
    assert.ok(installer.indexOf('"${SCRIPT_DIR}/cc-niri" stop') < installer.indexOf('cmake --install'));
    assert.ok(installer.includes('install -Dm755 "${SCRIPT_DIR}/cc-niri" "${HOME}/.local/bin/cc-niri"'));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log("PASS terminal lifecycle controls recover before unloading and deploy before restarting");
