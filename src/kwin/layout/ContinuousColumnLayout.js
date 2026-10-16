"use strict";

/* cjs:start */
const { normalizeColumnWidthMode } = require("../model/ColumnStore");
/* cjs:end */

// Event-time JS geometry only. No windows, timers, motion state or retained cache.
function scrollLayoutValidRect(rect) {
    return Boolean(rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.width >= 1 && rect.height >= 1 &&
        [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, rect.width, rect.height]
            .every(value => Math.abs(value) <= Number.MAX_SAFE_INTEGER));
}

function scrollLayoutIntersection(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y
        ? { x, y, width: right - x, height: bottom - y } : null;
}

// Some visible panels (e.g. Plasma "windows go below") deliberately have no
// strut. Reserve their measured edge extent as well as the official WorkArea.
// Only bars spanning the output qualify; short auto-hide docks/popups do not.
function reserveV2EdgePanels(output, area, panels) {
    let left = area.x, top = area.y, right = area.x + area.width, bottom = area.y + area.height;
    for (const panel of panels || []) {
        if (!scrollLayoutValidRect(panel)) continue;
        const pr = panel.x + panel.width, pb = panel.y + panel.height;
        if (panel.x <= output.x && pr >= output.x + output.width && panel.height < output.height) {
            if (panel.y <= output.y && pb > output.y) top = Math.max(top, pb);
            if (pb >= output.y + output.height && panel.y < output.y + output.height) bottom = Math.min(bottom, panel.y);
        }
        if (panel.y <= output.y && pb >= output.y + output.height && panel.width < output.width) {
            if (panel.x <= output.x && pr > output.x) left = Math.max(left, pr);
            if (pr >= output.x + output.width && panel.x < output.x + output.width) right = Math.min(right, panel.x);
        }
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function effectiveScrollLayoutGap(width, height, requestedGap) {
    const requested = Number.isFinite(requestedGap) ? Math.max(0, requestedGap) : 16;
    // Enough room for at least a one-pixel half column and positive height.
    const limit = Math.max(0, Math.floor(Math.min((width - 2) / 3, (height - 1) / 2)));
    return Math.min(requested, limit);
}

function createScrollLayoutGeometry(options) {
    const output = options.outputRect;
    if (!scrollLayoutValidRect(output)) throw new RangeError("invalid V2 OutputRect");
    const outputRect = { x: output.x, y: output.y, width: output.width, height: output.height };
    const diagnostics = [];
    const physicalScale = Number.isFinite(options.physicalScale) && options.physicalScale > 0 &&
        options.physicalScale <= 16 ? options.physicalScale : 1;
    if (physicalScale !== options.physicalScale) diagnostics.push("scale-fallback");
    let area = options.workingArea;
    if (!scrollLayoutValidRect(area) || !scrollLayoutIntersection(outputRect, area)) {
        // A conservative SafeArea is supplied by OutputTopology when clientArea
        // is unavailable. Never silently substitute the full output over a panel.
        area = options.fallbackRect;
        diagnostics.push("working-area-fallback");
    }
    if (!scrollLayoutValidRect(area)) throw new RangeError("no safe V2 WorkingArea");
    const officialArea = scrollLayoutIntersection(outputRect, area);
    let workingArea = officialArea && reserveV2EdgePanels(outputRect, officialArea, options.panelRects);
    if (officialArea && ["x", "y", "width", "height"].some(key => workingArea[key] !== officialArea[key])) {
        diagnostics.push("visible-edge-panel-reserved");
    }
    if (!scrollLayoutValidRect(workingArea)) throw new RangeError("WorkingArea outside output");
    if (["x", "y", "width", "height"].some(key => area[key] !== officialArea[key])) {
        diagnostics.push("working-area-clipped-to-output");
    }
    // A client can report its integer buffer extent divided by fractional scale.
    // Keep vertical bounds on the shared integer logical/device grid so strict
    // configure ACKs remain exact (e.g. 51px panel at 150% must not yield an odd
    // logical client height). Round inward; never enlarge into a panel.
    const gap = effectiveScrollLayoutGap(workingArea.width, workingArea.height, options.gap);
    const requestedTop = Number.isFinite(options.topGap) && options.topGap >= 0 ? Math.floor(options.topGap) : gap;
    const topGap = Math.min(requestedTop, Math.max(0, workingArea.height - gap - 1));
    let step = 1;
    while (step < 16 && Math.abs(step * physicalScale - Math.round(step * physicalScale)) > 0.000001) step++;
    if (Math.abs(step * physicalScale - Math.round(step * physicalScale)) < 0.000001) {
        const y = outputRect.y + Math.ceil((workingArea.y + topGap - outputRect.y) / step) * step - topGap;
        const bottom = outputRect.y + Math.floor((workingArea.y + workingArea.height - gap - outputRect.y) / step) * step + gap;
        if (bottom - y > topGap + gap && (y !== workingArea.y || bottom - y !== workingArea.height)) {
            workingArea = { x: workingArea.x, y, width: workingArea.width, height: bottom - y };
            diagnostics.push("working-area-client-grid");
        }
    }

    if (gap !== options.gap) diagnostics.push("gap-clamped");

    return { outputRect, workingArea, gap, topGap, physicalScale, diagnostics };
}

function computeV2ColumnWidth(mode, workWidth, gap) {
    if (!Number.isFinite(workWidth) || workWidth < 1 || workWidth > Number.MAX_SAFE_INTEGER ||
            !Number.isFinite(gap) || gap < 0) throw new RangeError("invalid V2 width inputs");
    const proportion = mode === "full" ? 1 : mode === "twoThirds" ? 2 / 3 : 1 / 2;
    return Math.max(1, Math.floor((workWidth - gap) * proportion - gap));
}

function clampV2Camera(camera, maxCamera) {
    const upper = Number.isFinite(maxCamera) ? Math.max(0, maxCamera) : 0;
    return Math.max(0, Math.min(Number.isFinite(camera) ? camera : 0, upper));
}

function centeredCamera(column, workWidth, maxCamera) {
    return clampV2Camera(column.logicalX - (workWidth - column.pixelWidth) / 2, maxCamera);
}

function fittedCamera(current, column, workWidth, gap, maxCamera) {
    let target = clampV2Camera(current, maxCamera);
    const left = column.logicalX - gap;
    const right = column.logicalX + column.pixelWidth + gap;
    // An oversize client gets a stable left-aligned fallback; normal presets
    // always fit after gap clamping. Neither case creates a negative wire offset.
    if (right - left > workWidth || left < target) target = left;
    else if (right > target + workWidth) target = right - workWidth;
    return clampV2Camera(target, maxCamera);
}

function focusV2Camera(layout, index, currentCamera) {
    const column = layout.columns[index];
    if (!column) return clampV2Camera(currentCamera, layout.maxCamera);
    const width = layout.geometry.workingArea.width;
    return layout.columns.length === 1 || column.widthMode === "twoThirds"
        ? centeredCamera(column, width, layout.maxCamera)
        : fittedCamera(currentCamera, column, width, layout.geometry.gap, layout.maxCamera);
}

function deriveV2Layout(columns, geometry, options = {}) {
    if (!scrollLayoutValidRect(geometry.workingArea) || !scrollLayoutValidRect(geometry.outputRect) ||
            geometry.gap !== effectiveScrollLayoutGap(geometry.workingArea.width,
                geometry.workingArea.height, geometry.gap)) throw new RangeError("invalid V2 layout geometry");
    const { workingArea, gap } = geometry;
    const halfWidth = computeV2ColumnWidth("half", workingArea.width, gap);
    const leadingInset = Math.max(0, Math.floor((workingArea.width - halfWidth) / 2));
    const trailingInset = leadingInset;
    let nextX = leadingInset;
    const derived = columns.map(column => {
        const widthMode = normalizeColumnWidthMode(column.widthMode, true);
        const pixelWidth = computeV2ColumnWidth(widthMode, workingArea.width, gap);
        const logicalX = nextX;
        nextX += pixelWidth + gap;
        if (!Number.isFinite(nextX) || nextX > Number.MAX_SAFE_INTEGER) {
            throw new RangeError("V2 column strip overflow");
        }
        return { widthMode, logicalX, pixelWidth };
    });
    const last = derived[derived.length - 1];
    const stripEnd = last ? last.logicalX + last.pixelWidth + trailingInset : 0;
    if (stripEnd > Number.MAX_SAFE_INTEGER) throw new RangeError("V2 padded strip overflow");
    const layout = { geometry, columns: derived, leadingInset, trailingInset, stripEnd,
        maxCamera: Math.max(0, stripEnd - workingArea.width) };
    layout.cameraX = focusV2Camera(layout, options.focusedIndex, options.cameraX);
    return layout;
}

function v2ColumnLayoutRect(geometry) {
    const { workingArea, gap } = geometry;
    const topGap = geometry.topGap === undefined ? gap : geometry.topGap;
    return { x: workingArea.x, y: workingArea.y + topGap, width: workingArea.width,
        height: Math.max(1, workingArea.height - topGap - gap) };
}

function projectV2Column(column, geometry, cameraX) {
    const { workingArea, gap, outputRect } = geometry;
    const vertical = v2ColumnLayoutRect(geometry);
    const visualRect = { x: workingArea.x + column.logicalX - cameraX,
        y: vertical.y, width: column.pixelWidth, height: vertical.height };
    const visibleRect = scrollLayoutIntersection(visualRect, outputRect);
    const partiallyVisible = Boolean(visibleRect && ["x", "y", "width", "height"]
        .some(key => visibleRect[key] !== visualRect[key]));
    return { visualRect, visibleRect, partiallyVisible };
}

// Round shared edges, not widths independently. Origin is output-local; logical
// column widths/camera are never multiplied by scale in the model itself.
function v2DeviceRect(rect, geometry) {
    const scale = geometry.physicalScale;
    const x = Math.round((rect.x - geometry.outputRect.x) * scale);
    const y = Math.round((rect.y - geometry.outputRect.y) * scale);
    const right = Math.round((rect.x + rect.width - geometry.outputRect.x) * scale);
    const bottom = Math.round((rect.y + rect.height - geometry.outputRect.y) * scale);
    return { x, y, width: right - x, height: bottom - y };
}

/* cjs:start */
module.exports = { createScrollLayoutGeometry, deriveV2Layout, computeV2ColumnWidth,
    effectiveScrollLayoutGap, clampV2Camera, centeredCamera, fittedCamera, focusV2Camera,
    projectV2Column, v2DeviceRect, v2ColumnLayoutRect };
/* cjs:end */
