"use strict";

/* cjs:start */
const { MotionCurves, MotionTokens, MotionType } = require("./MotionTokens");
/* cjs:end */

/* A profile describes visual intent. Geometry and animation ownership stay with
 * the existing layout and MotionController modules. */
const MotionProfiles = Object.freeze({
    [MotionType.NONE]: Object.freeze({
        durationToken: "spatialMs", curve: MotionCurves.standardDecel,
        translation: false, scale: false, opacity: false, retarget: false,
    }),
    [MotionType.SCROLL]: Object.freeze({
        durationToken: "spatialMs", curve: MotionCurves.standardDecel,
        translation: true, scale: false, opacity: false, retarget: true,
    }),
    [MotionType.DOCK_SCROLL]: Object.freeze({
        durationToken: "spatialMs", curve: MotionCurves.standardDecel,
        translation: true, scale: false, opacity: false, retarget: true,
    }),
    [MotionType.REORDER]: Object.freeze({
        durationToken: "spatialMs", curve: MotionCurves.standardDecel,
        translation: true, scale: false, opacity: false, retarget: true,
    }),
    [MotionType.CLOSE_REFILL]: Object.freeze({
        durationToken: "spatialFastMs", curve: MotionCurves.standardDecel,
        translation: true, scale: true, opacity: true, retarget: true,
        incomingScaleToken: "subtleIncomingScale",
        incomingOpacityToken: "subtleIncomingOpacity",
    }),
    [MotionType.WIDE_ENTER]: Object.freeze({
        durationToken: "expressiveEnterMs", curve: MotionCurves.expressiveSpatial,
        translation: true, scale: true, opacity: false, retarget: true,
    }),
    [MotionType.PAIR_TO_WIDE]: Object.freeze({
        durationToken: "expressiveEnterMs", curve: MotionCurves.expressiveSpatial,
        translation: true, scale: true, opacity: false, retarget: true,
    }),
    [MotionType.WIDE_EXIT]: Object.freeze({
        durationToken: "expressiveExitMs", curve: MotionCurves.standardDecel,
        translation: true, scale: true, opacity: false, retarget: true,
    }),
    [MotionType.WIDE_TO_PAIR]: Object.freeze({
        durationToken: "expressiveExitMs", curve: MotionCurves.standardDecel,
        translation: true, scale: true, opacity: false, retarget: true,
    }),
});

function motionProfile(type) {
    return MotionProfiles[type] || MotionProfiles[MotionType.NONE];
}

function motionProfileDuration(type) {
    return MotionTokens[motionProfile(type).durationToken];
}

/* cjs:start */
module.exports = { MotionProfiles, motionProfile, motionProfileDuration };
/* cjs:end */
