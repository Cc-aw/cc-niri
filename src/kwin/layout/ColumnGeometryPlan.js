"use strict";

/* cjs:start */
const { createScrollLayoutGeometry, projectV2Column, v2ColumnLayoutRect } = require("./ContinuousColumnLayout");
/* cjs:end */

function columnGeometryRect(rect) {
    return Boolean(rect && [rect.x, rect.y, rect.width, rect.height,
        rect.x + rect.width, rect.y + rect.height].every(v =>
        Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) && rect.width >= 1 && rect.height >= 1);
}
function columnGeometrySameRect(a, b) {
    return columnGeometryRect(a) && columnGeometryRect(b) &&
        ["x", "y", "width", "height"].every(k => a[k] === b[k]);
}
function columnGeometryCopyRect(r) { return { x: r.x, y: r.y, width: r.width, height: r.height }; }
function columnGeometryInside(a, b) {
    return columnGeometryRect(a) && columnGeometryRect(b) && a.x >= b.x && a.y >= b.y &&
        a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
}
function columnGeometryVisible(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function columnGeometryLayout(geometry) {
    let normalized;
    try { normalized = createScrollLayoutGeometry(geometry); } catch (_error) { return null; }
    if (!columnGeometrySameRect(normalized.outputRect, geometry.outputRect) ||
            !columnGeometrySameRect(normalized.workingArea, geometry.workingArea) ||
            normalized.gap !== geometry.gap || normalized.topGap !== (geometry.topGap ?? geometry.gap) || normalized.physicalScale !== geometry.physicalScale) return null;
    return v2ColumnLayoutRect(normalized);
}

// A proposed P4 wire contract, deliberately distinct from camera-only protocol3.
// Only a future Native capability with per-client paint/configure facts can
// authorize it. P3's shared camera projection is insufficient evidence.
function createColumnGeometryPlan(intent, options) {
    const capability = options && options.capability, source = options && options.observation;
    const integer = v => Number.isSafeInteger(v) && v >= 0;
    const scalar = v => Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
    const text = v => typeof v === "string" && v.length <= 256 && Boolean(v.trim());
    const id = v => text(v) && v.trim() === v && v.toLowerCase() === v && !/[{}]/u.test(v);
    if (!capability || capability.protocol !== 4 || capability.type !== "COLUMN_GEOMETRY" ||
            capability.enabled !== true || capability.inputPolicy !== "two-click" ||
            capability.sourcePolicy !== "painted-client-frames" || !intent ||
            intent.kind !== "scroll-layout-v2-intent" || intent.continuity !== "observed" ||
            !["v2-scroll", "v2-column-geometry"].includes(intent.requiredCapability) ||
            !text(intent.sessionId) || !text(intent.workspaceId) || !text(intent.targetOutput) ||
            !integer(intent.epoch) || !integer(intent.scopeRevision) || intent.scopeRevision === 0 ||
            !integer(options.issuedAt) || !scalar(intent.maxCamera) || !scalar(intent.cameraTargetX) ||
            intent.cameraTargetX > intent.maxCamera || !Array.isArray(intent.entries) ||
            !intent.entries.length || intent.entries.length > 256 || !intent.source ||
            !source || source.protocol !== 4 || source.type !== "COLUMN_GEOMETRY_SOURCE" ||
            !["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => source[k] === intent[k]) ||
            !integer(source.epoch) || source.epoch < 1 || source.epoch >= intent.epoch ||
            !integer(source.sampleSerial) || source.epoch !== intent.source.epoch ||
            source.sampleSerial !== intent.source.sampleSerial || !scalar(source.maxCamera) ||
            !scalar(source.cameraX) || source.cameraX > source.maxCamera || source.cameraX !== intent.source.cameraX ||
            !Array.isArray(source.entries) || source.entries.length !== intent.entries.length ||
            !Array.isArray(intent.source.entries) || intent.source.entries.length > 256) return null;
    const layout = columnGeometryLayout(intent.geometry), oldLayout = columnGeometryLayout(intent.source.geometry);
    if (!layout || !oldLayout || !columnGeometrySameRect(source.layoutRect, oldLayout) ||
            !columnGeometrySameRect(source.viewport, intent.source.geometry.outputRect) ||
            !columnGeometrySameRect(source.viewport, intent.geometry.outputRect)) return null;
    const observed = new Map(), painted = new Map(), seenColumns = new Set(), ids = new Set(), intervals = [];
    for (const row of intent.source.entries) {
        if (!row || !id(row.uuid) || painted.has(row.uuid) || !columnGeometryRect(row.visualRect)) return null;
        painted.set(row.uuid, row.visualRect);
    }
    for (const row of source.entries) {
        if (!row || !id(row.windowId) || observed.has(row.windowId) || !integer(row.columnId) ||
                !columnGeometryRect(row.frameRect) || row.frameRect.width > source.viewport.width ||
                row.frameRect.height > source.viewport.height || row.acknowledged !== true) return null;
        if (row.owned === true) {
            if (!((row.painted === true && row.culled !== true) ||
                    (row.painted === false && row.culled === true && columnGeometryRect(row.visualRect) && !columnGeometryVisible(row.visualRect, source.viewport))) || !columnGeometryInside(row.frameRect, source.viewport) ||
                    !columnGeometryRect(row.visualRect) || (!Number.isFinite(row.logicalX) || Math.abs(row.logicalX) > Number.MAX_SAFE_INTEGER) ||
                    row.frameRect.width > oldLayout.width ||
                    row.logicalX + row.frameRect.width > Number.MAX_SAFE_INTEGER ||
                    Math.abs(row.visualRect.x - (oldLayout.x + row.logicalX - source.cameraX)) > 0.000001 ||
                    row.visualRect.y !== oldLayout.y || row.visualRect.height !== oldLayout.height ||
                    row.visualRect.width !== row.frameRect.width || row.visualRect.height !== row.frameRect.height ||
                    row.visualRect.y !== row.frameRect.y || !columnGeometrySameRect(painted.get(row.windowId), row.visualRect)) return null;
        } else if (row.owned !== false || row.painted !== false || row.hidden !== true ||
                row.visualRect !== null || painted.has(row.windowId)) return null;
        observed.set(row.windowId, row);
    }
    const entries = [];
    for (const row of intent.entries) {
        if (!row || !id(row.uuid) || ids.has(row.uuid) || !integer(row.columnId) || seenColumns.has(row.columnId) ||
                (!Number.isFinite(row.logicalX) || Math.abs(row.logicalX) > Number.MAX_SAFE_INTEGER) || !scalar(row.pixelWidth) || row.pixelWidth < 1 || row.pixelWidth > layout.width ||
                row.logicalX + row.pixelWidth > Number.MAX_SAFE_INTEGER || intervals.some(r =>
                    row.logicalX < r[1] && row.logicalX + row.pixelWidth > r[0])) return null;
        const previous = observed.get(row.uuid);
        if (!previous || previous.columnId !== row.columnId) return null;
        const target = projectV2Column(row, intent.geometry, intent.cameraTargetX);
        if (!columnGeometrySameRect(target.visualRect, row.visualRect)) return null;
        const frame = columnGeometryCopyRect(target.visualRect);
        frame.x = Math.max(source.viewport.x, Math.min(source.viewport.x + source.viewport.width - frame.width, frame.x));
        if (!columnGeometryInside(frame, source.viewport)) return null;
        ids.add(row.uuid); seenColumns.add(row.columnId); intervals.push([row.logicalX, row.logicalX + row.pixelWidth]);
        entries.push({ windowId: row.uuid, columnId: row.columnId,
            sourceKind: previous.culled === true ? "culled" : previous.owned ? "painted" : "parked",
            oldLogicalX: previous.owned ? previous.logicalX : null, newLogicalX: row.logicalX,
            oldPixelWidth: previous.frameRect.width, newPixelWidth: row.pixelWidth,
            oldFrameRect: columnGeometryCopyRect(previous.frameRect),
            oldVisualRect: previous.owned ? columnGeometryCopyRect(previous.visualRect) : null,
            committedTargetRect: frame,
            oldPlacement: previous.owned && columnGeometryVisible(previous.visualRect, source.viewport) ? "visible" : "parked",
            newPlacement: target.visibleRect ? "visible" : "parked" });
    }
    if ([...painted.keys()].some(key => !ids.has(key))) return null;
    return { protocol: 4, type: "COLUMN_GEOMETRY", sessionId: intent.sessionId,
        workspaceId: intent.workspaceId, targetOutput: intent.targetOutput, epoch: intent.epoch,
        issuedAt: options.issuedAt, scopeRevision: intent.scopeRevision,
        sourceEpoch: source.epoch, sourceSampleSerial: source.sampleSerial,
        oldScrollOffsetX: source.cameraX, newScrollOffsetX: intent.cameraTargetX,
        oldMaxCamera: source.maxCamera, maxCamera: intent.maxCamera, clipPartial: true,
        viewport: columnGeometryCopyRect(source.viewport), oldLayoutRect: oldLayout, layoutRect: layout, entries };
}

/* cjs:start */
module.exports = { createColumnGeometryPlan, columnGeometrySameRect };
/* cjs:end */
