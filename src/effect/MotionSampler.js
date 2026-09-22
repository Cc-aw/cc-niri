"use strict";

/* cjs:start */
const { MotionCurves, MotionTokens } = require("./MotionTokens");
/* cjs:end */

function clampUnit(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function standardDecelProgress(progress) {
    const remaining = 1 - clampUnit(progress);
    return 1 - remaining * remaining * remaining;
}

function interpolateValue(from, to, progress) {
    return from + (to - from) * progress;
}

function channelDistance(channel) {
    if (!channel) return 0;
    if (typeof channel.from === "number" && typeof channel.to === "number") {
        return Math.abs(channel.to - channel.from);
    }
    if (!channel.from || !channel.to) return 0;
    const delta1 = channel.to.value1 - channel.from.value1;
    const delta2 = channel.to.value2 - channel.from.value2;
    return Math.sqrt(delta1 * delta1 + delta2 * delta2);
}

function distanceAwareDuration(baseDuration, remainingDistance, fullDistance) {
    const base = Math.max(1, Number(baseDuration) || 1);
    const full = Math.max(1, Number(fullDistance) || 1);
    const ratio = clampUnit((Number(remainingDistance) || 0) / full);
    const minimum = base * MotionTokens.retargetMinMs / MotionTokens.spatialMs;
    const midpoint = base * MotionTokens.retargetMidMs / MotionTokens.spatialMs;
    if (ratio <= 0.2) return Math.max(1, Math.round(minimum));
    if (ratio <= 0.5) {
        return Math.max(1, Math.round(
            minimum + (midpoint - minimum) * ((ratio - 0.2) / 0.3)
        ));
    }
    return Math.max(1, Math.round(
        midpoint + (base - midpoint) * ((ratio - 0.5) / 0.5)
    ));
}

function motionValuesEqual(a, b, tolerance = 0.0001) {
    if (typeof a === "number" || typeof b === "number") {
        return typeof a === "number" && typeof b === "number" &&
            Math.abs(a - b) < tolerance;
    }
    return Boolean(a && b &&
        Math.abs(a.value1 - b.value1) < tolerance &&
        Math.abs(a.value2 - b.value2) < tolerance);
}

function retargetedTranslation(current, oldGeometry, newGeometry) {
    return {
        value1: current.value1 + oldGeometry.x - newGeometry.x,
        value2: current.value2 + oldGeometry.y - newGeometry.y,
    };
}

function sampleMotionState(state, now) {
    if (!state) {
        return {
            active: false,
            progress: 1,
            translation: { value1: 0, value2: 0 },
            scale: { value1: 1, value2: 1 },
            opacity: 1,
        };
    }
    const linearProgress = clampUnit((now - state.startTime) /
        Math.max(1, state.duration));
    const progress = state.curve === MotionCurves.standardDecel ||
            state.curve === MotionCurves.expressiveSpatial
        ? standardDecelProgress(linearProgress)
        : linearProgress;
    const channelValue = (name, fallback) => {
        const channel = state.channels[name];
        if (!channel) return fallback;
        if (name === "opacity") {
            return interpolateValue(channel.from, channel.to, progress);
        }
        return {
            value1: interpolateValue(channel.from.value1, channel.to.value1, progress),
            value2: interpolateValue(channel.from.value2, channel.to.value2, progress),
        };
    };
    return {
        active: linearProgress < 1,
        progress,
        translation: channelValue("translation", { value1: 0, value2: 0 }),
        scale: channelValue("scale", { value1: 1, value2: 1 }),
        opacity: channelValue("opacity", 1),
    };
}

function visualRectFor(rect, sample, anchor) {
    const width = rect.width * sample.scale.value1;
    const height = rect.height * sample.scale.value2;
    let x = rect.x + (rect.width - width) / 2;
    let y = rect.y + (rect.height - height) / 2;
    if (anchor === "left") x = rect.x;
    if (anchor === "right") x = rect.x + rect.width - width;
    if (anchor === "top") y = rect.y;
    if (anchor === "bottom") y = rect.y + rect.height - height;
    return {
        x: x + sample.translation.value1,
        y: y + sample.translation.value2,
        width,
        height,
        opacity: sample.opacity,
    };
}

/* cjs:start */
module.exports = {
    clampUnit,
    standardDecelProgress,
    interpolateValue,
    channelDistance,
    distanceAwareDuration,
    motionValuesEqual,
    retargetedTranslation,
    sampleMotionState,
    visualRectFor,
};
/* cjs:end */
