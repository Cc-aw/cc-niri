"use strict";

const assert = require("node:assert/strict");
const { deriveColumnLayout, computeStripWidth, boundScrollOffset,
    scrollOffsetToRevealColumn, virtualLeadingInset } = require("../src/kwin/layout/ColumnLayout");
const { projectColumnRect } = require("../src/kwin/layout/Projection");
const { loadRuntimeConfig } = require("../src/kwin/runtime/RuntimeConfig");
const { InvariantChecker } = require("../src/kwin/stability/InvariantChecker");

const options = { alwaysCenterSingleColumn: true };
const safe = { x: 24, y: 50, width: 2512, height: 1382 };
const columns = (count, widthMode = "half") => Array.from({ length: count }, () => ({ widthMode }));
assert.equal(loadRuntimeConfig((_key, fallback) => fallback).alwaysCenterSingleColumn, false);
assert.equal(loadRuntimeConfig((key, fallback) => key === "AlwaysCenterSingleColumn" ? true : fallback)
    .alwaysCenterSingleColumn, true);
assert.equal(virtualLeadingInset(2512, 8, true), 630);
for (const count of [0, 1, 2, 5]) {
    assert.deepEqual(deriveColumnLayout(columns(count), 2512, 8),
        deriveColumnLayout(columns(count), 2512, 8, { alwaysCenterSingleColumn: false }));
    assert.deepEqual(deriveColumnLayout(columns(count), 2512, 8).map(c => c.logicalX),
        Array.from({ length: count }, (_, i) => i * 1260));
}
for (const [count, offset, visible] of [[1, 0, [654]], [2, 630, [24, 1284]], [3, 1890, [24, 1284]]]) {
    const derived = deriveColumnLayout(columns(count), 2512, 8, options);
    assert.deepEqual(derived.map(c => c.logicalX), Array.from({ length: count }, (_, i) => 630 + i * 1260));
    const rects = derived.map(c => projectColumnRect(c, safe, offset));
    assert.deepEqual(rects.slice(-visible.length).map(r => r.x), visible);
}
for (const x of [-2560, 0, 24, 2560]) {
    const [half] = deriveColumnLayout(columns(1), 2512, 8, options);
    assert.equal(projectColumnRect(half, { ...safe, x }, 0).x, x + 630);
}
const [full] = deriveColumnLayout(columns(1, "full"), 2512, 8, options);
assert.equal(full.logicalX, 630);
assert.equal(full.pixelWidth, 2512);
assert.equal(scrollOffsetToRevealColumn(0, full, computeStripWidth([full]), 2512), 630);
assert.equal(projectColumnRect(full, safe, 630).x, 24);
assert.equal(boundScrollOffset(-630, computeStripWidth([full]), 2512), 0);
for (const width of [1, 2, 3, 2511, 2512.5, NaN, Infinity, -Infinity, 0, -1]) {
    for (const gap of [0, 8, 10000, NaN, Infinity, -8]) {
        const inset = virtualLeadingInset(width, gap, true);
        assert.ok(Number.isFinite(inset) && inset >= 0);
        const layout = deriveColumnLayout(columns(3), width, gap, options);
        layout.forEach(c => assert.ok(Number.isFinite(c.logicalX) && Number.isFinite(c.pixelWidth) && c.pixelWidth >= 1));
        if (Number.isFinite(width) && width >= 1 && Number.isFinite(gap) && gap >= 0) {
            assert.ok(inset <= width / 2);
            for (let i = 1; i < layout.length; i += 1)
                assert.equal(layout[i].logicalX, layout[i - 1].logicalX + layout[i - 1].pixelWidth + gap);
        }
    }
}
const window = { internalId: "only", output: "primary" };
const state = { columns: [{ id: 1, window, ...deriveColumnLayout(columns(1), 2512, 8, options)[0] }],
    safeRect: safe, innerGap: 8, targetOutput: "primary", focusedColumnIndex: 0, scrollOffsetX: 0,
    presentation: { mode: "normal", windowUuid: null } };
const checker = new InvariantChecker({ appState: state, alwaysCenterSingleColumn: true,
    windowStates: new Map([[window, { managedByScrollLayout: true, columnId: 1, floating: false, adoptionPhase: "managed" }]]),
    normalizeUuid: value => value, stripWidth: () => computeStripWidth(state.columns),
    managedPhases: ["managed"], normalPresentationMode: "normal" });
assert.deepEqual(checker.errors(), []);
state.columns[0].logicalX = 0;
assert.ok(checker.errors().some(error => error.startsWith("logical-x:")), "the start-point invariant remains active");
console.log("PASS single-column inset, disabled compatibility, full geometry, edge dimensions and invariants");
