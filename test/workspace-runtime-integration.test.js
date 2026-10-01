"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function signal() {
    const handlers = new Set();
    return { connect: fn => handlers.add(fn), disconnect: fn => handlers.delete(fn),
        emit: (...values) => Array.from(handlers).forEach(fn => fn(...values)) };
}
const desktops = [{ id: "A" }, { id: "B" }, { id: "C" }];
const output = { name: "eDP-1", geometry: { x: 0, y: 0, width: 2560, height: 1440 }, geometryChanged: signal() };
let current = desktops[0];
let activeWindow;
let windows = [];
let geometryWrites = 0;
const logs = [];
const published = [];
const deferred = [];
const motionAcks = [];
let pendingCommand = "";
const timers = [];
class Timer {
    constructor() { this.timeout = signal(); timers.push(this); }
    start() { this.running = true; }
    stop() { this.running = false; }
}
function windowFor(uuid, desktop) {
    const window = { internalId: uuid, caption: uuid, desktops: [desktop], onAllDesktops: false,
        output, managed: true, normalWindow: true, moveable: true, resizeable: true, maximizable: true,
        active: false, fullScreen: false, maximizeMode: 0, tile: null, opacity: 1, minimized: false };
    for (const name of ["frameGeometryChanged", "tileChanged", "quickTileModeChanged", "maximizedAboutToChange",
        "maximizedChanged", "outputChanged", "desktopsChanged", "fullScreenChanged", "activeChanged",
        "readyForPaintingChanged", "windowShown", "interactiveMoveResizeStarted", "interactiveMoveResizeFinished",
        "closed", "skipTaskbarChanged", "transientChanged", "modalChanged"]) window[name] = signal();
    let geometry = { x: 100, y: 100, width: 800, height: 600 };
    Object.defineProperty(window, "frameGeometry", { get: () => geometry, set: value => {
        const previous = geometry; geometry = value; geometryWrites += 1;
        window.frameGeometryChanged.emit(previous);
    } });
    window.setMaximize = (horizontal, vertical) => { window.maximizeMode = horizontal && vertical ? 3 : 0; window.maximizedChanged.emit(); };
    return window;
}
const a = Array.from({ length: 5 }, (_, index) => windowFor(`a${index}`, desktops[0]));
const b = [windowFor("b0", desktops[1]), windowFor("b1", desktops[1])];
windows = [...a, ...b];
activeWindow = a[0]; a[0].active = true;
const workspace = { desktops, screens: [output], currentDesktopForScreen: () => current,
    get currentDesktop() { return current; }, windowList: () => windows,
    windowAdded: signal(), windowActivated: signal(), currentDesktopChanged: signal(), desktopsChanged: signal(),
    screensChanged: signal(), screenOrderChanged: signal(), virtualScreenGeometryChanged: signal(),
    virtualScreenGeometry: output.geometry };
