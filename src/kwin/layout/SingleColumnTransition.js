"use strict";

// Short-lived metadata at membership changes only, never a second window model.
// Rust retains the last painted camera sample when the coordinate origin agrees.
function captureSingleColumnLayout(state, enabled) {
    if (!enabled || state.columns.length > 2 || !state.safeRect) return null;
    return {
        workspaceId: state.activeWorkspaceId, output: state.targetOutput,
        safeRect: Object.assign({}, state.safeRect),
        scrollOffsetX: state.scrollOffsetX,
        pair: state.viewport.mode === "pair" && state.presentation.mode === "normal",
        columns: state.columns.map(column => ({ window: column.window,
            logicalX: column.logicalX, pixelWidth: column.pixelWidth, widthMode: column.widthMode })),
    };
}

function prepareSingleColumnReindexPlan(plan, previous, offset) {
    if (!previous || plan.viewportMotion || !Number.isFinite(previous.scrollOffsetX)) return null;
    const survivors = plan.windows.filter(item => previous.columns.some(old => old.window === item.column.window));
    if (survivors.length !== 1) return null;
    const source = survivors[0], old = previous.columns.find(c => c.window === source.column.window);
    const sourceX = old.logicalX - previous.scrollOffsetX;
    // Hidden/partial sources have no continuous fully visible half-column pose.
    // Keep the existing static fallback for these and safe-area/width changes.
    if (source.placement !== "visible" || sourceX < 0 ||
            sourceX + old.pixelWidth > previous.safeRect.width ||
            old.pixelWidth !== source.column.pixelWidth || old.logicalX === source.column.logicalX) return null;
    const windows = plan.windows.map(item => Object.assign({}, item, {
        transitionRole: item === source ? "continuing" : item.placement === "visible" ? "incoming" : "static",
        oldPlacement: item === source ? "visible" : "parked", newPlacement: item.placement,
    }));
    const entries = windows.filter(item => item.transitionRole !== "static").map(item => ({
        windowId: String(item.column.window.internalId), columnId: item.columnId,
        logicalX: item.column.logicalX, pixelWidth: item.column.pixelWidth,
        oldPlacement: item.oldPlacement, newPlacement: item.newPlacement,
    }));
    return Object.assign({}, plan, { windows,
        commitOrder: plan.commitOrder.map(item => windows.find(w => w.columnId === item.columnId)),
        scrollTransaction: { id: plan.epoch, epoch: plan.epoch, type: "COLUMN_REINDEX",
            sourceWindowId: String(source.column.window.internalId), sourceLogicalX: old.logicalX,
            direction: "reindex", deltaX: offset - previous.scrollOffsetX,
            oldScrollOffsetX: previous.scrollOffsetX, newScrollOffsetX: offset,
            viewport: Object.assign({}, previous.safeRect), entries },
    });
}

function classifySingleColumnTransition(previous, state) {
    if (!previous || !previous.pair || !state.enabled || state.workspaceSwitching ||
            previous.workspaceId !== state.activeWorkspaceId || previous.output !== state.targetOutput ||
            !state.safeRect || state.viewport.mode !== "pair" || state.presentation.mode !== "normal") return null;
    const before = previous.columns, after = state.columns;
    if (!((before.length === 1 && after.length === 2) ||
            (before.length === 2 && after.length === 1))) return null;
    if (before.some(column => column.widthMode !== "half") ||
            after.some(column => column.widthMode !== "half")) return null;
    if (["x", "y", "width", "height"].some(key => previous.safeRect[key] !== state.safeRect[key])) return "rebase";
    const surviving = after.filter(column => before.some(old => old.window === column.window));
    if (surviving.length !== 1) return null;
    const column = surviving[0], old = before.find(candidate => candidate.window === column.window);
    return old.logicalX === column.logicalX && old.pixelWidth === column.pixelWidth ? "scroll" : "reindex";
}

/* cjs:start */
module.exports = { captureSingleColumnLayout, classifySingleColumnTransition, prepareSingleColumnReindexPlan };
/* cjs:end */
