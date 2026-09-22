const assert = require("node:assert/strict");
const { loadRuntimeConfig } = require("../src/kwin/runtime/RuntimeConfig");
const { OutputTopology } = require("../src/kwin/runtime/OutputTopology");
const { computeSafeRect } = require("../src/kwin/layout/SafeArea");

const values = new Map([
    ["TargetOutputName", " missing-primary "],
    ["GapTop", 50],
    ["GapBottom", 70],
    ["InnerGap", 12],
    ["SecondaryOutputName", " missing-secondary "],
    ["SecondaryGapLeft", 30],
]);
const config = loadRuntimeConfig((key, fallback) =>
    values.has(key) ? values.get(key) : fallback);
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

console.log("PASS runtime config and output topology use production modules");