Object.defineProperty(workspace, "activeWindow", { get: () => activeWindow, set: window => {
    if (activeWindow === window) return;
    if (activeWindow) { activeWindow.active = false; activeWindow.activeChanged.emit(); }
    activeWindow = window;
    if (window) { window.active = true; window.activeChanged.emit(); }
    workspace.windowActivated.emit(window);
} });
const context = vm.createContext({ workspace, QTimer: Timer,
    readConfig: (key, fallback) => key === "DebugLogging" ? true : fallback,
    registerShortcut: () => {}, console: { info: message => logs.push(message), warn: message => logs.push(message) },
    callDBus: (_service, _path, _interface, method, ...args) => {
        const callback = args.at(-1);
        if (method === "GetState") callback("");
        else if (method === "PublishState") { published.push(JSON.parse(args[0])); callback(true); }
        else if (method === "PublishMotionPlan") motionAcks.push(callback);
        else if (method === "RequestDeferredCommand") { deferred.push(JSON.parse(args[0])); callback(true); }
        else if (method === "TakePendingCommand") { const command = pendingCommand; pendingCommand = ""; callback(command); }
        else if (typeof callback === "function") callback(true);
    },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../package/contents/code/main.js"), "utf8"), context);
const evaluate = code => vm.runInContext(code, context);
const state = evaluate("mainScreenState");
const ids = () => Array.from(state.columns, column => column.window.internalId);
function nativeSwitch(index, active) {
    const batches = logs.filter(line => /BEGIN epoch=.*reason=workspace-mount/.test(line)).length;
    const previous = current; current = desktops[index];
    // Exercise the problematic native signal order: activation precedes desktop signal.
    workspace.activeWindow = active;
    workspace.currentDesktopChanged.emit(previous, current, output);
    assert.equal(logs.filter(line => /BEGIN epoch=.*reason=workspace-mount/.test(line)).length, batches + 1,
        "native desktop changes issue one relayout, including empty workspaces");
}
assert.deepEqual(ids(), ["a0", "a1", "a2", "a3", "a4"]);
assert.equal(published.length, 1, "initial Dock state published once after lifecycle initialization");
assert.equal(published[0].workspaceId, "A");
assert.equal(published[0].workspaceIndex, 0);
assert.equal(evaluate("invariantChecker.errors().length"), 0);
evaluate("columnStore.reorder([mainScreenState.columns[1], mainScreenState.columns[0], ...mainScreenState.columns.slice(2)]); recomputeLogicalLayout()");
evaluate("beginDockScroll(mainScreenState.columns[4], 'test-dock')");
assert.equal(evaluate("dockScrollController.hasPending()"), true);
assert.ok(deferred.length > 0);
const savedOffset = state.scrollOffsetX;
const before = published.at(-1).generation;
nativeSwitch(1, b[0]);
assert.deepEqual(ids(), ["b0", "b1"]);
assert.equal(evaluate("dockScrollController.hasPending()"), false);
assert.equal(published.at(-1).generation, before + 1);
assert.equal(published.at(-1).workspaceId, "B");
assert.equal(evaluate("invariantChecker.errors().length"), 0);
pendingCommand = JSON.stringify(deferred.at(-1));
const beforeStale = geometryWrites;
evaluate("applyPendingDockCommand()");
assert.equal(geometryWrites, beforeStale, "stale Dock command cannot commit old geometry in the new workspace");
assert.deepEqual(ids(), ["b0", "b1"]);
nativeSwitch(0, a[0]);
assert.deepEqual(ids(), ["a1", "a0", "a2", "a3", "a4"]);
// KDE focus has priority and may reveal a different Column from the saved Dock scroll.
assert.ok(savedOffset >= 0);
evaluate("toggleFocusWide(workspace.activeWindow)");
assert.equal(state.viewport.mode, "wide-focus");
assert.ok(motionAcks.length > 0, "the fake Bridge holds an actual pending Wide geometry ACK");
nativeSwitch(1, b[1]);
assert.equal(state.viewport.mode, "pair");
assert.equal(evaluate("motionPlanCommitGate.pending"), null);
assert.equal(evaluate("contextualWideCoordinator.pendingPark"), null);
assert.equal(evaluate("contextualWideCoordinator.pendingExit"), null);
const writesAfterSwitch = geometryWrites;
motionAcks.forEach(callback => callback(true));
timers.filter(timer => timer.running).forEach(timer => timer.timeout.emit());
assert.equal(geometryWrites, writesAfterSwitch, "old Wide ACK and timer cannot commit after mount");
nativeSwitch(0, a[0]);
assert.equal(state.viewport.mode, "pair");
assert.equal(state.presentation.mode, "normal");
assert.equal(state.columns.find(column => column.window === a[0]).persistentWide, true);
assert.equal(evaluate("invariantChecker.errors().length"), 0);
nativeSwitch(1, b[0]);
// Closing an inactive window is removed from sleeping snapshots.
assert.equal(a[3].opacity, 0);
a[3].desktops = []; a[3].onAllDesktops = true; a[3].desktopsChanged.emit();
assert.equal(a[3].opacity, 1); assert.equal(a[3].minimized, false);
assert.ok(a[3].frameGeometry.x >= 0, "sleeping Sticky conversion immediately restores reachable geometry");
a[3].desktops = [desktops[0]]; a[3].onAllDesktops = false; a[3].desktopsChanged.emit();
windows = windows.filter(window => window !== a[4]); a[4].closed.emit();
assert.equal(evaluate("workspaceSnapshots.workspaceForWindow('a4')"), null);
const late = windowFor("late", desktops[0]); windows.push(late); workspace.windowAdded.emit(late);
assert.deepEqual(ids(), ["b0", "b1"], "new inactive window cannot contaminate the current graph");
nativeSwitch(0, a[0]);
assert.deepEqual(ids(), ["a1", "a0", "a2", "a3", "late"]);
assert.equal(evaluate("invariantChecker.errors().length"), 0);
evaluate("setPresentationMode(normalizeWindowUuid(workspace.activeWindow.internalId), PRESENTATION_MAXIMIZED, 'test-maximized')");
nativeSwitch(1, b[0]);
nativeSwitch(0, a[0]);
assert.equal(state.presentation.mode, "normal");
assert.equal(evaluate("stateFor(workspace.activeWindow).layoutMode"), "normal");
nativeSwitch(2, null);
assert.deepEqual(ids(), []); assert.equal(published.at(-1).columns.length, 0);
assert.equal(state.focusedColumnIndex, -1);
assert.equal(evaluate("invariantChecker.errors().length"), 0);
evaluate("emergencyRestoreAllWindows('test-end')");
for (const window of windows) {
    assert.equal(window.opacity, 1, `${window.internalId} recovered opacity`);
    assert.equal(window.minimized, false, `${window.internalId} recovered minimized`);
}
assert.equal(state.enabled, false);
assert.equal(logs.some(line => /INVARIANT_FAIL|mount failed|FAIL_SAFE/.test(line)), false, logs.join("\n"));
console.log("PASS generated runtime mounts native desktop sessions and cancels real stale Dock/Wide callbacks");
