"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createScrollLayoutGeometry, deriveV2Layout, computeV2ColumnWidth,
    focusV2Camera, centeredCamera, fittedCamera, clampV2Camera,
    projectV2Column, v2DeviceRect } = require("../src/kwin/layout/ContinuousColumnLayout");
const { loadRuntimeConfig } = require("../src/kwin/runtime/RuntimeConfig");
const { OutputTopology } = require("../src/kwin/runtime/OutputTopology");
const { computeSafeRect } = require("../src/kwin/layout/SafeArea");

const rect = (width = 2560, height = 1440, x = 0, y = 0) => ({ x, y, width, height });
const geometry = (width = 2560, gap = 16, scale = 1, height = 1440) =>
    createScrollLayoutGeometry({ outputRect: rect(width, height), workingArea: rect(width, height),
        gap, physicalScale: scale });
const columns = modes => modes.map(widthMode => ({ widthMode }));
const layout = (modes, options = {}, g = geometry()) => deriveV2Layout(columns(modes), g, options);

test("V2 presets use the documented logical widths and uniform vertical gap", () => {
    const g = geometry();
    assert.deepEqual(["half", "twoThirds", "full"].map(mode => computeV2ColumnWidth(mode, 2560, 16)),
        [1256, 1680, 2528]);
    const l = layout(["half", "half"], { focusedIndex: 1 }, g);
    assert.equal(l.cameraX, 636);
    assert.equal(l.leadingInset, 652);
    assert.equal(l.trailingInset, 652);
    assert.equal(l.maxCamera, 1272);
    const [a, b] = l.columns.map(c => projectV2Column(c, g, l.cameraX).visualRect);
    assert.deepEqual(a, { x: 16, y: 16, width: 1256, height: 1408 });
    assert.deepEqual(b, { x: 1288, y: 16, width: 1256, height: 1408 });
    assert.equal(b.x - a.x - a.width, 16);
    assert.equal(2560 - b.x - b.width, 16);
});

test("V2 twoThirds center exposes a full-sized right neighbor only to OutputRect", () => {
    const l = layout(["twoThirds", "half"], { focusedIndex: 0 });
    assert.equal(l.cameraX, 212);
    assert.deepEqual(l.columns.map(c => c.logicalX), [652, 2348]);
    const [a, b] = l.columns.map(c => projectV2Column(c, l.geometry, l.cameraX));
    assert.deepEqual(a.visualRect, { x: 440, y: 16, width: 1680, height: 1408 });
    assert.deepEqual(b.visualRect, { x: 2136, y: 16, width: 1256, height: 1408 });
    assert.deepEqual(b.visibleRect, { x: 2136, y: 16, width: 424, height: 1408 });
    assert.equal(a.partiallyVisible, false);
    assert.equal(b.partiallyVisible, true);
});

test("V2 left and simultaneous partial neighbors keep their original widths", () => {
    const l = layout(["half", "twoThirds", "half"], { focusedIndex: 1 });
    assert.equal(l.cameraX, 1484);
    const [a, b, c] = l.columns.map(column => projectV2Column(column, l.geometry, l.cameraX));
    assert.equal(a.visualRect.x, -832);
    assert.equal(a.visualRect.width, 1256);
    assert.equal(a.visibleRect.width, 424);
    assert.equal(b.visualRect.x, 440);
    assert.equal(c.visualRect.x, 2136);
    assert.equal(c.visibleRect.width, 424);
    assert.deepEqual([a.partiallyVisible, b.partiallyVisible, c.partiallyVisible], [true, false, true]);
});

test("V2 H/L target policy preserves prefix/width, fits half minimally and centers twoThirds", () => {
    const modes = ["half", "twoThirds", "full", "half", "twoThirds"];
    const source = columns(modes);
    const original = JSON.stringify(source);
    const l = deriveV2Layout(source, geometry());
    const fixed = JSON.stringify(l.columns);
    let camera = 0;
    for (const index of [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 0]) {
        const column = l.columns[index];
        const oldCamera = camera;
        camera = focusV2Camera(l, index, camera);
        assert.ok(camera >= 0 && camera <= l.maxCamera);
        if (column.widthMode === "twoThirds") {
            assert.equal(camera, centeredCamera(column, 2560, l.maxCamera));
            const r = projectV2Column(column, l.geometry, camera).visualRect;
            assert.equal(r.x + r.width / 2, 1280);
        } else {
            const low = column.logicalX + column.pixelWidth + 16 - 2560;
            const high = column.logicalX - 16;
            assert.equal(camera, Math.max(low, Math.min(oldCamera, high)), "minimum fit movement");
            const r = projectV2Column(column, l.geometry, camera).visualRect;
            assert.ok(r.x >= 16 && r.x + r.width <= 2544);
        }
        assert.equal(JSON.stringify(l.columns), fixed);
        assert.equal(JSON.stringify(source), original);
    }
    assert.equal(focusV2Camera(l, -1, -20), 0);
    assert.equal(focusV2Camera(l, 99, Infinity), 0);
});

