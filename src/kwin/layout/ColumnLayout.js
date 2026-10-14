"use strict";

function computeColumnWidth(mode, safeWidth, requestedInnerGap) {
    const width = Number.isFinite(safeWidth) && safeWidth > 0
        ? Math.min(safeWidth, Number.MAX_SAFE_INTEGER) : 1;
    if (mode === "full") return Math.max(1, width);
    const gap = Number.isFinite(requestedInnerGap)
        ? Math.min(Math.max(0, requestedInnerGap), Math.max(0, width - 1)) : 0;
    return Math.max(1, Math.floor((width - gap) / 2));
}

// One coordinate origin for every column count; multi-column visibility scrolls
// this inset out of view. Native offsets and logical coordinates stay nonnegative.
function virtualLeadingInset(safeWidth, innerGap, enabled) {
    if (!enabled || !Number.isFinite(safeWidth) || safeWidth <= 0 ||
            safeWidth > Number.MAX_SAFE_INTEGER) return 0;
    return Math.max(0, Math.floor((safeWidth - computeColumnWidth("half", safeWidth, innerGap)) / 2));
}

function deriveColumnLayout(columns, safeWidth, innerGap, options = {}) {
    let logicalX = virtualLeadingInset(safeWidth, innerGap, options.alwaysCenterSingleColumn === true);
    const gap = Number.isFinite(innerGap) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, innerGap)) : 0;
    return columns.map(column => {
        const pixelWidth = computeColumnWidth(column.widthMode, safeWidth, innerGap);
        const derived = { logicalX, pixelWidth };
        logicalX += pixelWidth + gap;
        return derived;
    });
}

function computeStripWidth(columns) {
    if (!columns.length) return 0;
    const last = columns[columns.length - 1];
    return last.logicalX + last.pixelWidth;
}

function boundScrollOffset(offset, stripWidth, viewportWidth) {
    return Math.max(0, Math.min(offset, Math.max(0, stripWidth - viewportWidth)));
}

function scrollOffsetToRevealColumn(offset, column, stripWidth, viewportWidth) {
    const viewportRight = offset + viewportWidth;
    let nextOffset = offset;
    if (column.logicalX < offset) {
        nextOffset = column.logicalX;
    } else if (column.logicalX + column.pixelWidth > viewportRight) {
        nextOffset = column.logicalX + column.pixelWidth - viewportWidth;
    }
    return boundScrollOffset(nextOffset, stripWidth, viewportWidth);
}

/* cjs:start */
module.exports = {
    boundScrollOffset,
    computeColumnWidth,
    computeStripWidth,
    deriveColumnLayout,
    scrollOffsetToRevealColumn,
    virtualLeadingInset,
};
/* cjs:end */
