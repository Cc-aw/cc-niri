"use strict";

/* cjs:start */
const { copyRect } = require("./Geometry");
const { computeParkingRect } = require("./Parking");
const { isRectFullyVisible, projectColumnRect } = require("./Projection");
const { buildWidePairSnapshots } = require("./LayoutSnapshot");
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

function adjacentPairWindow(windows, target, gap) {
    return windows.find(item => item !== target &&
        item.placement === "visible" &&
        (Math.abs(item.rect.x - target.newProjectedRect.x -
            target.newProjectedRect.width - gap) < 3 ||
         Math.abs(item.rect.x + item.rect.width + gap -
            target.newProjectedRect.x) < 3)) || null;
}

function viewportMotionSnapshot(type, target, neighbor, wideRect, gap) {
    if (!target || !neighbor || !wideRect) return null;
    const pairTarget = target.newProjectedRect;
    const pairNeighbor = neighbor.newProjectedRect;
    const neighborSide = pairNeighbor.x < pairTarget.x ? "left" : "right";
    const side = neighborSide === "left" ? "right" : "left";
    const virtualNeighbor = copyRect(pairNeighbor);
    virtualNeighbor.x = neighborSide === "left"
        ? wideRect.x - gap - pairNeighbor.width
        : wideRect.x + wideRect.width + gap;
    return {
        type,
        targetColumnId: target.columnId,
        neighborColumnId: neighbor.columnId,
        side,
        target: {
            oldVisualRect: copyRect(type === "PAIR_TO_WIDE"
                ? pairTarget : wideRect),
            newVisualRect: copyRect(type === "PAIR_TO_WIDE"
                ? wideRect : pairTarget),
        },
        neighbor: {
            oldVisualRect: copyRect(type === "PAIR_TO_WIDE"
                ? pairNeighbor : virtualNeighbor),
            newVisualRect: copyRect(type === "PAIR_TO_WIDE"
                ? virtualNeighbor : pairNeighbor),
        },
    };
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
        retainedColumn,
        wideExitColumn,
        wideRect,
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
            ? (isPresented || (retainedColumn === column &&
                projectedPlacement === "visible") ? "visible" : "parked")
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

    const motionTargetColumn = wideExitColumn ||
        (retainedColumn ? presentedColumn : null);
    const motionTarget = windows.find(item =>
        item.column === motionTargetColumn) || null;
    const motionNeighbor = motionTarget
        ? adjacentPairWindow(windows, motionTarget, innerGap) : null;
    const viewportMotion = motionTarget && motionNeighbor
        ? viewportMotionSnapshot(wideExitColumn ? "WIDE_TO_PAIR" :
            "PAIR_TO_WIDE", motionTarget, motionNeighbor,
            wideExitColumn
                ? (wideExitColumn.window.frameGeometry || wideRect)
                : presentedRect, innerGap)
        : null;
    const neighborIndex = motionNeighbor ? windows.indexOf(motionNeighbor) : -1;
    const targetIndex = motionTarget ? windows.indexOf(motionTarget) : -1;
    const neighborParkingIndex = neighborIndex -
        Number(targetIndex >= 0 && targetIndex < neighborIndex);
    const layoutSnapshots = viewportMotion ? buildWidePairSnapshots(
        viewportMotion, motionTarget, motionNeighbor, {
            windowId: motionWindowId,
            neighborParkingRect: computeParkingRect(motionNeighbor.column,
                neighborParkingIndex, {
                    baseX: parkingBaseX,
                    innerGap,
                    safeRect,
                }),
        }) : null;
    if (viewportMotion) {
        viewportMotion.id = epoch;
        viewportMotion.epoch = epoch;
        viewportMotion.oldViewportMode = layoutSnapshots.from.viewportMode;
        viewportMotion.newViewportMode = layoutSnapshots.to.viewportMode;
        viewportMotion.entries = layoutSnapshots.from.entries.map((entry, index) => ({
            windowId: entry.windowId,
            columnId: entry.columnId,
            role: entry.role,
            oldVisualRect: copyRect(entry.visualRect),
            newVisualRect: copyRect(layoutSnapshots.to.entries[index].visualRect),
            oldOpacity: entry.placement === "isolated-hidden" ? 0 : 1,
            newOpacity: layoutSnapshots.to.entries[index].placement ===
                "isolated-hidden" ? 0 : 1,
        }));
        viewportMotion.parkAfterComplete = viewportMotion.type === "PAIR_TO_WIDE"
            ? [motionWindowId(motionNeighbor)] : [];
    }

    return {
        reason,
        epoch,
        scrollTransaction,
        viewportMotion,
        layoutSnapshots,
        wideExitColumn: wideExitColumn || null,
        windows,
        commitOrder: wideExitColumn
            ? windows.slice().sort((a, b) =>
                Number(b.column === wideExitColumn) -
                Number(a.column === wideExitColumn))
            : hasScrollTransaction
            ? windows.slice().sort((a, b) =>
                transitionRank(a.transitionRole) - transitionRank(b.transitionRole))
            : windows,
    };
}

/* cjs:start */
module.exports = { computeLayoutPlan, transitionRole };
/* cjs:end */
