"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const native = process.argv.includes("--native");

function run(label, command, args) {
    process.stdout.write(`\n== ${label} ==\n`);
    const result = spawnSync(command, args, {
        cwd: root,
        encoding: "utf8",
        stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

const tests = fs.readdirSync(path.join(root, "test"))
    .filter(name => name.endsWith(".test.js"))
    .sort()
    .map(name => path.join("test", name));

run("generated runtime bundles", process.execPath, ["tools/build.js", "--check"]);
run("production module regression suite", process.execPath, ["--test", ...tests]);
run("patch whitespace", "git", ["diff", "--check"]);

if (native) {
    run("Bridge native build", "cmake", ["--build", "build/bridge"]);
    run("Viewport clip native build", "cmake", ["--build", "build/native-viewport-clip"]);
    run("Plasmoid native build", "cmake", ["--build", "build/plasmoid"]);
}

process.stdout.write(`\nPASS CC Niri regression gate (${tests.length} tests)` +
    `${native ? " with native builds" : ""}\n`);