test("V2 single and first/last twoThirds can center with a nonnegative camera", () => {
    for (const mode of ["half", "twoThirds", "full"]) {
        for (const width of [2559, 2560, 2561]) {
            const l = layout([mode], { focusedIndex: 0, cameraX: 10000 }, geometry(width));
            const r = projectV2Column(l.columns[0], l.geometry, l.cameraX).visualRect;
            assert.ok(Math.abs(r.x + r.width / 2 - width / 2) <= 0.5);
            assert.ok(l.cameraX >= 0 && l.cameraX <= l.maxCamera);
        }
    }
    for (const index of [0, 4]) {
        const l = layout(["twoThirds", "half", "full", "half", "twoThirds"], { focusedIndex: index });
        const r = projectV2Column(l.columns[index], l.geometry, l.cameraX).visualRect;
        assert.equal(r.x + r.width / 2, 1280);
    }
    const empty = layout([], { cameraX: 100 });
    assert.equal(empty.stripEnd, 0);
    assert.equal(empty.cameraX, 0);
});

test("V2 Full is an ordinary gap-preserving column, not a Wide presentation", () => {
    const l = layout(["full", "half"], { focusedIndex: 0 });
    assert.equal(l.cameraX, 636);
    assert.deepEqual(projectV2Column(l.columns[0], l.geometry, l.cameraX).visualRect,
        { x: 16, y: 16, width: 2528, height: 1408 });
    const next = projectV2Column(l.columns[1], l.geometry, l.cameraX);
    assert.equal(next.visualRect.width, 1256);
    assert.equal(next.visibleRect, null);
});

test("V2 panel WorkingArea, OutputRect and physical scale remain separate", () => {
    const outputRect = rect(2560, 1440, -2560, 100);
    const workingArea = rect(2560, 1390, -2560, 150);
    const g = createScrollLayoutGeometry({ outputRect, workingArea, gap: 16, physicalScale: 1.5 });
    const l = layout(["half", "half"], { focusedIndex: 1 }, g);
    const r = projectV2Column(l.columns[0], g, l.cameraX).visualRect;
    assert.deepEqual(r, { x: -2544, y: 166, width: 1256, height: 1358 });
    assert.deepEqual(v2DeviceRect(r, g), { x: 24, y: 99, width: 1884, height: 2037 });
    assert.deepEqual(outputRect, rect(2560, 1440, -2560, 100));
    assert.deepEqual(workingArea, rect(2560, 1390, -2560, 150));
    const inset = createScrollLayoutGeometry({ outputRect: rect(), workingArea: rect(2400, 1440, 80),
        gap: 16, physicalScale: 1 });
    const strip = layout(["twoThirds", "half"], { focusedIndex: 0 }, inset);
    const partial = projectV2Column(strip.columns[1], inset, strip.cameraX);
    assert.equal(partial.visibleRect.x + partial.visibleRect.width, 2560,
        "horizontal partial clip uses physical output, not WorkingArea or SafeArea");
});

test("V2 matrix covers mixed widths, odd sizes, gap 0/16 and 100/125/150/175/200% rounding", () => {
    const sets = [["half", "half"], ["twoThirds", "half"], ["half", "twoThirds"],
        ["full", "half"], ["half", "twoThirds", "full", "half", "twoThirds"]];
    for (const modes of sets) for (const width of [2559, 2560, 2561]) {
        for (const gap of [0, 16]) for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
            const g = geometry(width, gap, scale);
            for (let index = 0; index < modes.length; index++) {
                const l = layout(modes, { focusedIndex: index }, g);
                l.columns.forEach((c, i) => {
                    assert.equal(c.widthMode, modes[i]);
                    if (i) assert.equal(c.logicalX, l.columns[i - 1].logicalX + l.columns[i - 1].pixelWidth + gap);
                    const r = projectV2Column(c, g, l.cameraX).visualRect;
                    const d = v2DeviceRect(r, g);
                    assert.ok(Math.abs(d.x - r.x * scale) <= 0.5);
                    assert.ok(Math.abs(d.x + d.width - (r.x + r.width) * scale) <= 0.5);
                    assert.ok(Math.abs(d.width - r.width * scale) <= 1);
                    assert.ok(Math.abs(d.height - r.height * scale) <= 1);
                    assert.equal(c.pixelWidth, computeV2ColumnWidth(modes[i], width, gap));
                    if (modes.length === 1 || (i === index && modes[i] === "twoThirds")) {
                        assert.ok(Math.abs(d.x + d.width / 2 - width * scale / 2) <= 1);
                    }
                });
            }
        }
    }
});

