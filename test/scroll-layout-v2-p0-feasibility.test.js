"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { anchoredProjection, contains, deviceRect, hit, intersection, localPoint,
    TwoClickOracle } = require("./helpers/scroll-layout-v2-p0-model.js");
const { GeometryCommitter } = require("../src/kwin/layout/GeometryCommitter.js");

const output = { x: 0, y: 0, width: 2560, height: 1440 };
const rect = (x, width) => ({ x, y: 66, width, height: 1358 });

test("P0 right partial keeps client size and real frame on primary", () => {
    const b = anchoredProjection(rect(2136, 1256), output);
    assert.deepEqual(b.clip, rect(2136, 424));
    assert.deepEqual(b.real, rect(1304, 1256));
    assert.equal(b.deltaX, 832);
    const neighbor = { ...output, x: 2560 };
    assert.equal(intersection(b.real, neighbor), null);
    assert.equal(intersection(b.clip, neighbor), null);
    assert.ok(intersection(b.visual, neighbor), "unclipped visual would leak to secondary");
});

test("P0 left and simultaneous partial neighbors stay bounded", () => {
    const left = anchoredProjection(rect(-832, 1256), output);
    const right = anchoredProjection(rect(2136, 1256), output);
    assert.deepEqual(left.clip, rect(0, 424));
    assert.equal(left.real.x, 0);
    assert.equal(left.deltaX, -832);
    assert.equal(right.clip.x - (440 + 1680), 16);
    assert.equal(440 - (left.visual.x + left.visual.width), 16);
});

test("P0 output origin can be negative; touching edges are not visible", () => {
    const shifted = { ...output, x: -2560, y: -100 };
    const b = anchoredProjection({ x: -424, y: -34, width: 1256, height: 1358 }, shifted);
    assert.equal(b.real.x, -1256);
    assert.equal(b.deltaX, 832);
    assert.equal(anchoredProjection(rect(2560, 1256), output), null);
    assert.equal(contains(output, { x: 2560, y: 100 }), false);
});

test("P0 oversize and nonfinite geometry fail closed", () => {
    for (const invalid of [rect(0, 2561), rect(NaN, 1256), rect(0, Infinity), rect(0, 0)]) {
        assert.equal(anchoredProjection(invalid, output), null);
    }
    assert.equal(anchoredProjection(rect(0, 1256), { ...output, height: 0 }), null);
});

test("P0 native rectangle hit test can choose visually covered background B", () => {
    const a = { id: "A", ...anchoredProjection(rect(440, 1680), output) };
    const b = { id: "B", ...anchoredProjection(rect(2136, 1256), output) };
    const point = { x: 1500, y: 300 };
    assert.equal(hit([b, a], point, "clip").id, "A");
    assert.equal(hit([b, a], point, "real").id, "B");
    // Existing viewport-only protection permits both points inside OutputRect.
    assert.equal(contains(output, point), true);
});

test("P0 correct window ID still gives wrong local coordinate without remapping", () => {
    const b = anchoredProjection(rect(2136, 1256), output);
    const point = { x: 2200, y: 300 };
    assert.equal(localPoint(b.visual, point).x, 64);
    assert.equal(localPoint(b.real, point).x, 896);
    const left = anchoredProjection(rect(-832, 1256), output);
    assert.equal(localPoint(left.visual, { x: 100, y: 300 }).x, 932);
    assert.equal(localPoint(left.real, { x: 100, y: 300 }).x, 100);
});

test("P0 surface and expanded Ring clip share strict physical output bound", () => {
    const visual = rect(2136.25, 1256);
    const ring = { x: visual.x - 8, y: visual.y - 8,
        width: visual.width + 16, height: visual.height + 16 };
    for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
        const physicalOutput = deviceRect(output, scale);
        for (const content of [visual, ring]) {
            const clipped = deviceRect(intersection(content, output), scale);
            assert.equal(intersection(clipped, { ...physicalOutput, x: physicalOutput.width }), null);
            assert.ok(Math.abs(clipped.x - Math.max(content.x, output.x) * scale) <= 0.5);
            assert.equal(clipped.x + clipped.width, physicalOutput.width);
        }
    }
});

