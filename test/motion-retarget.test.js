const assert = require("node:assert/strict");

const {
    MotionTokens,
    MotionCurves,
    standardDecelProgress,
    retargetedTranslation,
    sampleMotionState,
    visualRectFor,
} = require("../effect/contents/code/main.js");

assert.equal(MotionTokens.spatialMs, 220,
    "Column scroll uses the shared spatial duration token");
assert.equal(MotionCurves.standardDecel, "standardDecel");
assert.equal(standardDecelProgress(0), 0);
assert.equal(standardDecelProgress(0.5), 0.875);
assert.equal(standardDecelProgress(1), 1);

const state = {
    startTime: 1000,
    duration: 220,
    curve: MotionCurves.standardDecel,
    channels: {
        translation: {
            from: { value1: 1260, value2: 0 },
            to: { value1: 0, value2: 0 },
        },
    },
};
const halfway = sampleMotionState(state, 1110);
assert.equal(halfway.progress, 0.875);
assert.equal(halfway.translation.value1, 157.5);

const oldGeometry = { x: 1284, y: 50, width: 1252, height: 1320 };
const newGeometry = { x: 24, y: 50, width: 1252, height: 1320 };
const retargeted = retargetedTranslation(
    halfway.translation,
    oldGeometry,
    newGeometry
);
assert.equal(retargeted.value1, 1417.5);
assert.equal(
    oldGeometry.x + halfway.translation.value1,
    newGeometry.x + retargeted.value1,
    "retarget preserves the current absolute painted X across a geometry commit"
);

const reversedGeometry = { x: 1284, y: 50, width: 1252, height: 1320 };
const reversed = retargetedTranslation(retargeted, newGeometry, reversedGeometry);
assert.equal(
    newGeometry.x + retargeted.value1,
    reversedGeometry.x + reversed.value1,
    "L to H reversal also preserves the current absolute painted X"
);

const safeEdge = visualRectFor(newGeometry, {
    translation: { value1: 20, value2: 0 },
    scale: { value1: 0.94, value2: 1 },
    opacity: 0.2,
}, "right");
assert.ok(Math.abs(safeEdge.x - 119.12) < 0.001);
assert.ok(Math.abs(safeEdge.width - 1176.88) < 0.001);
assert.equal(safeEdge.opacity, 0.2);

console.log("PASS retargetable Motion preserves the current visual state");
