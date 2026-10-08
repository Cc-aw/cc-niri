"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-niri-dockless-install-"));
const bin = path.join(temp, "bin"), home = path.join(temp, "home"), log = path.join(temp, "log"), config = path.join(temp, "config");
fs.mkdirSync(bin); fs.mkdirSync(home);
fs.copyFileSync(path.join(root, "install.sh"), path.join(temp, "install.sh"));
const mock = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const command=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync(process.env.INSTALL_LOG,JSON.stringify([command,...args])+'\\n');
const value=flag=>args[args.indexOf(flag)+1];
const settings=JSON.parse(fs.readFileSync(process.env.INSTALL_CONFIG));
const key=value('--group')+'/'+value('--key');
if(command==='find')console.log('/mock/cmake/KWin/KWinConfig.cmake');
if(command==='kreadconfig6')console.log(settings[key]??value('--default'));
if(command==='kwriteconfig6'){
 if(args.includes('--delete'))delete settings[key];else settings[key]=args.at(-1);
 fs.writeFileSync(process.env.INSTALL_CONFIG,JSON.stringify(settings));
}
`;
for (const name of ["gdbus", "cargo", "rustc", "node", "kpackagetool6", "kwriteconfig6", "kreadconfig6", "cmake", "find", "python3", "install", "kbuildsycoca6", "systemctl"])
    fs.writeFileSync(path.join(bin, name), mock, { mode: 0o755 });
fs.mkdirSync(path.join(temp, "build/bridge"), { recursive: true });
fs.writeFileSync(path.join(temp, "build/bridge/cc-scroll-dock-bridge"), mock, { mode: 0o755 });
fs.writeFileSync(path.join(temp, "cc-niri"), mock, { mode: 0o755 });
function run(args, dockSetting) {
    fs.writeFileSync(log, "");
    fs.writeFileSync(config, JSON.stringify({ "Script-cc-niri-maximize/GapBottom": "60",
        ...(dockSetting === undefined ? {} : { "Script-cc-niri-maximize/EnableDockIntegration": dockSetting }) }));
    const result = spawnSync("bash", [path.join(temp, "install.sh"), ...args], {
        encoding: "utf8", env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
            INSTALL_LOG: log, INSTALL_CONFIG: config },
    });
    return { ...result, calls: fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)),
        settings: JSON.parse(fs.readFileSync(config, "utf8")) };
}
function checkCore(result) {
    assert.equal(result.status, 0, result.stderr);
    const cmake = result.calls.filter(call => call[0] === "cmake");
    for (const name of ["native-viewport-clip", "native-focus-ring", "bridge"]) {
        assert.ok(cmake.some(call => call.includes("-B") && call.includes(path.join(temp, "build", name))));
        if (name === "bridge") assert.ok(cmake.some(call => call.includes("--install") && call.includes(path.join(temp, "build", name))));
    }
    for (const call of cmake.filter(call => call.includes("-S")))
        assert.ok(call.includes("-DCMAKE_CXX_COMPILER=/usr/bin/g++"), "optional installation preserves the toolchain guard");
    const save = result.calls.findIndex(call => call[0] === "cc-scroll-dock-bridge" && call.includes("--save-current-state"));
    const stop = result.calls.findIndex(call => call[0] === "cc-niri" && call.includes("stop"));
    const install = result.calls.findIndex(call => call[0] === "python3");
    const start = result.calls.findIndex(call => call[0] === "cc-niri" && call.includes("start"));
    assert.ok(save >= 0 && save < stop && stop < install && install < start);
    assert.equal(result.settings["Script-cc-niri-maximize/GapBottom"], "60");
    assert.ok(result.calls.some(call => call[0] === "kpackagetool6" && call.includes("--type=KWin/Script")));
    assert.ok(result.calls.some(call => call[0] === "kpackagetool6" && call.includes("--type=KWin/Effect")));
}
try {
    for (const setting of [undefined, "false", "true"]) {
        const result = run([], setting); checkCore(result);
        assert.equal(result.calls.some(call => call[0] === "cmake" && call.includes(path.join(temp, "build/plasmoid"))), false);
        assert.equal(result.calls.some(call => call.includes("EnableDockIntegration")), false, "core install preserves the user's explicit Dock preference");
        assert.equal(result.settings["Script-cc-niri-maximize/EnableDockIntegration"], setting);
        assert.equal(result.calls.some(call => call[0] === "systemctl" && call.includes("plasma-plasmashell.service")), false);
        assert.equal(result.calls.some(call => call.includes("--remove")), false, "core install does not remove existing Dock packages");
    }
    const result = run(["--with-dock"], "false"); checkCore(result);
    assert.ok(result.calls.some(call => call[0] === "cmake" && call.includes("-S") && call.includes(path.join(temp, "build/plasmoid"))));
    assert.ok(result.calls.some(call => call[0] === "cmake" && call.includes("--install") && call.includes(path.join(temp, "build/plasmoid"))));
    assert.equal(result.settings["Script-cc-niri-maximize/EnableDockIntegration"], "true");
    assert.ok(result.calls.some(call => call[0] === "systemctl" && call.includes("restart") && call.includes("plasma-plasmashell.service")));
    for (const args of [["--help"], ["--bad-option"]]) {
        const result = run(args); assert.equal(result.status, args[0] === "--help" ? 0 : 2);
        assert.deepEqual(result.calls, [], "help / rejected options cannot mutate the desktop");
    }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log("PASS P7 installer: default core-only and explicit Dock paths, compiler selection, lifecycle order, existing Dock/settings preservation and no default Plasma restart");
