const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { MotionCurves } = require("../src/effect/MotionTokens.js");
const {
    clampUnit,
    channelDistance,
    distanceAwareDuration,
    standardDecelProgress,
    interpolateValue,
    motionValuesEqual,
    retargetedTranslation,
    sampleMotionState,
    visualRectFor,
} = require("../src/effect/MotionSampler.js");

assert.equal(clampUnit(-0.5), 0);
assert.equal(clampUnit(1.5), 1);
assert.equal(standardDecelProgress(0.5), 0.875);
assert.equal(interpolateValue(10, 30, 0.25), 15);
assert.equal(channelDistance({
    from: { value1: 0, value2: 0 },
    to: { value1: 3, value2: 4 },
}), 5);
assert.equal(distanceAwareDuration(220, 100, 100), 220);
assert.equal(distanceAwareDuration(220, 50, 100), 160);
assert.equal(distanceAwareDuration(220, 20, 100), 110);
assert.equal(motionValuesEqual(
    { value1: 1, value2: 1 },
    { value1: 1, value2: 1 }
), true);

assert.deepEqual(sampleMotionState(null, 100), {
    active: false,
    progress: 1,
    translation: { value1: 0, value2: 0 },
    scale: { value1: 1, value2: 1 },
    opacity: 1,
});

const sampled = sampleMotionState({
    startTime: 100,
    duration: 200,
    curve: MotionCurves.standardDecel,
    channels: {
        translation: {
            from: { value1: 80, value2: -40 },
            to: { value1: 0, value2: 0 },
        },
        scale: {
            from: { value1: 0.8, value2: 0.9 },
            to: { value1: 1, value2: 1 },
        },
        opacity: { from: 0.2, to: 1 },
    },
}, 200);
assert.equal(sampled.progress, 0.875);
assert.deepEqual(sampled.translation, { value1: 10, value2: -5 });
assert.deepEqual(sampled.scale, { value1: 0.975, value2: 0.9875 });
assert.ok(Math.abs(sampled.opacity - 0.9) < Number.EPSILON * 2);

assert.deepEqual(retargetedTranslation(
    { value1: 10, value2: -5 },
    { x: 200, y: 40 },
    { x: 20, y: 10 }
), { value1: 190, value2: 25 });

assert.deepEqual(visualRectFor(
    { x: 10, y: 20, width: 100, height: 50 },
    {
        translation: { value1: 5, value2: -2 },
        scale: { value1: 0.8, value2: 0.6 },
        opacity: 0.5,
    },
    "right"
), { x: 35, y: 28, width: 80, height: 30, opacity: 0.5 });

const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"),
    "utf8"
);
assert.match(effectSource, /Generated from src\/effect\/MotionSampler\.js/);
assert.equal((effectSource.match(/function sampleMotionState\(/g) || []).length, 1);
assert.equal((effectSource.match(/function visualRectFor\(/g) || []).length, 1);

console.log("PASS MotionSampler owns pure Effect motion sampling");
