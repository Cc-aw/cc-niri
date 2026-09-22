const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const result = spawnSync(
    process.execPath,
    [path.join(root, "tools/build.js"), "--check"],
    { cwd: root, encoding: "utf8" }
);

assert.equal(
    result.status,
    0,
    `generated runtime bundle is stale:\n${result.stdout}${result.stderr}`
);

console.log("PASS generated KWin and Effect bundles match source modules");
