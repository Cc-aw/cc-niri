"use strict";

// Pure geometry/protocol preparation, including return to the last committed
// offset while an earlier target is armed but its geometry is not committed.
function createViewportScrollPlan(transaction, context) {
    if (!transaction || !context.workspaceId || !context.targetOutput) return null;
    return Object.assign(transaction.retargetOnly ? { retargetOnly: true } : {},
        transaction.clipPartial ? { clipPartial: true } : {}, {
        protocol: 2,
        type: "SCROLL",
        epoch: transaction.epoch,
        issuedAt: context.issuedAt,
        workspaceId: context.workspaceId,
        targetOutput: context.targetOutput,
        oldScrollOffsetX: transaction.oldScrollOffsetX,
        newScrollOffsetX: transaction.newScrollOffsetX,
        viewport: Object.assign({}, transaction.viewport),
        entries: transaction.entries.map(entry => Object.assign({}, entry, {
            windowId: context.normalizeUuid(entry.windowId),
        })),
    });
}

function prepareViewportReturnPlan(plan, offset, viewport) {
    if (plan.viewportMotion || plan.scrollTransaction) return plan;
    const windows = plan.windows.map(item => item.placement === "visible"
        ? Object.assign({}, item, { transitionRole: "continuing", oldPlacement: "visible", newPlacement: "visible" })
        : item);
    const entries = windows.filter(item => item.placement === "visible").map(item => ({
        windowId: String(item.column.window.internalId), columnId: item.columnId,
        logicalX: item.column.logicalX, pixelWidth: item.column.pixelWidth,
        oldPlacement: "visible", newPlacement: "visible",
    }));
    return Object.assign({}, plan, { windows,
        commitOrder: plan.commitOrder.map(item => windows.find(window => window.columnId === item.columnId)),
        scrollTransaction: { id: plan.epoch, epoch: plan.epoch, type: "SCROLL", retargetOnly: true,
            direction: "none", deltaX: 0, oldScrollOffsetX: offset, newScrollOffsetX: offset,
            viewport: Object.assign({}, viewport), entries },
    });
}

// Width animation retains a neighbor's real frame while painting it toward a
// virtual edge. Protect those planned real frames with a stationary clip;
// the existing Pair/Wide effect continues to supply every paint transform.
function createWidthViewportClipPlan(plan, context) {
    if (!plan.viewportMotion || !plan.windows.some(item => item.partial)) return null;
    const viewport = plan.viewportMotion.viewport;
    const visible = plan.windows.filter(item => item.placement === "visible");
    const offset = Math.max(0, ...visible.map(item => viewport.x - item.rect.x));
    return createViewportScrollPlan({ epoch: plan.epoch, retargetOnly: true, clipPartial: true,
        oldScrollOffsetX: offset, newScrollOffsetX: offset, viewport,
        entries: visible.map(item => ({ windowId: String(item.column.window.internalId),
            columnId: item.columnId, logicalX: item.rect.x - viewport.x + offset,
            pixelWidth: item.rect.width, oldPlacement: "visible", newPlacement: "visible" })),
    }, context);
}

/* cjs:start */
module.exports = { createViewportScrollPlan, prepareViewportReturnPlan, createWidthViewportClipPlan };
/* cjs:end */
