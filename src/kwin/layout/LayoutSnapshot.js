"use strict";

/* cjs:start */
const { copyRect } = require("./Geometry");
/* cjs:end */

function snapshotEntry(columnId, windowId, role, visualRect, realRect, placement) {
    return {
        columnId,
        windowId,
        role,
        visualRect: copyRect(visualRect),
        realRect: copyRect(realRect),
        placement,
    };
}

function buildWidePairSnapshots(motion, target, neighbor, options) {
    if (!motion || !target || !neighbor) return null;
    const entering = motion.type === "PAIR_TO_WIDE";
    const targetId = options.windowId(target);
    const neighborId = options.windowId(neighbor);
    const oldNeighborReal = entering
        ? motion.neighbor.oldVisualRect
        : (neighbor.column.window.frameGeometry || options.neighborParkingRect);
    const newNeighborReal = entering
        ? options.neighborParkingRect
        : motion.neighbor.newVisualRect;
    const from = {
        viewportMode: entering ? "pair" : "wide-focus",
        entries: [
            snapshotEntry(target.columnId, targetId, "target",
                motion.target.oldVisualRect, motion.target.oldVisualRect, "visible"),
            snapshotEntry(neighbor.columnId, neighborId, "neighbor",
                motion.neighbor.oldVisualRect, oldNeighborReal,
                entering ? "visible" : "isolated-hidden"),
        ],
    };
    const to = {
        viewportMode: entering ? "wide-focus" : "pair",
        entries: [
            snapshotEntry(target.columnId, targetId, "target",
                motion.target.newVisualRect, motion.target.newVisualRect, "visible"),
            snapshotEntry(neighbor.columnId, neighborId, "neighbor",
                motion.neighbor.newVisualRect, newNeighborReal,
                entering ? "isolated-hidden" : "visible"),
        ],
    };
    return { from, to };
}

/* cjs:start */
module.exports = { buildWidePairSnapshots };
/* cjs:end */