test("V2 excessive gaps and tiny outputs remain finite and diagnosable", () => {
    for (const width of [1, 2, 3, 9, 80]) for (const height of [1, 2, 5, 40]) {
        const g = geometry(width, 1000, 1, height);
        assert.ok(g.diagnostics.includes("gap-clamped"));
        const l = layout(["half", "twoThirds", "full"], { focusedIndex: 1, cameraX: NaN }, g);
        assert.ok(Number.isFinite(l.cameraX) && l.cameraX >= 0);
        for (const c of l.columns) {
            const r = projectV2Column(c, g, l.cameraX).visualRect;
            assert.ok(c.pixelWidth >= 1 && c.pixelWidth <= width);
            assert.ok(r.height >= 1 && r.height <= height);
        }
    }
    for (const gap of [-20, NaN, Infinity]) {
        assert.ok(geometry(2560, gap).diagnostics.includes("gap-clamped"));
        assert.ok(Number.isFinite(layout(["half"], { focusedIndex: 0 }, geometry(2560, gap)).cameraX));
    }
    assert.equal(fittedCamera(9999, { logicalX: 100, pixelWidth: 3000 }, 2560, 16, 2000), 84);
    assert.equal(clampV2Camera(NaN, NaN), 0);
    for (const width of [0, -1, NaN, Infinity]) assert.throws(() => geometry(width), RangeError);
    assert.throws(() => computeV2ColumnWidth("half", Infinity, 16), RangeError);
    assert.throws(() => layout(["full", "full"], {}, geometry(Number.MAX_SAFE_INTEGER, 0)), RangeError);
});

test("V2 missing/invalid WorkArea falls back conservatively instead of covering panels", () => {
    const config = loadRuntimeConfig((key, fallback) => key === "ScrollLayoutV2Enabled" ? true : fallback);
    const primary = { name: "DP-1", geometry: rect(), devicePixelRatio: 1.5 };
    const secondary = { name: "HDMI-A-1", geometry: rect(2560, 1440, 2560), devicePixelRatio: 1 };
    const desktop = { id: "private" };
    const calls = [];
    const topology = new OutputTopology({ getScreens: () => [secondary, primary], config, computeSafeRect,
        warn: () => {}, getWorkingArea: (o, d) => { calls.push([o, d]); return rect(2560, 1390, 0, 50); } });
    const g = topology.v2Geometry(primary, desktop);
    assert.deepEqual(calls, [[primary, desktop]]);
    assert.deepEqual(g.workingArea, rect(2560, 1390, 0, 50));
    assert.equal(g.physicalScale, 1.5);
    assert.equal(topology.v2Geometry(secondary, desktop), null);
    assert.deepEqual(topology.safeRect(secondary), { x: 2584, y: 24, width: 2512, height: 1392 });
    topology.getWorkingArea = () => { throw new Error("API unavailable"); };
    const fallback = topology.v2Geometry(primary, desktop);
    assert.deepEqual(fallback.workingArea, topology.safeRect(primary));
    assert.ok(fallback.diagnostics.includes("working-area-fallback"));
    topology.getWorkingArea = () => rect(10, 10, 9000);
    assert.deepEqual(topology.v2Geometry(primary, desktop).workingArea, topology.safeRect(primary));
    topology.getWorkingArea = () => rect(2600, 1440, -20);
    assert.ok(topology.v2Geometry(primary, desktop).diagnostics.includes("working-area-clipped-to-output"));
    config.scrollLayoutV2Enabled = false;
    assert.equal(topology.v2Geometry(primary, desktop), null);
});

