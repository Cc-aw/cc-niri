"use strict";

/* cjs:start */
const { copyRect } = require("./Geometry");
const { computeParkingRect } = require("./Parking");
const { isRectFullyVisible, projectColumnRect } = require("./Projection");
/* cjs:end */

function transitionRole(oldPlacement, newPlacement) {
    if (oldPlacement === "visible" && newPlacement === "visible") {
        return "continuing";
    }
    if (oldPlacement === "parked" && newPlacement === "visible") {
        return "incoming";
    }
    if (oldPlacement === "visible" && newPlacement === "parked") {
        return "outgoing";
    }
    return "static";
}

function transitionRank(role) {
    return ({ continuing: 0, incoming: 1, outgoing: 2, static: 3 })[role];
}

function motionWindowId(item) {
    const internalId = item.column.window.internalId;
    return String(internalId === undefined || internalId === null
        ? item.column.window.id || item.columnId
        : internalId);
}

function computeLayoutPlan(options) {
    const {
        reason,
        epoch,
        columns,
        safeRect,
        innerGap,
        parkingBaseX,
        scrollOffsetX,
        scrollOffsets,
        presentedColumn,
        presentedRect,
    } = options;
    const hasScrollTransaction = Boolean(!presentedColumn && scrollOffsets &&
        scrollOffsets.oldScrollOffsetX !== scrollOffsets.newScrollOffsetX);
    const oldScrollOffsetX = hasScrollTransaction
        ? scrollOffsets.oldScrollOffsetX
        : scrollOffsetX;
    const newScrollOffsetX = hasScrollTransaction
        ? scrollOffsets.newScrollOffsetX
        : scrollOffsetX;
    let parkingIndex = 0;

    const windows = columns.map(column => {
        const oldProjectedRect = projectColumnRect(column, safeRect, oldScrollOffsetX);
        const newProjectedRect = projectColumnRect(column, safeRect, newScrollOffsetX);
        const oldPlacement = isRectFullyVisible(oldProjectedRect, safeRect)
            ? "visible"
            : "parked";
        const projectedPlacement = isRectFullyVisible(newProjectedRect, safeRect)
            ? "visible"
            : "parked";
        const isPresented = presentedColumn === column;
        const newPlacement = presentedColumn
            ? (isPresented ? "visible" : "parked")
            : projectedPlacement;
        const visibleRect = isPresented ? copyRect(presentedRect) : newProjectedRect;
        const rect = newPlacement === "visible"
            ? visibleRect
            : computeParkingRect(column, parkingIndex++, {
                baseX: parkingBaseX,
                innerGap,
                safeRect,
            });
        const role = hasScrollTransaction
            ? transitionRole(oldPlacement, newPlacement)
            : "static";
        return {
            column,
            columnId: column.id,
            placement: newPlacement,
            rect,
            projectedRect: newPlacement === "visible" ? visibleRect : newProjectedRect,
            oldProjectedRect: hasScrollTransaction ? oldProjectedRect : null,
            newProjectedRect,
            oldPlacement: hasScrollTransaction ? oldPlacement : null,
            newPlacement: hasScrollTransaction ? newPlacement : null,
            transitionRole: role,
        };
    });

    const deltaX = newScrollOffsetX - oldScrollOffsetX;
    const scrollTransaction = hasScrollTransaction ? {
        id: epoch,
        epoch,
        type: "SCROLL",
        direction: deltaX > 0 ? "left" : "right",
        deltaX,
        oldScrollOffsetX,
        newScrollOffsetX,
        viewport: copyRect(safeRect),
        continuing: windows.filter(item => item.transitionRole === "continuing")
            .map(motionWindowId),
        incoming: windows.filter(item => item.transitionRole === "incoming")
            .map(motionWindowId),
        outgoing: windows.filter(item => item.transitionRole === "outgoing")
            .map(motionWindowId),
    } : null;

    return {
        reason,
        epoch,
        scrollTransaction,
        windows,
        commitOrder: hasScrollTransaction
            ? windows.slice().sort((a, b) =>
                transitionRank(a.transitionRole) - transitionRank(b.transitionRole))
            : windows,
    };
}

/* cjs:start */
module.exports = { computeLayoutPlan, transitionRole };
/* cjs:end */
