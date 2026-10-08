const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadRuntimeConfig } = require("../src/kwin/runtime/RuntimeConfig");
const { OutputTopology } = require("../src/kwin/runtime/OutputTopology");
const { computeSafeRect } = require("../src/kwin/layout/SafeArea");
const { deriveColumnLayout } = require("../src/kwin/layout/ColumnLayout");
const { projectColumnRect } = require("../src/kwin/layout/Projection");

const values = new Map([
    ["TargetOutputName", " missing-primary "],
    ["GapTop", 50],
    ["GapBottom", 70],
    ["InnerGap", 12],
    ["SecondaryOutputName", " missing-secondary "],
    ["SecondaryGapLeft", 30],
]);
const readKeys = [];
const config = loadRuntimeConfig((key, fallback) => {
    readKeys.push(key);
    return values.has(key) ? values.get(key) : fallback;
});
assert.equal(readKeys.includes("IncludeDialogs"), false);
assert.equal("includeDialogs" in config, false);
for (const configFile of ["package/contents/config/main.xml",
    "package/contents/ui/config.ui"]) {
    assert.equal(fs.readFileSync(path.join(__dirname, "..", configFile),
        "utf8").includes("IncludeDialogs"), false, configFile);
}
assert.equal(config.targetOutputName, "missing-primary");
assert.equal(config.primary.inner, 12);
assert.equal(config.secondary.left, 30);

const left = { name: "DP-1", geometry: { x: 0, y: 0, width: 2560, height: 1440 } };
const right = { name: "HDMI-A-1", geometry: { x: 2560, y: 0, width: 1920, height: 1080 } };
const warnings = [];
const topology = new OutputTopology({
    getScreens: () => [right, left],
    config,
    computeSafeRect,
    warn: message => warnings.push(message),
});

assert.equal(topology.primary(), left, "missing primary falls back to leftmost");
assert.equal(topology.secondary(), right,
    "missing secondary falls back to rightmost non-primary");
assert.deepEqual(topology.managed(), [left, right]);
assert.deepEqual(topology.safeRect(left), {
    x: 24,
    y: 50,
    width: 2512,
    height: 1320,
});
assert.deepEqual(topology.safeRect(right), {
    x: 2590,
    y: 24,
    width: 1866,
    height: 1032,
});
topology.primary();
topology.secondary();
assert.equal(warnings.length, 2, "each missing configured output warns only once");

const disabled = new OutputTopology({
    getScreens: () => [left, right],
    config: { ...config, manageSecondaryOutput: false },
    computeSafeRect,
    warn: () => {},
});
assert.equal(disabled.secondary(), null);
assert.deepEqual(disabled.managed(), [left]);

// Missing configuration adopts the compact primary profile; explicit settings
// keep their geometry, including zero and independent secondary gaps.
const defaults = loadRuntimeConfig((_key, fallback) => fallback);
assert.equal(defaults.dockIntegration, false);
assert.equal(loadRuntimeConfig((key, fallback) =>
    key === "EnableDockIntegration" ? true : fallback).dockIntegration, true);
const defaultTopology = new OutputTopology({
    getScreens: () => [left, right], config: defaults, computeSafeRect,
    warn: () => {},
});
const compactSafe = defaultTopology.safeRect(left);
assert.deepEqual(compactSafe, { x: 24, y: 50, width: 2512, height: 1382 });
const pair = deriveColumnLayout([{ widthMode: "half" }, { widthMode: "half" }],
    compactSafe.width, defaults.primary.inner)
    .map(column => projectColumnRect(column, compactSafe, 0));
assert.deepEqual(pair, [
    { x: 24, y: 50, width: 1252, height: 1382 },
    { x: 1284, y: 50, width: 1252, height: 1382 },
]);
assert.equal(pair[1].x - pair[0].x - pair[0].width, 8);
assert.equal(left.geometry.height - pair[0].y - pair[0].height, 8);
assert.deepEqual(defaultTopology.safeRect(right), {
    x: 2584, y: 24, width: 1872, height: 1032,
});
for (const bottom of [0, 60, 70]) {
    const custom = loadRuntimeConfig((key, fallback) =>
        key === "GapBottom" ? bottom : key === "SecondaryGapBottom" ? 60 : fallback);
    const customTopology = new OutputTopology({
        getScreens: () => [left, right], config: custom, computeSafeRect,
        warn: () => {},
    });
    assert.equal(customTopology.safeRect(left).height, 1440 - 50 - bottom);
    assert.equal(customTopology.safeRect(right).height, 1080 - 24 - 60);
}

console.log("PASS runtime config and output topology use production modules");
