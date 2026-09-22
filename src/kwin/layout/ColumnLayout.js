"use strict";

function computeColumnWidth(mode, safeWidth, requestedInnerGap) {
    const gap = Math.min(requestedInnerGap, Math.max(0, safeWidth - 1));
    if (mode === "third") {
        return Math.max(1, Math.floor((safeWidth - 2 * gap) / 3));
    }
    if (mode === "twoThirds") {
        const third = Math.max(1, Math.floor((safeWidth - 2 * gap) / 3));
        return Math.max(1, safeWidth - gap - third);
    }
    return Math.max(1, Math.floor((safeWidth - gap) / 2));
}

function deriveColumnLayout(columns, safeWidth, innerGap) {
    let logicalX = 0;
    return columns.map(column => {
        const pixelWidth = computeColumnWidth(column.widthMode, safeWidth, innerGap);
        const derived = { logicalX, pixelWidth };
        logicalX += pixelWidth + innerGap;
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
};
/* cjs:end */
