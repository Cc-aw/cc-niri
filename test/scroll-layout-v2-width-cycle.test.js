"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { ColumnStore, normalizeColumnWidthMode, normalizePreviousNonFullWidthMode } = require("../src/kwin/model/ColumnStore");
const { ColumnWidthController } = require("../src/kwin/layout/ColumnWidthController");
const { loadRuntimeConfig } = require("../src/kwin/runtime/RuntimeConfig");
const { createScrollLayoutGeometry, deriveV2Layout, focusV2Camera } = require("../src/kwin/layout/ContinuousColumnLayout");
const { createRuntime } = require("./helpers/workspace-runtime");

function fixture(enabled = true) {
    const output = { name: "private" };
    const state = { enabled: true, workspaceSwitching: false, targetOutput: output,
        columns: [], focusedColumnIndex: -1, nextColumnId: 1, cameraX: 0 };
    const options = { scrollLayoutV2Enabled: enabled };
    const store = new ColumnStore(state, () => {}, options);
    const windows = [0, 1, 2].map(id => ({ id, output, fullScreen: false }));
    windows.forEach(w => store.insertWindow(w, state.columns.length, "half"));
    const g = createScrollLayoutGeometry({ outputRect: { x: 0, y: 0, width: 2560, height: 1440 },
        workingArea: { x: 0, y: 0, width: 2560, height: 1440 }, gap: 16, physicalScale: 1 });
    const trace = [];
    let active = windows[0];
    let l;
    const controller = new ColumnWidthController({ ...options, getAppState: () => state,
        getActiveWindow: () => active,
        captureLayout: column => { trace.push("capture"); return { previous: column.widthMode }; },
        cancelPending: () => trace.push("cancel"), clearPresentation: () => trace.push("clear"),
        focusColumn: column => { trace.push("focus"); store.focusColumn(column); },
        recomputeLogicalLayout: () => {
            trace.push("geometry"); l = deriveV2Layout(state.columns, g);
            state.columns.forEach((c, i) => Object.assign(c, l.columns[i]));
        },
        ensureColumnVisible: column => {
            trace.push("camera"); state.cameraX = focusV2Camera(l, state.columns.indexOf(column), state.cameraX);
        },
        relayout: (_reason, _unused, transition) => { trace.push("layout"); assert.ok(transition.previous); },
        commitState: () => trace.push("commit") });
    return { state, store, controller, windows, trace, setActive: window => { active = window; } };
}

test("V2 strict half -> twoThirds -> full -> half cycle changes only the active column", () => {
    const f = fixture();
    const ids = f.state.columns.map(c => c.id);
    f.state.columns[0].persistentWide = true;
    for (const [mode, memory, width] of [["twoThirds", "twoThirds", 1680], ["full", "twoThirds", 2528],
        ["half", "half", 1256], ["twoThirds", "twoThirds", 1680]]) {
        f.trace.length = 0;
        assert.equal(f.controller.cycle(), true);
        const column = f.store.focusedColumn();
        assert.equal(column.window, f.windows[0]);
        assert.equal(column.widthMode, mode);
        assert.equal(column.previousNonFullWidthMode, memory);
        assert.equal(column.pixelWidth, width);
        assert.equal(column.persistentWide, true, "compatibility preference survives");
        assert.deepEqual(f.state.columns.map(c => c.id), ids);
        assert.deepEqual(f.state.columns.slice(1).map(c => c.widthMode), ["half", "half"]);
        assert.deepEqual(f.trace, ["capture", "cancel", "clear", "focus", "geometry", "camera", "layout", "commit"]);
    }
    f.setActive(f.windows[1]);
    f.controller.cycle();
    assert.deepEqual(f.state.columns.map(c => c.widthMode), ["twoThirds", "twoThirds", "half"]);
});

test("V2 Full toggle remembers half or twoThirds independently for each column", () => {
    const f = fixture();
    f.controller.cycle(); // first column becomes twoThirds
    for (const [i, expected] of [[0, "twoThirds"], [1, "half"], [0, "twoThirds"]]) {
        f.setActive(f.windows[i]);
        assert.equal(f.controller.toggleFull(), true);
        assert.equal(f.state.columns[i].widthMode, "full");
        assert.equal(f.state.columns[i].previousNonFullWidthMode, expected);
        assert.equal(f.controller.toggleFull(), true);
        assert.equal(f.state.columns[i].widthMode, expected);
        assert.equal(f.state.columns[i].previousNonFullWidthMode, expected);
    }
    const c = f.state.columns[0];
    c.widthMode = "full"; c.previousNonFullWidthMode = "full";
    f.controller.toggleFull();
    assert.equal(c.widthMode, "half");
});