test("V2 reserves measured visible overlay panels even when KWin WorkArea has no strut", () => {
    const config = loadRuntimeConfig((key, fallback) => key === "ScrollLayoutV2Enabled" ? true : fallback);
    const output = { name: "DP-1", geometry: rect(), devicePixelRatio: 1.5 };
    const desktop = { id: "A" };
    const panel = { dock: true, hidden: false, output, frameGeometry: rect(2560, 51), onAllDesktops: true };
    const hiddenDock = { ...panel, hidden: true, frameGeometry: rect(2560, 66, 0, 1374) };
    const otherDesktop = { ...panel, onAllDesktops: false, desktops: [{ id: "B" }], frameGeometry: rect(2560, 60) };
    const otherOutput = { ...panel, output: { name: "other" }, frameGeometry: rect(2560, 80) };
    const popup = { ...panel, dock: false, frameGeometry: rect(2560, 90) };
    const topology = new OutputTopology({ getScreens: () => [output], config, computeSafeRect,
        getWindows: () => [panel, hiddenDock, otherDesktop, otherOutput, popup],
        getWorkingArea: () => output.geometry, warn: () => {} });
    const g = topology.v2Geometry(output, desktop);
    assert.deepEqual(g.workingArea, rect(2560, 1388, 0, 52));
    assert.ok(g.diagnostics.includes("working-area-client-grid"));
    assert.ok(g.diagnostics.includes("visible-edge-panel-reserved"));
    const full = deriveV2Layout([{ widthMode: "full" }], g, { focusedIndex: 0 });
    assert.deepEqual(projectV2Column(full.columns[0], g, full.cameraX).visualRect,
        { x: 16, y: 68, width: 2528, height: 1356 });
    topology.getWorkingArea = () => rect(2560, 1389, 0, 51);
    assert.deepEqual(topology.v2Geometry(output, desktop).workingArea, g.workingArea, "no double reservation");
    panel.hidden = true; topology.getWorkingArea = () => output.geometry;
    assert.deepEqual(topology.v2Geometry(output, desktop).workingArea, output.geometry);
    panel.hidden = false; panel.frameGeometry = rect(389, 66, 1085, 1374);
    assert.deepEqual(topology.v2Geometry(output, desktop).workingArea, output.geometry, "short revealed dock is not an edge bar");
    panel.frameGeometry = rect(40, 1440);
    assert.deepEqual(topology.v2Geometry(output, desktop).workingArea, rect(2520, 1440, 40));
});


test("fractional vertical client grid is stable across normalization and odd custom gaps", () => {
    for (const physicalScale of [1, 1.25, 1.5, 1.75, 2]) for (const gap of [0, 1, 15, 16]) {
        const g = createScrollLayoutGeometry({ outputRect: rect(), workingArea: rect(2560, 1389, 0, 51), gap, physicalScale });
        const l = deriveV2Layout([{ widthMode: "full" }], g, { focusedIndex: 0 });
        const r = projectV2Column(l.columns[0], g, l.cameraX).visualRect;
        assert.ok(Math.abs(r.height * physicalScale - Math.round(r.height * physicalScale)) < 0.000001);
        assert.deepEqual(createScrollLayoutGeometry(g).workingArea, g.workingArea);
        assert.ok(r.y >= 51 + gap && r.y + r.height <= 1440 - gap);
    }
});


test("independent top gap changes only vertical start/height, preserving widths, camera and bottom", () => {
    const options = { outputRect: rect(), workingArea: rect(2560,1389,0,51), gap:16, physicalScale:1.5 };
    const oldG = createScrollLayoutGeometry(options), nextG = createScrollLayoutGeometry({...options,topGap:8});
    const modes = [{widthMode:"half"},{widthMode:"twoThirds"},{widthMode:"full"}];
    const oldL = deriveV2Layout(modes,oldG,{focusedIndex:1}), nextL = deriveV2Layout(modes,nextG,{focusedIndex:1});
    assert.equal(oldL.cameraX,nextL.cameraX); assert.deepEqual(oldL.columns,nextL.columns);
    for(let i=0;i<modes.length;i++) {
        const a=projectV2Column(oldL.columns[i],oldG,oldL.cameraX).visualRect;
        const b=projectV2Column(nextL.columns[i],nextG,nextL.cameraX).visualRect;
        assert.equal(a.x,b.x);assert.equal(a.width,b.width);assert.equal(a.y+a.height,b.y+b.height);
        assert.equal(a.y-b.y,8);assert.equal(b.y,60);assert.equal(b.height,1364);
    }
    assert.deepEqual(createScrollLayoutGeometry(nextG).workingArea,nextG.workingArea);
});
