"use strict";

/* cjs:start */
const { createScrollLayoutGeometry, projectV2Column, v2ColumnLayoutRect } = require("./ContinuousColumnLayout");
/* cjs:end */

// P3 is camera-only, with unchanged logical positions and client sizes.
// Width, membership and basis changes require the P4 geometry transaction.
function createPartialScrollPlan(intent, options) {
    const sameRect = (a, b) => a && b && ["x", "y", "width", "height"].every(k => a[k] === b[k]);
    const validId = value => typeof value === "string" && value.length > 0 && value.length <= 256 &&
        value.trim() === value && value.toLowerCase() === value && !/[{}]/u.test(value);
    const validText = value => typeof value === "string" && value.length <= 256 && Boolean(value.trim());
    const capability = options && options.capability;
    if (!intent || !options || !capability || capability.protocol !== 3 ||
            capability.type !== "PARTIAL_SCROLL" || capability.enabled !== true ||
            capability.inputPolicy !== "two-click" || intent.kind !== "scroll-layout-v2-intent" ||
            !validText(intent.sessionId) || !validText(intent.workspaceId) || !validText(intent.targetOutput) ||
            !Number.isSafeInteger(intent.epoch) || intent.epoch < 0 ||
            !Number.isSafeInteger(intent.scopeRevision) || intent.scopeRevision <= 0 ||
            !Number.isSafeInteger(options.issuedAt) || options.issuedAt < 0 ||
            !Number.isFinite(intent.maxCamera) || intent.maxCamera < 0 || intent.maxCamera > Number.MAX_SAFE_INTEGER ||
            !Number.isFinite(intent.cameraTargetX) || intent.cameraTargetX < 0 ||
            intent.cameraTargetX > intent.maxCamera || !Array.isArray(intent.entries) || !intent.entries.length) return null;
    const initial = intent.continuity === "initial" && !intent.source;
    if (!initial && (intent.requiredCapability !== "v2-scroll" || intent.continuity !== "observed" || !intent.source)) return null;
    let geometry;
    try { geometry = createScrollLayoutGeometry(intent.geometry); } catch (_error) { return null; }
    if (!sameRect(geometry.outputRect, intent.geometry.outputRect) ||
            !sameRect(geometry.workingArea, intent.geometry.workingArea) || geometry.gap !== intent.geometry.gap || geometry.topGap !== (intent.geometry.topGap ?? intent.geometry.gap)) return null;
    const from = initial ? intent.cameraTargetX : intent.source.cameraX;
    if (!Number.isFinite(from) || from < 0 || from > intent.maxCamera) return null;
    if (!initial && (!intent.source.geometry || !sameRect(intent.source.geometry.outputRect, geometry.outputRect) ||
            !sameRect(intent.source.geometry.workingArea, geometry.workingArea) ||
            intent.source.geometry.gap !== geometry.gap || (intent.source.geometry.topGap ?? intent.source.geometry.gap) !== geometry.topGap || !Array.isArray(intent.source.entries))) return null;
    const source = new Map();
    if (!initial) for (const row of intent.source.entries) {
        if (!row || source.has(row.uuid)) return null;
        source.set(row.uuid, row.visualRect);
    }
    const ids = new Set(), columns = new Set(), intervals = [], entries = [];
    for (const row of intent.entries) {
        if (!row || !validId(row.uuid) || ids.has(row.uuid) || columns.has(row.columnId) ||
                !Number.isSafeInteger(row.columnId) || row.columnId < 0 ||
                !Number.isFinite(row.logicalX) || row.logicalX < 0 ||
                !Number.isFinite(row.pixelWidth) || row.pixelWidth < 1 || row.pixelWidth > geometry.workingArea.width ||
                row.logicalX + row.pixelWidth > Number.MAX_SAFE_INTEGER ||
                intervals.some(r => row.logicalX < r[1] && row.logicalX + row.pixelWidth > r[0])) return null;
        ids.add(row.uuid); columns.add(row.columnId); intervals.push([row.logicalX, row.logicalX + row.pixelWidth]);
        const oldPose = projectV2Column(row, geometry, from);
        const newPose = projectV2Column(row, geometry, intent.cameraTargetX);
        if (!sameRect(newPose.visualRect, row.visualRect)) return null;
        if (!oldPose.visibleRect && !newPose.visibleRect &&
                geometry.workingArea.x + row.logicalX + row.pixelWidth - Math.min(from, intent.cameraTargetX) > geometry.outputRect.x &&
                geometry.workingArea.x + row.logicalX - Math.max(from, intent.cameraTargetX) < geometry.outputRect.x + geometry.outputRect.width) return null;
        if (!initial && oldPose.visibleRect) {
            const observed = source.get(row.uuid);
            if (!observed || !["x", "y", "width", "height"].every(k =>
                    Number.isFinite(observed[k]) && Math.abs(observed[k] - oldPose.visualRect[k]) <= 0.000001)) return null;
        }
        if (oldPose.visibleRect || newPose.visibleRect) entries.push({ windowId: row.uuid,
            columnId: row.columnId, logicalX: row.logicalX, pixelWidth: row.pixelWidth,
            oldPlacement: oldPose.visibleRect ? "visible" : "parked",
            newPlacement: newPose.visibleRect ? "visible" : "parked" });
    }
    if (!entries.length || entries.length > 256 || [...source.keys()].some(id => !ids.has(id))) return null;
    return { protocol: 3, type: "PARTIAL_SCROLL", sessionId: intent.sessionId,
        workspaceId: intent.workspaceId, targetOutput: intent.targetOutput, epoch: intent.epoch,
        issuedAt: options.issuedAt, scopeRevision: intent.scopeRevision, maxCamera: intent.maxCamera,
        oldScrollOffsetX: from, newScrollOffsetX: intent.cameraTargetX,
        retargetOnly: from === intent.cameraTargetX, clipPartial: true,
        viewport: geometry.outputRect,
        layoutRect: v2ColumnLayoutRect(geometry), entries };
}

// JS plans real frames; Native verifies these safe anchors against KWin facts.
// Only new-visible rows are committed here. Outgoing retirement stays ACK gated.
function partialScrollSafeTargets(plan) {
    if (!plan || plan.type !== "PARTIAL_SCROLL") return [];
    const output = plan.viewport, layout = plan.layoutRect;
    return plan.entries.filter(e => e.newPlacement === "visible").map(e => ({ windowId: e.windowId,
        rect: { x: Math.max(output.x, Math.min(output.x + output.width - e.pixelWidth,
            layout.x + e.logicalX - plan.newScrollOffsetX)), y: layout.y,
        width: e.pixelWidth, height: layout.height } }));
}

/* cjs:start */
module.exports = { createPartialScrollPlan, partialScrollSafeTargets };
/* cjs:end */
