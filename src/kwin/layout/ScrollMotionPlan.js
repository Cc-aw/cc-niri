"use strict";

// Pure protocol data only. The observer phase publishes without delaying the
// existing geometry commit, starting Spring, or changing parking ownership.
function createViewportScrollPlan(transaction, context) {
    if (!transaction || !context.workspaceId || !context.targetOutput) return null;
    return {
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
    };
}

/* cjs:start */
module.exports = { createViewportScrollPlan };
/* cjs:end */
