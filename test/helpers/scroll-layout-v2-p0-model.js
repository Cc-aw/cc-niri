"use strict";

// P0 thought experiment only. Not a layout, input filter or production authority.
const { isRectVisible } = require("../../src/kwin/layout/Projection.js");

function validRect(rect) {
    return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.width > 0 && rect.height > 0;
}

function intersection(a, b) {
    if (!validRect(a) || !validRect(b) || !isRectVisible(a, b)) return null;
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    return { x, y, width: Math.min(a.x + a.width, b.x + b.width) - x,
        height: Math.min(a.y + a.height, b.y + b.height) - y };
}

function contains(rect, point) {
    return Boolean(validRect(rect) && Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= rect.x && point.x < rect.x + rect.width &&
        point.y >= rect.y && point.y < rect.y + rect.height);
}

function anchoredProjection(visual, output) {
    if (!validRect(visual) || !validRect(output) ||
            visual.width > output.width || visual.height > output.height) return null;
    const clip = intersection(visual, output);
    if (!clip) return null;
    const real = { ...visual,
        x: Math.min(Math.max(visual.x, output.x), output.x + output.width - visual.width),
        y: Math.min(Math.max(visual.y, output.y), output.y + output.height - visual.height) };
    return { visual, real, clip, deltaX: visual.x - real.x, deltaY: visual.y - real.y };
}

function hit(stack, point, field) {
    return stack.find(entry => contains(entry[field], point)) || null;
}

function localPoint(rect, point) {
    // Frameless, no subsurfaces: decoration/client offsets need real KWin tests.
    return { x: point.x - rect.x, y: point.y - rect.y };
}

function deviceRect(rect, scale) {
    const left = Math.round(rect.x * scale), top = Math.round(rect.y * scale);
    const right = Math.round((rect.x + rect.width) * scale);
    const bottom = Math.round((rect.y + rect.height) * scale);
    return { x: left, y: top, width: right - left, height: bottom - top };
}

// Requirements oracle for a proposed two-click fallback, not evidence that
// KWin can implement it. Suppression must survive focus/epoch changes until up.
class TwoClickOracle {
    constructor() { this.suppressed = new Set(); }
    event({ type, button, partial, ready, grabbed = false }) {
        if (type === "release" && this.suppressed.delete(button)) return "consume";
        if (type === "press" && this.suppressed.size) {
            this.suppressed.add(button);
            return "consume";
        }
        if ((type === "axis" || type === "motion") && this.suppressed.size) return "consume";
        if (grabbed) return "native";
        if (type === "press" && (partial || !ready)) {
            this.suppressed.add(button);
            return partial ? "focus-only" : "consume";
        }
        if ((type === "axis" || type === "motion") && (partial || !ready)) return "consume";
        return "native";
    }
    get pendingButtons() { return this.suppressed.size; }
}

module.exports = { anchoredProjection, contains, deviceRect, hit, intersection,
    localPoint, TwoClickOracle };
