"use strict";

/* cjs:start */
const { CC_NIRI_MOTION_PLAN_ROLE, MotionType, MotionCurves } = require("./MotionTokens");
const { rectNear, viewportFromSlot } = require("./MotionClassifier");
/* cjs:end */

// A retained Wide neighbor may return without any real geometry change.
// Its visibility must follow the current plan, not an old fade's completion.
class WideNeighborLifecycle {
    constructor(owner) { this.owner = owner; }

    marker(window) {
        try {
            return typeof window.data === "function" ? window.data(CC_NIRI_MOTION_PLAN_ROLE) : null;
        } catch (_error) { return null; }
    }

    ownsOutgoing(window, state) {
        const marker = this.marker(window);
        // Preserve geometry-only fallback when no native plan was provided.
        return !marker || (marker.type === MotionType.PAIR_TO_WIDE && marker.role === "neighbor" &&
            Number(marker.epoch) === state.transactionEpoch);
    }

    onPlanChanged(window) {
        const owner = this.owner;
        if (!window || window.onCurrentDesktop === false || !owner.isTargetOutput(window)) return false;
        const marker = this.marker(window);
        if (!marker || marker.type !== MotionType.WIDE_TO_PAIR || marker.role !== "neighbor" ||
                !Number.isSafeInteger(Number(marker.epoch)) || Number(marker.epoch) < 0 ||
                !Number.isFinite(Number(marker.issuedAt)) || Math.abs(Date.now() - Number(marker.issuedAt)) > 5000 ||
                !marker.entries || marker.entries.length !== 2) return false;
        const entries = [marker.entries[0], marker.entries[1]];
        const target = entries.find(entry => entry && entry.role === "target");
        const validRect = rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
            rect.width > 0 && rect.height > 0;
        if (!["left", "right"].includes(marker.side) || !target || !validRect(target.newVisualRect) ||
                !validRect(marker.oldVisualRect) || !validRect(marker.newVisualRect)) return false;
        const previous = owner.motion.states.get(window);
        const outgoing = previous && previous.type === MotionType.PAIR_TO_WIDE && previous.role === "outgoing";
        const held = owner.wideIsolationHolds.has(window);
        if (!outgoing && !held) return false;

        owner.releaseWideIsolation(window, "wide-exit-plan");
        if (!rectNear(window.geometry, marker.newVisualRect)) {
            // A parked neighbor will enter through the normal geometry path.
            // Retire its old fade now, before a late completion can hide it.
            owner.motion.cancel(window);
            owner.parkingGrabber.release(window, "wide-exit-plan");
            return true;
        }
        const viewport = viewportFromSlot(target.newVisualRect, marker.side, owner.innerGap);
        const rect = window.geometry;
        owner.motion.start(window, {
            type: MotionType.WIDE_TO_PAIR, role: "incoming", transactionEpoch: Number(marker.epoch),
            viewport, duration: owner.presentationDuration, synchronizeDuration: true,
            startTime: Date.now(), curve: MotionCurves.expressiveSpatial,
            oldGeometry: rect, newGeometry: rect,
            channels: [{type: Effect.Translation,
                from: {value1: marker.oldVisualRect.x - rect.x, value2: 0},
                to: {value1: 0, value2: 0}},
                {type: Effect.Opacity, from: held ? 0 : 1, to: 1}],
            fragmentShader: owner.viewportClip.shaderFor(viewport),
        });
        owner.debug(`[WIDE_NEIGHBOR] restore unchanged slot epoch=${marker.epoch}`);
        return true;
    }
}

/* cjs:start */
module.exports = { WideNeighborLifecycle };
/* cjs:end */
