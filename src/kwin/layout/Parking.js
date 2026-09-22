"use strict";

function computeParkingBaseX(columns, virtualLeft, parkingMargin) {
    const maximumColumnWidth = columns.reduce(
        (maximum, column) => Math.max(maximum, column.pixelWidth),
        0
    );
    return virtualLeft - parkingMargin - maximumColumnWidth;
}

function computeParkingRect(column, parkingIndex, options) {
    return {
        x: options.baseX - parkingIndex * (column.pixelWidth + options.innerGap),
        y: options.safeRect.y,
        width: column.pixelWidth,
        height: options.safeRect.height,
    };
}

/* cjs:start */
module.exports = { computeParkingBaseX, computeParkingRect };
/* cjs:end */
