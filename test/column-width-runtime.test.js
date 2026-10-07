"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const { normalizeWorkspaceSnapshot } = require("../src/kwin/workspace/WorkspaceSnapshotStore");
const key = (r, action) => r.shortcuts.get(`CCScroll${action}`)();
const activeColumn = r => r.state.columns.find(c => c.window === r.workspace.activeWindow);
function check(r) {
    assert.equal(r.evaluate("invariantChecker.errors().length"), 0, r.logs.join("\n"));
    assert.equal(r.logs.some(line => /INVARIANT_FAIL|FAIL_SAFE/.test(line)), false, r.logs.join("\n"));
}
function checkWidth(r, mode, memory, pixels) {
    const column = activeColumn(r);
    assert.equal(column.widthMode, mode);
    assert.equal(column.previousNonFullWidthMode, memory);
    assert.equal(column.pixelWidth, pixels);
    assert.equal(column.window.frameGeometry.width, pixels);
    assert.equal(column.window.frameGeometry.height, r.state.safeRect.height);
    assert.equal(column.window.minimized, false);
    assert.ok(column.window.frameGeometry.x >= r.state.safeRect.x);
    assert.ok(column.window.frameGeometry.x + pixels <= r.state.safeRect.x + r.state.safeRect.width);
    const snapshot = r.published.at(-1).workspaces.find(w => w.id === r.state.activeWorkspaceId);
    const entry = snapshot.columns.find(c => c.uuid === column.window.internalId);
    assert.equal(entry.widthMode, mode);
    assert.equal(entry.previousNonFullWidthMode, memory);
    assert.equal(r.state.viewport.mode, "pair");
    assert.equal(r.state.presentation.mode, "normal");
    check(r);
}
{
    const r = createRuntime();
    assert.equal(activeColumn(r).previousNonFullWidthMode, "half");
    const order = r.ids(); const window = r.workspace.activeWindow;
    for (const [mode, memory, pixels] of [["twoThirds", "twoThirds", 1672],
        ["full", "twoThirds", 2512], ["third", "third", 832], ["half", "half", 1252]]) {
        key(r, "CycleColumnWidth");
        checkWidth(r, mode, memory, pixels);
        assert.equal(r.workspace.activeWindow, window);
        assert.deepEqual(r.ids(), order);
    }
    for (const [mode, pixels] of [["half", 1252], ["twoThirds", 1672], ["third", 832]]) {
        while (activeColumn(r).widthMode !== mode) key(r, "CycleColumnWidth");
        key(r, "ToggleColumnFull"); checkWidth(r, "full", mode, 2512);
        key(r, "ToggleColumnFull"); checkWidth(r, mode, mode, pixels);
    }
    r.evaluate("focusRelativeColumn(1); focusRelativeColumn(1); focusRelativeColumn(1); focusRelativeColumn(1)");
    key(r, "ToggleColumnFull"); checkWidth(r, "full", "half", 2512);
    assert.deepEqual({ ...r.workspace.activeWindow.frameGeometry }, { ...r.state.safeRect });
    key(r, "ToggleColumnFull"); checkWidth(r, "half", "half", 1252);
}
{
    const r = createRuntime();
    key(r, "CycleColumnWidth"); key(r, "CycleColumnWidth"); key(r, "CycleColumnWidth");
    key(r, "ToggleColumnFull"); checkWidth(r, "full", "third", 2512);
    r.nativeSwitch(1, r.b[0]); r.nativeSwitch(0, r.a[0]);
    checkWidth(r, "full", "third", 2512);
    const reloaded = createRuntime({ PreviousState: r.published.at(-1) });
    checkWidth(reloaded, "full", "third", 2512);
    key(reloaded, "ToggleColumnFull"); checkWidth(reloaded, "third", "third", 832);
    // Older Full snapshots have no memory; invalid memory cannot select Full again.
    for (const memory of [undefined, null, "full", "bad", 4]) {
        const saved = JSON.parse(JSON.stringify(r.published.at(-1)));
        saved.workspaces.find(w => w.id === "A").columns.find(c => c.uuid === "a0")
            .previousNonFullWidthMode = memory;
        const legacy = createRuntime({ PreviousState: saved });
        key(legacy, "ToggleColumnFull"); checkWidth(legacy, "half", "half", 1252);
    }
}
{
    const r = createRuntime();
    key(r, "CycleColumnWidth"); key(r, "ToggleColumnFull");
    r.move(r.a[0], ["B"]); r.nativeSwitch(1, r.a[0]);
    checkWidth(r, "full", "twoThirds", 2512);
    key(r, "ToggleColumnFull"); checkWidth(r, "twoThirds", "twoThirds", 1672);
    key(r, "ToggleColumnFull");
    r.nativeSwitch(0, r.a[1]);
    r.move(r.a[0], ["A"]);
    r.workspace.activeWindow = r.a[0]; // Active-workspace adoption uses its saved preference.
    checkWidth(r, "full", "twoThirds", 2512);
    key(r, "ToggleColumnFull"); checkWidth(r, "twoThirds", "twoThirds", 1672);
}
for (const config of [{ HoldScrollAck: true }, { HoldNativeAck: true }]) {
    const r = createRuntime(config);
    key(r, "FocusNextColumn"); key(r, "FocusNextColumn");
    assert.ok(r.evaluate("scrollPlanCommitGate.pending"));
    assert.equal(r.workspace.activeWindow, r.a[1], "pending target is not the actual active window yet");
    key(r, "CycleColumnWidth");
    checkWidth(r, "twoThirds", "twoThirds", 1672);
    assert.equal(activeColumn(r).window, r.a[1]);
    const writes = r.writes(); const published = r.published.length;
    r.motionAcks.forEach(callback => callback(true));
    r.nativeAcks.forEach(callback => callback(true));
    assert.equal(r.writes(), writes, "old Scroll ACK cannot overwrite changed widths");
    assert.equal(r.published.length, published);
    check(r);
}
{
    const r = createRuntime();
    key(r, "ToggleFocusWide");
    assert.ok(r.evaluate("motionPlanCommitGate.pending"));
    key(r, "ToggleColumnFull"); checkWidth(r, "full", "half", 2512);
    assert.equal(activeColumn(r).persistentWide, true);
    const writes = r.writes();
    r.motionAcks.forEach(callback => callback(true));
    assert.equal(r.writes(), writes, "old Wide ACK cannot overwrite Full");
    key(r, "ToggleColumnFull"); checkWidth(r, "half", "half", 1252);
    assert.equal(activeColumn(r).persistentWide, true);
    key(r, "ToggleFocusWide");
    assert.equal(r.state.viewport.mode, "wide-focus", "retained Wide preference remains usable");
}
{
    const r = createRuntime();
    const noOp = () => {
        const columns = JSON.stringify(r.state.columns.map(c => [c.widthMode, c.previousNonFullWidthMode]));
        const writes = r.writes(); const published = r.published.length;
        assert.equal(key(r, "CycleColumnWidth"), false);
        assert.equal(key(r, "ToggleColumnFull"), false);
        assert.equal(r.writes(), writes); assert.equal(r.published.length, published);
        assert.equal(JSON.stringify(r.state.columns.map(c => [c.widthMode, c.previousNonFullWidthMode])), columns);
    };
    r.a[0].fullScreen = true; noOp(); r.a[0].fullScreen = false;
    r.state.enabled = false; noOp(); r.state.enabled = true;
    r.state.workspaceSwitching = true; noOp(); r.state.workspaceSwitching = false;
    key(r, "ToggleFloating"); noOp();
    r.b[0].output = { name: "secondary" };
    r.workspace.activeWindow = r.b[0]; noOp();
    r.workspace.activeWindow = null; noOp();
}
for (const widthMode of ["third", "half", "twoThirds", "full", "bad"]) {
    const column = normalizeWorkspaceSnapshot("A", { columns: [{ uuid: "w", widthMode }] }).columns[0];
    assert.equal(column.previousNonFullWidthMode, ["full", "bad"].includes(widthMode) ? "half" : widthMode);
}
{
    const r = createRuntime();
    key(r, "CycleColumnWidth");
    const window = r.workspace.activeWindow;
    r.holdGeometry(window); // Wayland client keeps its old frame until configure ACK.
    key(r, "ToggleColumnFull");
    assert.equal(window.frameGeometry.width, 1672);
    key(r, "ToggleColumnFull");
    assert.equal(activeColumn(r).widthMode, "twoThirds");
    r.flushGeometry(window);
    checkWidth(r, "twoThirds", "twoThirds", 1672);
    const writes = r.writes();
    r.evaluate("relayout('settled-width')");
    assert.equal(r.writes(), writes, "settled geometry still avoids redundant writes");
}
{
    const r = createRuntime();
    r.evaluate("setPresentationMode('a0', PRESENTATION_MAXIMIZED, 'test-maximize')");
    assert.equal(r.state.presentation.mode, "maximized");
    key(r, "CycleColumnWidth"); checkWidth(r, "twoThirds", "twoThirds", 1672);
    assert.equal(r.evaluate("stateFor(workspace.activeWindow).layoutMode"), "normal");
    assert.equal(r.state.prePresentationViewport, null);
    key(r, "ToggleColumnFull");
    r.a[0].fullScreen = true; r.a[0].fullScreenChanged.emit();
    assert.equal(key(r, "ToggleColumnFull"), false);
    r.a[0].fullScreen = false; r.a[0].fullScreenChanged.emit();
    checkWidth(r, "full", "twoThirds", 2512);
    key(r, "ToggleColumnFull"); checkWidth(r, "twoThirds", "twoThirds", 1672);
}
console.log("PASS actual width shortcuts, remembered Full restoration, reload/transfer, pending ACK retirement and no-op boundaries");
