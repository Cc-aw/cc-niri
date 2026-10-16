"use strict";

/* cjs:start */
const { CC_NIRI_SCROLL_OWNERSHIP_ROLE, CC_NIRI_SCROLL_MOTION_CAPABILITY_ROLE, CC_NIRI_MOTION_PLAN_ROLE } = require("./MotionTokens");
const { sameSize, rectNear, parked, visibleSlot } = require("./MotionClassifier");
/* cjs:end */

// A loaded clip effect or a capability alone cannot suppress fallback. Native
// ACK installs a typed, scoped marker before the corresponding geometry batch.
function readNativeScrollMarker(window) {
    if (!window || window.onCurrentDesktop === false || typeof window.data !== "function" ||
            window.data(CC_NIRI_SCROLL_MOTION_CAPABILITY_ROLE) !== true) return null;
    const marker = window.data(CC_NIRI_SCROLL_OWNERSHIP_ROLE);
    const partial = marker && ((marker.protocol === 3 && marker.type === "PARTIAL_SCROLL") ||
        (marker.protocol === 4 && marker.type === "COLUMN_GEOMETRY")) &&
        Number.isSafeInteger(marker.scopeRevision) && marker.scopeRevision > 0;
    if (!marker || (!(marker.protocol === 2 && marker.type === "SCROLL") && !partial) ||
            !Number.isSafeInteger(marker.epoch) || marker.epoch < 0 ||
            typeof marker.sessionId !== "string" || !marker.sessionId ||
            typeof marker.workspaceId !== "string" || !marker.workspaceId ||
            !window.screen || marker.targetOutput !== window.screen.name ||
            !["continuing", "incoming", "outgoing"].includes(marker.role) ||
            ![marker.x, marker.y, marker.width, marker.height].every(Number.isFinite) ||
            marker.width <= 0 || marker.height <= 0) return null;
    // A width transition can arm Native clipping at the same epoch without
    // handing its established Pair/Wide paint timeline to the Scroll Spring.
    const width = window.data(CC_NIRI_MOTION_PLAN_ROLE);
    if (width && width.protocol === 1 && width.epoch === marker.epoch &&
            width.sessionId === marker.sessionId &&
            ["PAIR_TO_WIDE", "WIDE_TO_PAIR"].includes(width.type) &&
            ["target", "neighbor"].includes(width.role) &&
            width.entries && (width.entries.length === 1 || width.entries.length === 2) &&
            Number.isFinite(Number(width.issuedAt)) &&
            Math.abs(Date.now() - Number(width.issuedAt)) <= 5000) return null;
    return marker;
}

function nativeScrollGeometryRole(window, oldGeometry, newGeometry, screenRect) {
    const marker = readNativeScrollMarker(window);
    if (!marker) return null;
    // A typed geometry Arm owns configure/paint until explicit release. Unknown
    // or late configure frames are suppressed by Rust, never animated again by
    // the legacy JS effect (including a second width/scale timeline).
    if (marker.protocol === 4) return marker.role === "outgoing" && parked(newGeometry, screenRect)
        ? "outgoing-finalize" : marker.role === "incoming" ? "incoming" : "continuing";
    if (!sameSize(oldGeometry, newGeometry)) return null;
    if (marker.role === "outgoing") {
        return rectNear(marker, oldGeometry, 0.5) && visibleSlot(oldGeometry, screenRect) &&
            parked(newGeometry, screenRect) ? "outgoing-finalize" : null;
    }
    if (!rectNear(marker, newGeometry, 0.5) || !visibleSlot(newGeometry, screenRect)) return null;
    if (marker.role === "incoming") return parked(oldGeometry, screenRect) || visibleSlot(oldGeometry, screenRect) ? "incoming" : null;
    return visibleSlot(oldGeometry, screenRect) ? "continuing" : null;
}

/* cjs:start */
module.exports = { readNativeScrollMarker, nativeScrollGeometryRole };
/* cjs:end */
