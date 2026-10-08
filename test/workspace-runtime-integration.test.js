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
const shortcuts = new Map();
const requests = [];
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
    let desktopList = window.desktops;
    Object.defineProperty(window, "desktops", { get: () => Object.assign({ length: desktopList.length }, desktopList),
        set: entries => { desktopList = Array.from(entries); } });
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
    readConfig: (key, fallback) => ["DebugLogging", "EnableDockIntegration"].includes(key) ? true : fallback,
    registerShortcut: (name, _description, _sequence, handler) => shortcuts.set(name, handler), console: { info: message => logs.push(message), warn: message => logs.push(message) },
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
// Exercise the real shortcut wiring with delayed KWin delivery.
workspace.setCurrentDesktopForScreen = (desktop, screen) => {
    assert.equal(screen, output); requests.push(desktop);
};
shortcuts.get("CCScrollWorkspacePrevious")(); assert.equal(requests.length, 0);
shortcuts.get("CCScrollWorkspaceNext")();
assert.equal(requests.at(-1).id, "B");
assert.equal(state.workspaceSwitching, true);
const switchTimer = evaluate("workspaceSwitchController.timer").timer;
const beforeAwait = geometryWrites;
const focusBeforeAwait = state.focusedColumnIndex;
for (const name of ["CCScrollFocusNextColumn", "CCScrollToggleFocusWide", "CCScrollMoveColumnRight", "CCScrollToggleFloating",
    "CCScrollCycleColumnWidth", "CCScrollToggleColumnFull"]) shortcuts.get(name)();
evaluate("dockGateway.dispatch(dockGateway.commandEnvelope({type: 'set-presentation-mode', commandId: 'await-wide', windowUuid: 'a0', mode: PRESENTATION_WIDE}))");
assert.equal(geometryWrites, beforeAwait); assert.equal(state.focusedColumnIndex, focusBeforeAwait);
assert.equal(state.viewport.mode, "pair");
assert.equal(a[0].desktops[0].id, "A");
assert.equal(evaluate("stateFor(workspace.activeWindow).floating"), false);
shortcuts.get("CCScrollWorkspaceNext")(); shortcuts.get("CCScrollWorkspacePrevious")();
assert.equal(requests.length, 1, "repeated J/K ignored while waiting");
const duringSwitch = windowFor("during-switch", desktops[1]);
windows.push(duringSwitch); workspace.windowAdded.emit(duringSwitch);
assert.equal(evaluate("stateFor(workspace.windowList().find(w => w.internalId === 'during-switch')).managedByScrollLayout"), false);
const preSwitchGeneration = published.at(-1).generation;
nativeSwitch(1, b[0]);
assert.deepEqual(ids(), ["b0", "b1", "during-switch"]);
assert.equal(published.at(-1).generation, preSwitchGeneration + 1);
assert.equal(state.workspaceSwitching, false); assert.equal(switchTimer.running, false);
// Closing a focused Column while awaiting must not activate an old successor.
workspace.activeWindow = duringSwitch;
shortcuts.get("CCScrollWorkspacePrevious")();
const generationWhileWaiting = published.at(-1).generation;
workspace.activeWindow = null;
windows = windows.filter(window => window !== duringSwitch); duringSwitch.closed.emit();
assert.equal(workspace.activeWindow, null);
assert.equal(published.at(-1).generation, generationWhileWaiting);
// Timeout with no native change remounts the actual workspace and reopens input.
const timeout = evaluate("workspaceSwitchController.timer").callback;
timeout(); assert.equal(state.activeWorkspaceId, "B"); assert.equal(state.workspaceSwitching, false);
shortcuts.get("CCScrollWorkspacePrevious")();
timeout(); assert.equal(state.workspaceSwitching, true, "previous epoch timeout ignored");
nativeSwitch(0, a[0]);
// Also cover the compatibility setter when per-screen requests are unavailable.
delete workspace.setCurrentDesktopForScreen;
Object.defineProperty(workspace, "currentDesktop", { configurable: true, get: () => current,
    set: desktop => { nativeSwitch(desktops.indexOf(desktop), desktop.id === "B" ? b[0] : a[0]); } });