test("V2 model normalizes unsupported widths and invalid Full memory without changing V1", () => {
    const state = { columns: [], nextColumnId: 1, focusedColumnIndex: -1 };
    const v2 = new ColumnStore(state, () => {}, { scrollLayoutV2Enabled: true });
    for (const mode of ["half", "twoThirds", "full", "third", "bad", undefined]) {
        const c = v2.insertWindow({}, state.columns.length, mode, "twoThirds");
        assert.equal(c.widthMode, ["twoThirds", "full"].includes(mode) ? mode : "half");
        assert.equal(c.previousNonFullWidthMode, ["twoThirds", "full"].includes(mode) ? "twoThirds" : "half");
        assert.equal(normalizeColumnWidthMode(mode), mode === "full" ? "full" : "half");
        assert.equal(normalizePreviousNonFullWidthMode("twoThirds", mode), "half");
    }
    for (const value of [undefined, null, "full", "third", "bad", 1]) {
        assert.equal(normalizePreviousNonFullWidthMode(value, "full", true), "half");
    }
    const f = fixture(false);
    for (const mode of ["full", "half", "full", "half"]) {
        f.controller.cycle();
        assert.equal(f.state.columns[0].widthMode, mode);
        assert.equal(f.state.columns[0].previousNonFullWidthMode, "half");
    }
});

test("V2 width controller ignores fullscreen/floating/secondary/switching/disabled/null", () => {
    const f = fixture();
    const noOp = () => {
        const before = JSON.stringify(f.state.columns);
        f.trace.length = 0;
        assert.equal(f.controller.cycle(), false);
        assert.equal(f.controller.toggleFull(), false);
        assert.deepEqual(f.trace, []);
        assert.equal(JSON.stringify(f.state.columns), before);
    };
    f.windows[0].fullScreen = true; noOp(); f.windows[0].fullScreen = false;
    f.state.enabled = false; noOp(); f.state.enabled = true;
    f.state.workspaceSwitching = true; noOp(); f.state.workspaceSwitching = false;
    f.setActive({ output: f.state.targetOutput }); noOp();
    f.setActive({ output: {} }); noOp();
    f.setActive(null); noOp();
});

test("V2 config defaults off and validates gap separately from all old gaps", () => {
    const defaults = loadRuntimeConfig((_key, fallback) => fallback);
    assert.equal(defaults.scrollLayoutV2Enabled, false);
    assert.equal(defaults.scrollLayoutGap, 16);
    for (const [value, expected] of [[0, 0], [16, 16], [12.9, 12], [-20, 0], [10000, 1000],
        [Infinity, 16], [NaN, 16], ["bad", 16]]) {
        const config = loadRuntimeConfig((key, fallback) => key === "ScrollLayoutGap" ? value : fallback);
        assert.equal(config.scrollLayoutGap, expected);
        assert.deepEqual(config.primary, defaults.primary);
        assert.deepEqual(config.secondary, defaults.secondary);
    }
    const root = path.join(__dirname, "..");
    const xml = fs.readFileSync(path.join(root, "package/contents/config/main.xml"), "utf8");
    const ui = fs.readFileSync(path.join(root, "package/contents/ui/config.ui"), "utf8");
    assert.match(xml, /name="ScrollLayoutV2Enabled"[\s\S]*?<default>false<\/default>/);
    assert.match(xml, /name="ScrollLayoutGap"[\s\S]*?<default>16<\/default>/);
    assert.match(ui, /name="kcfg_ScrollLayoutV2Enabled"[\s\S]*?<property name="enabled"><bool>false<\/bool>/);
});

test("P5 opt-in production entry fails closed without the explicit Native capabilities", () => {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, ScrollLayoutGap: 16 });
    assert.ok(r.logs.some(line => line.includes("missing-capability")));
    assert.equal(r.state.enabled, false);
    assert.equal(r.writes(), 0);
    assert.equal(r.nativeArms.length, 0);
    assert.ok(r.state.columns.every(c => c.widthMode === "half"));
});
