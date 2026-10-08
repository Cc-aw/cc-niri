"use strict";

function projectColumnRect(column, safeRect, scrollOffsetX) {
    return {
        x: safeRect.x + column.logicalX - scrollOffsetX,
        y: safeRect.y,
        width: column.pixelWidth,
        height: safeRect.height,
    };
}

function isRectFullyVisible(rect, viewport) {
    return Boolean(viewport && rect.x >= viewport.x && rect.y >= viewport.y &&
        rect.x + rect.width <= viewport.x + viewport.width &&
        rect.y + rect.height <= viewport.y + viewport.height);
}

function isRectVisible(rect, viewport) {
    return Boolean(viewport && rect.width > 0 && rect.height > 0 &&
        rect.x < viewport.x + viewport.width && rect.x + rect.width > viewport.x &&
        rect.y < viewport.y + viewport.height && rect.y + rect.height > viewport.y);
}

/* cjs:start */
module.exports = { isRectFullyVisible, isRectVisible, projectColumnRect };
/* cjs:end */
