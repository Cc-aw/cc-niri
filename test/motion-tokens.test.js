const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    SAFE_RIGHT_EDGE_SLIDE_X,
    UNARMED_TRANSACTION_TTL_MS,
    PRESENTATION_MIN_WIDTH_RATIO,
    PRESENTATION_MAX_WIDTH_RATIO,
    CC_NIRI_VIEWPORT_CLIP_ROLE,
    CC_NIRI_VIEWPORT_CLIP_CAPABILITY_ROLE,
    MotionTokens,
    MotionCurves,
    MotionType,
} = require("../src/effect/MotionTokens.js");

assert.equal(SAFE_RIGHT_EDGE_SLIDE_X, 20);
assert.equal(UNARMED_TRANSACTION_TTL_MS, 80);
assert.equal(PRESENTATION_MIN_WIDTH_RATIO, 0.65);
assert.equal(PRESENTATION_MAX_WIDTH_RATIO, 0.85);
assert.equal(CC_NIRI_VIEWPORT_CLIP_ROLE, 1001);
assert.equal(CC_NIRI_VIEWPORT_CLIP_CAPABILITY_ROLE, 1002);
assert.deepEqual(MotionTokens, {
    microPressMs: 90,
    microHoverMs: 110,
    fastMs: 170,
    spatialMs: 220,
    spatialFastMs: 190,
    resizeMs: 300,
    expressiveEnterMs: 320,
    expressiveExitMs: 240,
    subtleIncomingScale: 0.985,
    subtleIncomingOpacity: 0.85,
    retargetMinMs: 110,
    retargetMidMs: 160,
});
assert.deepEqual(MotionCurves, {
    standardDecel: "standardDecel",
    expressiveSpatial: "expressiveSpatial",
});
assert.equal(MotionType.WIDE_EXIT, "WIDE_EXIT");
assert.equal(Object.isFrozen(MotionTokens), true);
assert.equal(Object.isFrozen(MotionCurves), true);
assert.equal(Object.isFrozen(MotionType), true);

const effectPath = path.join(__dirname, "../effect/contents/code/main.js");
const effectSource = fs.readFileSync(effectPath, "utf8");
assert.match(effectSource, /Generated from src\/effect\/MotionTokens\.js/);
assert.equal((effectSource.match(/const MotionTokens =/g) || []).length, 1);
assert.equal((effectSource.match(/const MotionCurves =/g) || []).length, 1);
assert.equal((effectSource.match(/const MotionType =/g) || []).length, 1);

console.log("PASS MotionTokens is the generated Effect token source");
