"use strict";
// Production motion sampling only; the Ring plugin does not import this fixture.
const { sampleMotionState, visualRectFor } = require("../../../src/effect/MotionSampler");
const { anchoredScaleTranslation } = require("../../../src/effect/WideMotionGeometry");
const { MotionTokens, MotionCurves } = require("../../../src/effect/MotionTokens");
const normal = { x: 24, y: 50, width: 932, height: 960 };
const wide = { x: 286, y: 50, width: 1348, height: 960 };
const max = { x: 24, y: 50, width: 1872, height: 960 };
const frames = [];
function sample(name, source, target, anchor, times) {
    const start = anchoredScaleTranslation(source, target, anchor);
    const state = {
        startTime: 0, duration: MotionTokens.spatialMs, curve: MotionCurves.expressiveSpatial,
        channels: {
            scale: { from: { value1: start.scaleX, value2: source.height / target.height }, to: { value1: 1, value2: 1 } },
            translation: { from: { value1: start.translationX, value2: source.y - target.y }, to: { value1: 0, value2: 0 } },
        },
    };
    let last;
    for (const time of times) {
        const sampled = sampleMotionState(state, time);
        // Wide is horizontal. Generic 2D samples use top-left native anchors.
        const visual = visualRectFor(target, sampled, anchor);
        if (source.height !== target.height) visual.y = target.y + sampled.translation.value2;
        frames.push({ name, time, target, sx: sampled.scale.value1, sy: sampled.scale.value2,
            tx: visual.x - target.x, ty: visual.y - target.y });
        last = visual;
    }
    return last;
}
const times = [0, 7, 20, 60, 100, 160, 219, 220];
for (const anchor of ["left", "right"]) {
    const pair = Object.assign({}, normal, { x: anchor === "right" ? 964 : 24 });
    sample(`normal-wide-${anchor}`, pair, wide, anchor, times);
    sample(`wide-normal-${anchor}`, wide, pair, anchor, times);
    const current = sample(`interrupted-enter-${anchor}`, pair, wide, anchor, [0, 7, 60]);
    sample(`reverse-${anchor}`, current, pair, anchor, times);
}
// Current maximize commits geometry immediately; these are its real endpoints.
for (const target of [normal, max, normal]) frames.push({ name: "max-endpoints", time: 0, target, sx: 1, sy: 1, tx: 0, ty: 0 });
// Generic paint transforms: no claim that current maximize animates this way.
sample("generic-2d", { x: 70, y: 80, width: 700, height: 600 }, max, "left", times);
process.stdout.write(JSON.stringify(frames));
