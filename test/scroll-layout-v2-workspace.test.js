"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRuntime } = require("./helpers/workspace-runtime");
function fixture(extra = {}) { const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true,
    PrimaryWindowCount: 3, ...extra }); r.paintV2(); return r; }
const key = (r, name) => r.shortcuts.get(`CCScroll${name}`)();
const check = r => { assert.equal(r.state.enabled, true, r.logs.slice(-10).join("\n"));
    assert.deepEqual(Array.from(r.evaluate("invariantChecker.errors()")), []); };
function desktop(r, index, window) {
    // KWin remains the desktop authority; activation may precede its signal.
    r.evaluate(`workspaceSwitchController.requestDesktop(workspace.desktops[${index}], mainScreenState.targetOutput)`);
}
test("generated entry routes R/F, H/L, reorder and center through P4 typed ACKs", () => {
    const r = fixture();
    key(r, "CycleColumnWidth"); assert.equal(r.state.columns[0].widthMode, "twoThirds"); r.paintV2();
    key(r, "ToggleColumnFull"); assert.equal(r.state.columns[0].widthMode, "full"); r.paintV2();
    key(r, "ToggleColumnFull"); assert.equal(r.state.columns[0].widthMode, "twoThirds"); r.paintV2();
    key(r, "FocusNextColumn"); assert.equal(r.state.focusedColumnIndex, 1);
    assert.equal(r.workspace.activeWindow, r.a[0], "activation waits for actual paint proof");
    r.paintV2(); assert.equal(r.workspace.activeWindow, r.a[1]);
    key(r, "MoveColumnRight"); r.paintV2(); assert.deepEqual(r.ids(), ["a0", "a2", "a1"]);
    const modes = r.state.columns.map(c => c.widthMode);
    r.evaluate("toggleFocusWide(workspace.activeWindow)"); r.paintV2();
    assert.deepEqual(r.state.columns.map(c => c.widthMode), modes);
    assert.ok(r.motionPlans.every(p => ["PARTIAL_SCROLL", "COLUMN_GEOMETRY"].includes(p.type)));
    assert.ok(r.nativeArms.some(p => p.type === "COLUMN_GEOMETRY")); check(r);
});
test("Win+Shift+H fits the half column swapped left of a centered 2/3 column", () => {
    const r = fixture({ PrimaryWindowCount: 2 });
    key(r, "CycleColumnWidth"); r.paintV2();
    assert.equal(r.a[0].frameGeometry.x, 440);
    key(r, "FocusNextColumn"); r.paintV2();
    key(r, "MoveColumnLeft"); r.paintV2();
    assert.deepEqual(r.ids(), ["a1", "a0"]);
    assert.equal(r.workspace.activeWindow, r.a[1]);
    assert.equal(r.a[1].frameGeometry.x, 16);
    assert.equal(r.a[1].frameGeometry.width, 1256);
    const plan = r.nativeArms.at(-1);
    assert.equal(plan.type, "COLUMN_GEOMETRY");
    assert.equal(plan.layoutRect.x + plan.entries.find(e => e.windowId === "a0").newLogicalX - plan.newScrollOffsetX, 1288);
    check(r);
});
test("fullscreen releases Native before static writes and restores exact 2/3 preference", () => {
    const r = fixture(); key(r, "CycleColumnWidth"); r.paintV2();
    const before = r.state.columns[0].widthMode;
    r.a[0].fullScreen = true; r.a[0].fullScreenChanged.emit();
    assert.ok(r.nativeCancels.length > 0); assert.equal(r.a[0].opacity, 1);
    const arms = r.nativeArms.length; key(r, "CycleColumnWidth"); key(r, "FocusNextColumn");
    assert.equal(r.nativeArms.length, arms);
    r.a[0].fullScreen = false; r.a[0].fullScreenChanged.emit(); r.paintV2();
    assert.equal(r.state.columns[0].widthMode, before); assert.equal(r.a[0].frameGeometry.width, 1680); check(r);
});
test("legacy maximize and restore preserve full's previous 2/3 width without native fullscreen", () => {
    const r = fixture(); key(r, "CycleColumnWidth"); r.paintV2(); key(r, "ToggleColumnFull"); r.paintV2();
    r.evaluate('setPresentationMode("a0", "maximized", "test-maximize")');
    assert.equal(r.state.presentation.mode, "maximized"); assert.equal(r.a[0].frameGeometry.width, 2512);
    assert.equal(r.a[0].fullScreen, false); assert.equal(r.a[0].maximizeMode, 0);
    r.evaluate('setPresentationMode("a0", "normal", "test-restore")'); r.paintV2();
    assert.equal(r.state.columns[0].widthMode, "full"); key(r, "ToggleColumnFull"); r.paintV2();
    assert.equal(r.state.columns[0].widthMode, "twoThirds"); check(r);
});
test("workspace mounts and empty workspaces preserve mixed widths and signed focus view", () => {
    const r = fixture(); key(r, "CycleColumnWidth"); r.paintV2();
    const saved = r.evaluate('workspaceMountController.capture()'); assert.ok(saved.viewportAnchorV2.delta < 0);
    // Use the native-current mock backing the existing runtime helper.
    r.nativeSwitch(1, r.b[0]); r.paintV2(); assert.deepEqual(r.ids(), ["b0", "b1"]);
    r.nativeSwitch(0, r.a[0]); r.paintV2(); assert.equal(r.state.columns[0].widthMode, "twoThirds");
    assert.equal(r.state.scrollOffsetX, 212); check(r);
    r.nativeSwitch(2, null); assert.deepEqual(r.ids(), []); assert.equal(r.state.scrollOffsetX, 0); check(r);
    r.nativeSwitch(0, r.a[0]); r.paintV2(); check(r);
});
test("membership transfer carries V2 width to the sleeping workspace and closes clear references", () => {
    const r = fixture(); key(r, "CycleColumnWidth"); r.paintV2();
    r.move(r.a[0], ["B"]);
    const snapshot = r.evaluate('workspaceSnapshots.get("B")');
    assert.equal(snapshot.columns.find(c => c.uuid === "a0").widthV2.widthMode, "twoThirds");
    assert.ok(!r.ids().includes("a0"));
    r.nativeSwitch(1, r.a[0]); r.paintV2();
    assert.equal(r.state.columns.find(c => c.window === r.a[0]).widthMode, "twoThirds"); check(r);
    r.close(r.a[0]);
    assert.equal(r.evaluate('workspaceSnapshots.workspaceForWindow("a0")'), null);
    assert.equal(r.evaluate('states.has(workspace.windowList().find(w => w.internalId === "a0"))'), false);
    r.paintV2(); check(r);
});
test("new clients enter hidden ownership; dialogs and transients never enter the strip", () => {
    const r = fixture();
    const dialog = r.add("dialog", 0, { normalWindow: false, dialog: true });
    const transient = r.add("transient", 0, { transient: true });
    r.workspace.activeWindow = dialog; r.workspace.activeWindow = transient;
    assert.deepEqual(r.ids(), ["a0", "a1", "a2"]);
    const c = r.add("incoming", 0); r.workspace.activeWindow = c;
    assert.ok(r.ids().includes("incoming"));
    r.paintV2(); assert.equal(c.opacity, 1); assert.equal(c.minimized, false); check(r);
});
test("floating round trip and secondary departure never leave Native ownership over recovery geometry", () => {
    const r = fixture(); key(r, "CycleColumnWidth"); r.paintV2();
    r.evaluate("toggleFloating(workspace.activeWindow)");
    assert.ok(!r.ids().includes("a0")); assert.equal(r.a[0].opacity, 1); assert.equal(r.a[0].minimized, false);
    r.evaluate("toggleFloating(workspace.activeWindow)"); r.paintV2();
    assert.ok(r.ids().includes("a0"));
    assert.equal(r.state.columns.find(c => c.window === r.a[0]).widthMode, "twoThirds"); check(r);
    const frame = { ...r.a[0].frameGeometry };
    r.a[0].output = { name: "DP-2", geometry: { x: 2560, y: 0, width: 1920, height: 1080 } };
    r.a[0].outputChanged.emit(); assert.ok(!r.ids().includes("a0"));
    assert.equal(r.a[0].opacity, 1); assert.deepEqual({ ...r.a[0].frameGeometry }, frame); check(r);
});
test("delayed cancellation cannot write recovery geometry or reactivate a retired target", () => {
    const r = fixture({ HoldV2Status: false });
    // Hold the status proof after bootstrap; the same pending callback models DBus delay.
    const driver = r.evaluate("continuousLayout.coordinator");
    const original = driver.bridge.scrollMotionStatus;
    let reply;
    driver.bridge.scrollMotionStatus = callback => { reply = callback; };
    const writes = r.writes();
    r.evaluate("toggleFloating(workspace.activeWindow)");
    assert.equal(r.writes(), writes); assert.equal(r.state.columns.length, 3);
    assert.equal(r.evaluate("continuousLayout.blocked"), true);
    reply(JSON.stringify({ active: false, clipHandoffActive: false, sessionId: driver.bridge.sessionId(), epoch: 1 }));
    assert.ok(!r.ids().includes("a0")); driver.bridge.scrollMotionStatus = original;
});
test("emergency restore waits for confirmed Native retirement and releases all parking references", () => {
    const r = fixture();
    r.evaluate('emergencyRestoreAllWindows("p5-test")');
    assert.equal(r.state.enabled, false);
    for (const w of r.a) { assert.equal(w.opacity, 1); assert.equal(w.minimized, false); }
    assert.equal(r.evaluate("continuousLayout.coordinator.intent"), null);
    assert.equal(r.evaluate("continuousLayout.coordinator.listener"), null);
    assert.equal(r.evaluate("continuousLayout.actions.size"), 0);
    assert.ok(!r.evaluate('Object.prototype.hasOwnProperty.call(runtimeBridge.handlers, "scroll-frame-ready")'));
});
test("closed clients release lifecycle connections and stop disconnects live window/output hooks", () => {
    const r = fixture();
    const count = r.evaluate("app.lifecycle.connections.length");
    for (let i = 0; i < 20; i++) r.workspace.screensChanged.emit();
    assert.equal(r.evaluate("app.lifecycle.connections.length"), count, "output signals cannot grow with historical topology events");
    r.close(r.a[2]);
    assert.ok(r.evaluate("app.lifecycle.connections.length") < count);
    assert.equal(r.evaluate('app.lifecycle.connections.some(c => c.owner && c.owner.internalId === "a2")'), false);
    r.evaluate("app.stop()");
    assert.equal(r.evaluate("app.lifecycle.connections.length"), 0);
});
test("transparent configure preparation preserves user minimization on recovery", () => {
    const { ParkingManager } = require("../src/kwin/stability/ParkingManager");
    const states = new Map(), window = { minimized: true, opacity: 0.7, caption: "user-minimized" };
    const stateFor = w => { if (!states.has(w)) states.set(w, { scrollOriginalOpacity: null }); return states.get(w); };
    const parking = new ParkingManager({ stateFor, getState: w => states.get(w), debug: () => {} });
    parking.prepareGeometry(window);
    assert.equal(window.opacity, 0); assert.equal(window.minimized, false);
    parking.setVisibility(window, true); // A visible neighbor has not been explicitly focused.
    parking.release(window, "test-restore");
    assert.equal(window.opacity, 0.7); assert.equal(window.minimized, true);
    assert.equal(parking.owns(window), false);
});
test("numbered move-and-follow retains Full's 2/3 memory in source and destination snapshots", () => {
    const r = fixture(); key(r, "CycleColumnWidth"); r.paintV2(); key(r, "ToggleColumnFull"); r.paintV2();
    r.workspace.setCurrentDesktopForScreen = desktop => r.nativeSwitch(r.desktops.indexOf(desktop),
        r.workspace.windowList().find(w => w.desktops[0] === desktop));
    assert.equal(key(r, "MoveColumnWorkspace3"), true); r.paintV2();
    assert.deepEqual(r.ids(), ["a0"]); assert.equal(r.state.activeWorkspaceId, "C");
    assert.equal(r.state.columns[0].widthMode, "full");
    assert.equal(r.state.columns[0].previousNonFullWidthMode, "twoThirds");
    assert.equal(r.published.at(-1).workspaces.find(w => w.id === "C").columns[0].widthV2.previousNonFullWidthMode, "twoThirds");
    key(r, "ToggleColumnFull"); r.paintV2(); assert.equal(r.state.columns[0].widthMode, "twoThirds"); check(r);
});
test("V2 automatic recycling removes only empty inactive snapshots and retains live width metadata", () => {
    const r = fixture({ DynamicTrailingWorkspace: true, AutoRecycleWorkspaces: true });
    key(r, "CycleColumnWidth"); r.paintV2();
    r.move(r.b[0], ["A"]); r.move(r.b[1], ["A"]); r.paintV2();
    for (let pass = 0; pass < 20; pass++) {
        const timers = r.timers.filter(t => t.running); if (!timers.length) break;
        timers.forEach(t => { t.running = false; t.timeout.emit(); });
    }
    assert.deepEqual(r.desktopRemoves, ["B"]);
    assert.equal(r.evaluate('workspaceSnapshots.has("B")'), false);
    assert.equal(r.state.columns[0].widthMode, "twoThirds");
    assert.equal(r.published.at(-1).workspaces.find(w => w.id === "A").columns[0].widthV2.widthMode, "twoThirds"); check(r);
});

