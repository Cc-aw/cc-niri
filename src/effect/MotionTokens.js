"use strict";

const SAFE_RIGHT_EDGE_SLIDE_X = 20;
const UNARMED_TRANSACTION_TTL_MS = 80;
const PRESENTATION_MIN_WIDTH_RATIO = 0.65;
const PRESENTATION_MAX_WIDTH_RATIO = 0.85;

const MotionTokens = Object.freeze({
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

const MotionCurves = Object.freeze({
    standardDecel: "standardDecel",
    expressiveSpatial: "expressiveSpatial",
});

const MotionType = Object.freeze({
    NONE: "NONE",
    SCROLL: "SCROLL",
    DOCK_SCROLL: "DOCK_SCROLL",
    CLOSE_REFILL: "CLOSE_REFILL",
    REORDER: "REORDER",
    WIDE_ENTER: "WIDE_ENTER",
    WIDE_EXIT: "WIDE_EXIT",
});

/* cjs:start */
module.exports = {
    SAFE_RIGHT_EDGE_SLIDE_X,
    UNARMED_TRANSACTION_TTL_MS,
    PRESENTATION_MIN_WIDTH_RATIO,
    PRESENTATION_MAX_WIDTH_RATIO,
    MotionTokens,
    MotionCurves,
    MotionType,
};
/* cjs:end */
