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
const eligibility = [];
let nativeLoaded = true;
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
const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const nextId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const a = [windowFor(firstId, desktops[0]), windowFor(secondId, desktops[0])];
const b = [windowFor(nextId, desktops[1])];
windows = [...a, ...b]; activeWindow = a[0]; a[0].active = true;
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
    registerShortcut: (name, _description, _sequence, handler) => shortcuts.set(name, handler), console: { info: message => logs.push(message), warn: message => logs.push(message) },
    callDBus: (_service, _path, _interface, method, ...args) => {
        const callback = args.at(-1);
        if (method === "PublishEligibility") {
            assert.deepEqual([_service, _path, _interface], ["org.kde.KWin", "/ccNiriFocusRing", "org.cc.NiriFocusRing1"]);
            if (nativeLoaded) eligibility.push(JSON.parse(args[0]));
            callback(nativeLoaded);
        }
        else if (method === "GetState") callback("");
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
assert.deepEqual(eligibility.at(-1).windows, [firstId, secondId], "generated runtime publishes initial mounted membership");
assert.equal(eligibility.at(-1).workspaceId, "A");
assert.deepEqual(JSON.parse(JSON.stringify(a[0].frameGeometry)),
    { x: 24, y: 50, width: 1252, height: 1382 },
    "mounted Ring-eligible window uses the compact default safe area");
const beforeGeometry = JSON.stringify(a.map(window => window.frameGeometry));
const epoch = evaluate('beginLayoutTransaction("test-owner-change")');
const beforeGeneration = eligibility.at(-1).generation;
workspace.activeWindow = a[1];
assert.ok(eligibility.at(-1).generation > beforeGeneration, "real activation hook publishes during transaction");
assert.equal(evaluate('columnStore.focusedColumn().window') , a[0], "layout activation is suppressed while native focus changed");
assert.equal(JSON.stringify(a.map(window => window.frameGeometry)), beforeGeometry, "focus-ring does not change geometry");
evaluate(`endLayoutTransaction("test-owner-change", ${epoch})`);
workspace.activeWindow = a[0];
const dockGeneration = evaluate('dockGateway.generation()');
nativeLoaded = false;
shortcuts.get("CCScrollToggleFloating")();
nativeLoaded = true;
shortcuts.get("CCScrollPublishFocusRingState")();
assert.deepEqual(eligibility.at(-1).windows, [secondId], "native-on gets fresh detached membership without Dock cache");
assert.equal(evaluate('dockGateway.generation()'), dockGeneration+1, "eligibility resend does not commit Dock generation");
shortcuts.get("CCScrollToggleFloating")();
assert.deepEqual(eligibility.at(-1).windows, [firstId,secondId]);
// Native desktop authority changes before the mount; controller sends disabled
// membership before the layout signal handler replaces Columns.
const beforeSwitch = eligibility.length;
current = desktops[1]; workspace.activeWindow = b[0];
assert.equal(eligibility.at(-1).enabled, false);
workspace.currentDesktopChanged.emit(desktops[0], desktops[1], output);
assert.deepEqual(eligibility.at(-1).windows, [nextId]);
assert.equal(eligibility.at(-1).workspaceId, "B");
assert.ok(eligibility.slice(beforeSwitch).some(snapshot => !snapshot.enabled));
const previousEligibility = eligibility.at(-1).generation;
const previousDock = published.length;
// Simulate a lost Bridge call. Eligibility uses only the native endpoint.
evaluate('dockGateway.invoke = () => {}');
shortcuts.get("CCScrollPublishFocusRingState")();
assert.ok(eligibility.at(-1).generation > previousEligibility);
assert.equal(published.length, previousDock);
b[0].closed.emit(); windows = windows.filter(window => window !== b[0]);
assert.deepEqual(eligibility.at(-1).windows, [], "close immediately removes old owner eligibility");
evaluate('app.stop()');
assert.equal(eligibility.at(-1).enabled, false);
const afterStop = eligibility.length;
workspace.windowActivated.emit(null);
assert.equal(eligibility.length, afterStop);
console.log("PASS generated runtime independent channel, active transaction, off/on resync, floating, J/K mount and stop");
