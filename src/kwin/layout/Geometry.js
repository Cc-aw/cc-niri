"use strict";

function copyRect(rect) {
    return rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
}

function formatRect(rect) {
    return rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : "<none>";
}

function rectsEqual(a, b) {
    return Boolean(a && b && a.x === b.x && a.y === b.y &&
        a.width === b.width && a.height === b.height);
}

function rectsNearlyEqual(a, b, tolerance = 1) {
    return Boolean(a && b && Math.abs(a.x - b.x) < tolerance &&
        Math.abs(a.y - b.y) < tolerance &&
        Math.abs(a.width - b.width) < tolerance &&
        Math.abs(a.height - b.height) < tolerance);
}

function sizesNearlyEqual(a, b, tolerance = 1) {
    return Boolean(a && b && Math.abs(a.width - b.width) < tolerance &&
        Math.abs(a.height - b.height) < tolerance);
}

function rectanglesIntersect(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

function quickTileRect(mode, safeRect, requestedInnerGap, maximizeMode = "maximize") {
    if (mode === maximizeMode) return copyRect(safeRect);
    const gap = Math.min(
        Math.max(0, requestedInnerGap),
        Math.max(0, Math.min(safeRect.width, safeRect.height) - 2)
    );
    const leftWidth = Math.floor((safeRect.width - gap) / 2);
    const rightWidth = safeRect.width - gap - leftWidth;
    const topHeight = Math.floor((safeRect.height - gap) / 2);
    const bottomHeight = safeRect.height - gap - topHeight;
    const rightX = safeRect.x + leftWidth + gap;
    const bottomY = safeRect.y + topHeight + gap;
    const rects = {
        left: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: safeRect.height },
        right: { x: rightX, y: safeRect.y, width: rightWidth, height: safeRect.height },
        top: { x: safeRect.x, y: safeRect.y, width: safeRect.width, height: topHeight },
        bottom: { x: safeRect.x, y: bottomY, width: safeRect.width, height: bottomHeight },
        topLeft: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: topHeight },
        topRight: { x: rightX, y: safeRect.y, width: rightWidth, height: topHeight },
        bottomLeft: { x: safeRect.x, y: bottomY, width: leftWidth, height: bottomHeight },
        bottomRight: { x: rightX, y: bottomY, width: rightWidth, height: bottomHeight },
    };
    return rects[mode] ? copyRect(rects[mode]) : null;
}

/* cjs:start */
module.exports = {
    copyRect,
    formatRect,
    quickTileRect,
    rectanglesIntersect,
    rectsEqual,
    rectsNearlyEqual,
    sizesNearlyEqual,
};
/* cjs:end */
