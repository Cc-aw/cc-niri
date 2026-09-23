"use strict";

/* cjs:start */
const { standardDecelProgress } = require("./MotionSampler");
/* cjs:end */

function wideNeighborStart(wideRect, neighborWidth, side, gap) {
    return side === "left"
        ? wideRect.x - gap - neighborWidth
        : wideRect.x + wideRect.width + gap;
}

function anchoredScaleTranslation(source, target, anchor) {
    const scaleX = source.width / target.width;
    const paintedX = anchor === "right"
        ? target.x + target.width - source.width
        : target.x;
    return {
        scaleX,
        translationX: source.x - paintedX,
    };
}

function widePairEdgeError(wide, neighbor, side, gap) {
    return side === "left"
        ? wide.x - (neighbor.x + neighbor.width) - gap
        : neighbor.x - (wide.x + wide.width) - gap;
}

function wideTimelineSample(armedAt, now, duration) {
    const total = Math.max(1, Number(duration) || 1);
    const elapsed = Math.max(0, Math.min(total, Number(now) - Number(armedAt)));
    const progress = standardDecelProgress(elapsed / total);
    return {
        progress,
        remainingDuration: Math.max(1, total - elapsed),
    };
}

function widePairMotionSnapshot(type, wideRect, pairRect, side, gap) {
    const neighborSide = side === "left" ? "right" : "left";
    const pairNeighbor = {
        x: neighborSide === "right"
            ? pairRect.x + pairRect.width + gap
            : pairRect.x - pairRect.width - gap,
        y: pairRect.y,
        width: pairRect.width,
        height: pairRect.height,
    };
    const virtualNeighbor = Object.assign({}, pairNeighbor, {
        x: wideNeighborStart(wideRect, pairNeighbor.width,
            neighborSide, gap),
    });
    const entering = type === "PAIR_TO_WIDE";
    return {
        type,
        side,
        target: {
            oldVisualRect: Object.assign({}, entering ? pairRect : wideRect),
            newVisualRect: Object.assign({}, entering ? wideRect : pairRect),
        },
        neighbor: {
            oldVisualRect: Object.assign({}, entering
                ? pairNeighbor : virtualNeighbor),
            newVisualRect: Object.assign({}, entering
                ? virtualNeighbor : pairNeighbor),
            oldOpacity: entering ? 1 : 0,
            newOpacity: entering ? 0 : 1,
        },
    };
}

/* cjs:start */
module.exports = {
    wideNeighborStart,
    anchoredScaleTranslation,
    widePairEdgeError,
    wideTimelineSample,
    widePairMotionSnapshot,
};
/* cjs:end */