test("full entry reflows on overlay panel add, resize, hide and close without reserving hidden docks", () => {
    const r = fixture({ PrimaryWindowCount: 1 });
    r.workspace.clientArea = () => r.output.geometry;
    const panel = r.add("panel", 0, { dock: true, normalWindow: false, hidden: false, onAllDesktops: true });
    panel.frameGeometry = { x: 0, y: 0, width: 2560, height: 51 }; r.paintV2();
    assert.equal(r.a[0].frameGeometry.y, 67); assert.equal(r.a[0].frameGeometry.height, 1357);
    panel.frameGeometry = { x: 0, y: 0, width: 2560, height: 60 }; r.paintV2();
    assert.equal(r.a[0].frameGeometry.y, 76);
    panel.hidden = true; panel.frameGeometryChanged.emit(); r.paintV2();
    assert.equal(r.a[0].frameGeometry.y, 16);
    panel.hidden = false; panel.frameGeometryChanged.emit(); r.paintV2();
    assert.equal(r.a[0].frameGeometry.y, 76);
    r.close(panel); r.paintV2(); assert.equal(r.a[0].frameGeometry.y, 16);
    check(r);
});


test("150% client buffer rounding cannot stall bootstrap below an odd-height overlay panel", () => {
    const r = fixture({ PrimaryWindowCount: 1, OutputScale: 1.5, ClientBufferScale: 1.5 });
    r.workspace.clientArea = () => r.output.geometry;
    const panel = r.add("panel", 0, { dock: true, normalWindow: false, hidden: false, onAllDesktops: true });
    panel.frameGeometry = { x: 0, y: 0, width: 2560, height: 51 }; r.paintV2();
    assert.equal(r.a[0].frameGeometry.y, 68);
    assert.equal(r.a[0].frameGeometry.height, 1356);
    assert.equal(r.evaluate("continuousLayout.coordinator.bootstrap"), null);
    assert.equal(r.evaluate("continuousLayout.stopped"), false); check(r);
});


test("top-only override uses exact client ACKs while retaining 16px widths and bottom gap", () => {
    const r=fixture({PrimaryWindowCount:1,OutputScale:1.5,ClientBufferScale:1.5,ScrollLayoutTopGap:8});
    r.workspace.clientArea=()=>r.output.geometry;
    const panel=r.add("panel",0,{dock:true,normalWindow:false,hidden:false,onAllDesktops:true});
    panel.frameGeometry={x:0,y:0,width:2560,height:51};r.paintV2();
    assert.equal(r.a[0].frameGeometry.y,60);assert.equal(r.a[0].frameGeometry.height,1364);
    assert.equal(r.a[0].frameGeometry.width,1256);assert.equal(1440-r.a[0].frameGeometry.y-r.a[0].frameGeometry.height,16);
    key(r,"CycleColumnWidth");r.paintV2();assert.equal(r.a[0].frameGeometry.width,1680);
    key(r,"ToggleColumnFull");r.paintV2();assert.equal(r.a[0].frameGeometry.width,2528);
    assert.equal(r.a[0].frameGeometry.y,60);assert.equal(r.evaluate("continuousLayout.stopped"),false);check(r);
});
