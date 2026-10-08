"use strict";

/* cjs:start */
const { copyRect } = require("./Geometry");
const { computeParkingRect } = require("./Parking");
const { isRectFullyVisible, isRectVisible, projectColumnRect } = require("./Projection");
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

function captureColumnWidthTransition(column, columns, safeRect, gap) {
    const oldRect = copyRect(column.window.frameGeometry);
    const neighbor = columns.find(candidate => {
        if (candidate === column || candidate.window.minimized) return false;
        const rect = candidate.window.frameGeometry;
        return isRectVisible(rect, safeRect) &&
            Math.abs(rect.y - oldRect.y) < 2 &&
            Math.abs(rect.height - oldRect.height) < 2 &&
            (Math.abs(rect.x - oldRect.x - oldRect.width - gap) < 3 ||
             Math.abs(rect.x + rect.width + gap - oldRect.x) < 3);
    }) || null;
    return { column, oldRect, neighbor,
        neighborRect: neighbor ? copyRect(neighbor.window.frameGeometry) : null };
}

function columnWidthMotionSnapshot(transition, windows, safeRect, gap) {
    if (!transition || !isRectFullyVisible(transition.oldRect, safeRect)) return null;
    const target = windows.find(item => item.column === transition.column);
    if (!target || target.placement !== "visible") return null;
    const entering = target.column.widthMode === "full";
    const neighbor = entering
        ? windows.find(item => item.column === transition.neighbor) || null
        : adjacentPairWindow(windows, target, gap);
    const pairRect = entering ? transition.oldRect : target.rect;
    const wideRect = entering ? target.rect : transition.oldRect;
    const pairNeighbor = neighbor && (entering
        ? transition.neighborRect : neighbor.newProjectedRect);
    const side = pairNeighbor
        ? (pairNeighbor.x < pairRect.x ? "right" : "left")
        : (pairRect.x + pairRect.width / 2 < safeRect.x + safeRect.width / 2
            ? "left" : "right");
    const virtualNeighbor = pairNeighbor && Object.assign({}, pairNeighbor, {
        x: side === "right" ? wideRect.x - gap - pairNeighbor.width
            : wideRect.x + wideRect.width + gap,
    });
    return {
        target, neighbor,
        motion: {
            type: entering ? "PAIR_TO_WIDE" : "WIDE_TO_PAIR",
            targetColumnId: target.columnId,
            neighborColumnId: neighbor ? neighbor.columnId : null,
            side, viewport: copyRect(safeRect),
            target: { oldVisualRect: copyRect(transition.oldRect),
                newVisualRect: copyRect(target.rect) },
            neighbor: neighbor ? {
                oldVisualRect: copyRect(entering ? pairNeighbor : virtualNeighbor),
                newVisualRect: copyRect(entering ? virtualNeighbor : pairNeighbor),
            } : null,
        },
    };
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
        widthTransition,
    } = options;
    const partialLayout = Boolean(options.clipPartial && !presentedColumn &&
        columns.some(column => column.widthMode === "full"));
    const visibility = partialLayout ? isRectVisible : isRectFullyVisible;
    const offsetChanged = Boolean(!presentedColumn && scrollOffsets &&
        scrollOffsets.oldScrollOffsetX !== scrollOffsets.newScrollOffsetX);
    const oldScrollOffsetX = offsetChanged
        ? scrollOffsets.oldScrollOffsetX
        : scrollOffsetX;
    const newScrollOffsetX = offsetChanged
        ? scrollOffsets.newScrollOffsetX
        : scrollOffsetX;
    const hasPartialTarget = partialLayout && columns.some(column => {
        const rect = projectColumnRect(column, safeRect, newScrollOffsetX);
        return isRectVisible(rect, safeRect) && !isRectFullyVisible(rect, safeRect);
    });
    const hasScrollTransaction = offsetChanged || hasPartialTarget;
    let parkingIndex = 0;

    const windows = columns.map((column, index) => {
        const oldProjectedRect = projectColumnRect(column, safeRect, oldScrollOffsetX);
        const newProjectedRect = projectColumnRect(column, safeRect, newScrollOffsetX);
        const oldPlacement = visibility(oldProjectedRect, safeRect)
            ? "visible"
            : "parked";
        const projectedPlacement = visibility(newProjectedRect, safeRect)
            ? "visible"
            : "parked";
        const isPresented = presentedColumn === column;
        const retainedForWidth = !presentedColumn && retainedColumn === column;
        const newPlacement = retainedForWidth ? "visible" : presentedColumn
            ? (isPresented || (retainedColumn === column &&
                projectedPlacement === "visible") ? "visible" : "parked")
            : projectedPlacement;
        const visibleRect = retainedForWidth ? copyRect(column.window.frameGeometry)
            : isPresented ? copyRect(presentedRect) : newProjectedRect;
        const parkingRect = computeParkingRect(column, newPlacement === "parked" ? parkingIndex++ : index, {
                baseX: parkingBaseX,
                innerGap,
                safeRect,
            });
        const rect = newPlacement === "visible" ? visibleRect : parkingRect;
        const role = hasScrollTransaction
            ? transitionRole(oldPlacement, newPlacement)
            : "static";
        return {
            column,
            columnId: column.id,
            placement: newPlacement,
            partial: partialLayout && newPlacement === "visible" && !isRectFullyVisible(visibleRect, safeRect),
            parkingRect,
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
    const scrollTransaction = hasScrollTransaction ? Object.assign({
        id: epoch,
        epoch,
        type: "SCROLL",
        direction: deltaX > 0 ? "left" : "right",
        deltaX,
        oldScrollOffsetX,
        newScrollOffsetX,
        viewport: copyRect(safeRect),
        entries: windows.filter(item => item.transitionRole !== "static").map(item => ({
            windowId: motionWindowId(item),
            columnId: item.columnId,
            logicalX: item.column.logicalX,
            pixelWidth: item.column.pixelWidth,
            oldPlacement: item.oldPlacement,
            newPlacement: item.newPlacement,
        })),
        continuing: windows.filter(item => item.transitionRole === "continuing")
            .map(motionWindowId),
        incoming: windows.filter(item => item.transitionRole === "incoming")
            .map(motionWindowId),
        outgoing: windows.filter(item => item.transitionRole === "outgoing")
            .map(motionWindowId),
    }, partialLayout ? { clipPartial: true } : {},
    oldScrollOffsetX === newScrollOffsetX ? { retargetOnly: true } : {}) : null;

    const widthMotion = columnWidthMotionSnapshot(widthTransition, windows, safeRect, innerGap);
    const motionTargetColumn = wideExitColumn ||
        (retainedColumn ? presentedColumn : null);
    const motionTarget = widthMotion ? widthMotion.target : windows.find(item =>
        item.column === motionTargetColumn) || null;
    const motionNeighbor = widthMotion ? widthMotion.neighbor : motionTarget
        ? adjacentPairWindow(windows, motionTarget, innerGap) : null;
    const viewportMotion = widthMotion ? widthMotion.motion : motionTarget && motionNeighbor
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
            neighborParkingRect: motionNeighbor && computeParkingRect(motionNeighbor.column,
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
        viewportMotion.parkAfterComplete = motionNeighbor && viewportMotion.type === "PAIR_TO_WIDE"
            ? [motionWindowId(motionNeighbor)] : [];
    }

    return {
        reason,
        epoch,
        scrollTransaction,
        viewportMotion: viewportMotion
            ? Object.assign({ viewport: copyRect(safeRect) }, viewportMotion) : null,
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
module.exports = { computeLayoutPlan, transitionRole, captureColumnWidthTransition };
/* cjs:end */