shortcuts.get("CCScrollWorkspaceNext")(); assert.equal(state.activeWorkspaceId, "B");
shortcuts.get("CCScrollWorkspacePrevious")(); assert.equal(state.activeWorkspaceId, "A");
workspace.setCurrentDesktopForScreen = (desktop, screen) => { assert.equal(screen, output); requests.push(desktop); };

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
shortcuts.get("CCScrollWorkspaceNext")();
const writesWhileWaiting = geometryWrites;
motionAcks.forEach(callback => callback(true));
assert.equal(geometryWrites, writesWhileWaiting, "cancelled Wide ACK cannot commit during AWAITING_KWIN");
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
assert.equal(state.viewport.mode, "wide-focus", "return restores the saved Wide viewport");
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
// Exercise actual shortcut composition with independent desktops on two outputs.
// Secondary changes and J/K on primary must leave secondary windows untouched.
const secondary = { name: "HDMI-A-1", geometry: { x: 2560, y: 0, width: 1920, height: 1080 }, geometryChanged: signal() };
let secondaryDesktop = desktops[1];
const secondaryWindow = windowFor("secondary", secondaryDesktop);
secondaryWindow.output = secondary;
workspace.screens.push(secondary);
windows.push(secondaryWindow);
workspace.currentDesktopForScreen = screen => screen === output ? current : secondaryDesktop;
workspace.screensChanged.emit();
workspace.windowAdded.emit(secondaryWindow);
const secondaryBefore = JSON.stringify({ geometry: secondaryWindow.frameGeometry,
    desktops: Array.from(secondaryWindow.desktops), opacity: secondaryWindow.opacity, minimized: secondaryWindow.minimized });
Object.defineProperty(workspace, "currentDesktop", { configurable: true, get: () => secondaryDesktop,
    set: () => { throw new Error("J/K must never request a global desktop when per-output API exists"); } });
workspace.setCurrentDesktopForScreen = (desktop, screen) => {
    assert.equal(screen, output, "J/K always targets primary, even if global/active desktop is secondary");
    nativeSwitch(desktops.indexOf(desktop), desktop.id === "B" ? b[0] : null);
};
shortcuts.get("CCScrollWorkspacePrevious")();
assert.equal(state.activeWorkspaceId, "B");
assert.equal(secondaryDesktop, desktops[1]);
shortcuts.get("CCScrollWorkspaceNext")();
assert.equal(state.activeWorkspaceId, "C");
assert.equal(secondaryDesktop, desktops[1]);
const primaryGeneration = published.at(-1).generation;
secondaryDesktop = desktops[0];
workspace.currentDesktopChanged.emit(desktops[1], secondaryDesktop, secondary);
assert.equal(state.activeWorkspaceId, "C", "secondary signal must not mount primary");
assert.equal(published.at(-1).generation, primaryGeneration);
assert.equal(JSON.stringify({ geometry: secondaryWindow.frameGeometry,
    desktops: Array.from(secondaryWindow.desktops), opacity: secondaryWindow.opacity, minimized: secondaryWindow.minimized }), secondaryBefore);
// Restore the delayed setter for the existing stop/late-callback checks below.
workspace.setCurrentDesktopForScreen = (desktop, screen) => { assert.equal(screen, output); requests.push(desktop); };
shortcuts.get("CCScrollWorkspacePrevious")();
assert.equal(state.workspaceSwitching, true);
const stoppedTimeout = evaluate("workspaceSwitchController.timer").callback;
evaluate("emergencyRestoreAllWindows('test-end')");
const afterRecovery = geometryWrites;
stoppedTimeout(); workspace.currentDesktopChanged.emit(desktops[2], desktops[0], output);
assert.equal(geometryWrites, afterRecovery, "emergency stop invalidates outstanding switch callbacks");
assert.equal(evaluate("workspaceSwitchController.stopped"), true);
for (const window of windows) {
    assert.equal(window.opacity, 1, `${window.internalId} recovered opacity`);
    assert.equal(window.minimized, false, `${window.internalId} recovered minimized`);
}
assert.equal(state.enabled, false);
assert.equal(logs.some(line => /INVARIANT_FAIL|mount failed|FAIL_SAFE/.test(line)), false, logs.join("\n"));
console.log("PASS generated runtime mounts native desktop sessions and cancels real stale Dock/Wide callbacks");