test("P0 fallback consumes press and release even after focus or geometry becomes ready", () => {
    const oracle = new TwoClickOracle();
    assert.equal(oracle.event({ type: "press", button: 1, partial: true, ready: false }), "focus-only");
    assert.equal(oracle.event({ type: "release", button: 1, partial: false, ready: true }), "consume");
    assert.equal(oracle.pendingButtons, 0);
    assert.equal(oracle.event({ type: "press", button: 1, partial: false, ready: true }), "native");
    assert.equal(oracle.event({ type: "release", button: 1, partial: false, ready: true }), "native");
});

test("P0 fallback does not forward wheel or a second button during suppressed sequence", () => {
    const oracle = new TwoClickOracle();
    assert.equal(oracle.event({ type: "axis", partial: true, ready: false }), "consume");
    oracle.event({ type: "press", button: 1, partial: true, ready: false });
    assert.equal(oracle.event({ type: "press", button: 2, partial: false, ready: true }), "consume");
    assert.equal(oracle.event({ type: "axis", partial: false, ready: true }), "consume");
    for (const button of [1, 2]) {
        assert.equal(oracle.event({ type: "release", button, grabbed: true }), "consume");
    }
    assert.equal(oracle.pendingButtons, 0);
    assert.equal(oracle.event({ type: "press", button: 1, grabbed: true }), "native");
});

test("P0 fallback waits for actual geometry, not focus intent", () => {
    const oracle = new TwoClickOracle();
    assert.equal(oracle.event({ type: "press", button: 1, partial: false, ready: false }), "consume");
    assert.equal(oracle.event({ type: "release", button: 1, partial: false, ready: false }), "consume");
});

test("P0 production GeometryCommitter parks partial without Native ownership", () => {
    const window = { frameGeometry: rect(1304, 1256) }, state = {};
    const column = { id: 1, window };
    let hidden = false;
    const copy = value => ({ ...value });
    const committer = new GeometryCommitter({ stateFor: () => state,
        sameRect: (a, b) => JSON.stringify(a) === JSON.stringify(b), rectCopy: copy,
        rectText: JSON.stringify, isTileMode: () => false,
        isRectInsideAnyOutput: geometry => Boolean(intersection(geometry, output)),
        debug: () => {}, warn: () => {}, setWindowVisibility: (_, visible) => { hidden = !visible; },
        isWindowHidden: () => hidden, rememberVisibleGeometry: () => {} });
    const item = { column, partial: true, placement: "visible", rect: rect(2136, 1256),
        parkingRect: rect(-10000, 1256), newProjectedRect: rect(2136, 1256) };
    committer.commit({ commitOrder: [item], windows: [item], reason: "P0" });
    assert.equal(hidden, true);
    assert.deepEqual(window.frameGeometry, item.parkingRect);
    assert.equal(item.placement, "visible", "fail-safe does not mutate plan");
});

test("P0 production GeometryCommitter supersedes an unacknowledged configure", () => {
    let requests = 0;
    const actual = rect(440, 1680), pending = rect(16, 2528);
    const window = { get frameGeometry() { return actual; },
        set frameGeometry(value) { requests++; assert.deepEqual(value, actual); } };
    const state = { scrollLastRequestedGeometry: pending };
    const committer = new GeometryCommitter({ stateFor: () => state,
        sameRect: (a, b) => JSON.stringify(a) === JSON.stringify(b), rectCopy: value => ({ ...value }),
        rectText: JSON.stringify, isTileMode: () => false, debug: () => {} });
    committer.commitGeometry({ id: 1, window }, actual, "cancel pending resize");
    assert.equal(requests, 1);
    assert.deepEqual(state.scrollLastRequestedGeometry, actual);
    committer.commitGeometry({ id: 1, window }, actual, "duplicate");
    assert.equal(requests, 1);
});
