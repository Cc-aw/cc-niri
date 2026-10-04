"use strict";

// Pure geometry/protocol preparation, including return to the last committed
// offset while an earlier target is armed but its geometry is not committed.
function createViewportScrollPlan(transaction, context) {
    if (!transaction || !context.workspaceId || !context.targetOutput) return null;
    return Object.assign(transaction.retargetOnly ? { retargetOnly: true } : {}, {
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

/* cjs:start */
module.exports = { createViewportScrollPlan, prepareViewportReturnPlan };
/* cjs:end */
