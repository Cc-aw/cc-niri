"use strict";

/* cjs:start */
const { CC_NIRI_SCROLL_OWNERSHIP_ROLE, CC_NIRI_SCROLL_MOTION_CAPABILITY_ROLE } = require("./MotionTokens");
const { sameSize, rectNear, parked, visibleSlot } = require("./MotionClassifier");
/* cjs:end */

// A loaded clip effect or a capability alone cannot suppress fallback. Native
// ACK installs a typed, scoped marker before the corresponding geometry batch.
function readNativeScrollMarker(window) {
    if (!window || window.onCurrentDesktop === false || typeof window.data !== "function" ||
            window.data(CC_NIRI_SCROLL_MOTION_CAPABILITY_ROLE) !== true) return null;
    const marker = window.data(CC_NIRI_SCROLL_OWNERSHIP_ROLE);
    if (!marker || marker.protocol !== 2 || marker.type !== "SCROLL" ||
            !Number.isSafeInteger(marker.epoch) || marker.epoch < 0 ||
            typeof marker.sessionId !== "string" || !marker.sessionId ||
            typeof marker.workspaceId !== "string" || !marker.workspaceId ||
            !window.screen || marker.targetOutput !== window.screen.name ||
            !["continuing", "incoming", "outgoing"].includes(marker.role) ||
            ![marker.x, marker.y, marker.width, marker.height].every(Number.isFinite) ||
            marker.width <= 0 || marker.height <= 0) return null;
    return marker;
}

function nativeScrollGeometryRole(window, oldGeometry, newGeometry, screenRect) {
    const marker = readNativeScrollMarker(window);
    if (!marker || !sameSize(oldGeometry, newGeometry)) return null;
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
