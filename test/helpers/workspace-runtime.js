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

function createRuntime(config = {}) {
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
const motionPlans = [];
const motionPublishWrites = [];
const nativeArms = [];
const nativeAcks = [];
const nativeCancels = [];
const cancelAcks = [];
const scrollStatusAcks = [];
const workspaceTransitionAcks = [];
let workspaceTransitionActive = false;
let pendingCommand = "";
const timers = [];
const shortcuts = new Map();
const requests = [];
const desktopCreates = [];
const desktopRemoves = [];
const desktopRows = [];
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
    createDesktop(position, name) {
        desktopCreates.push({ position, name });
        desktops.splice(position, 0, { id: `D${desktopCreates.length}` });
        workspace.desktopsChanged.emit();
    },
    removeDesktop(desktop) {
        assert.equal(typeof desktop, "object", "KWin removeDesktop takes a VirtualDesktop QObject");
        assert.notEqual(desktop, current, "never remove the current native desktop");
        assert.equal(windows.some(window => !window.onAllDesktops &&
            Array.from(window.desktops).some(owner => owner === desktop)), false, "never remove a window's native desktop");
        const index = desktops.indexOf(desktop);
        assert.ok(index >= 0);
        desktopRemoves.push(desktop.id);
        desktops.splice(index, 1);
        workspace.desktopsChanged.emit();
    },
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
    readConfig: (key, fallback) => Object.prototype.hasOwnProperty.call(config, key)
        ? config[key] : key === "DebugLogging" ? true : fallback,
    registerShortcut: (name, _description, _sequence, handler) => shortcuts.set(name, handler), console: { info: message => logs.push(message), warn: message => logs.push(message) },
    callDBus: (_service, _path, _interface, method, ...args) => {
        const callback = args.at(-1);
        if (method === "GetState") callback("");
        else if (method === "EnsureVerticalDesktopLayout") { desktopRows.push(args[0]); callback(true); }
        else if (method === "PublishState") { published.push(JSON.parse(args[0])); callback(true); }
        else if (method === "PublishMotionPlan") { motionPlans.push(JSON.parse(args[0])); motionPublishWrites.push(geometryWrites); motionAcks.push(callback); if (motionPlans.at(-1).type === "SCROLL" && !config.HoldScrollAck) callback(true); }
        else if (method === "ArmScrollPlan") { nativeArms.push(JSON.parse(args[0])); nativeAcks.push(callback); if (!config.HoldNativeAck) callback(true); }
        else if (method === "WorkspaceTransitionActive") {
            workspaceTransitionAcks.push(callback);
            if (!config.HoldWorkspaceTransitionAck) callback(workspaceTransitionActive);
        }
        else if (method === "GetScrollMotionStatus") { scrollStatusAcks.push(callback); }
        else if (method === "CancelScrollPlan") { nativeCancels.push(JSON.parse(args[0])); cancelAcks.push(callback); if (!config.HoldCancelAck) callback(); }
        else if (method === "RequestDeferredCommand") { deferred.push(JSON.parse(args[0])); callback(true); }
        else if (method === "TakePendingCommand") { const command = pendingCommand; pendingCommand = ""; callback(command); }
        else if (typeof callback === "function") callback(true);
    },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../package/contents/code/main.js"), "utf8"), context);
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
return { evaluate, state, ids, nativeSwitch, desktops, desktopCreates, desktopRemoves, desktopRows, output, workspace, a, b, published, motionAcks, motionPlans, motionPublishWrites, nativeArms, nativeAcks, nativeCancels, cancelAcks, scrollStatusAcks, timers, shortcuts, logs,
    workspaceTransitionAcks,
    setWorkspaceTransitionActive(value) { workspaceTransitionActive = value; },
    move(window, ids) { window.desktops = ids.map(id => desktops.find(d => d.id === id)); window.onAllDesktops = !ids.length; window.desktopsChanged.emit(); },
    add(uuid, index, properties = {}) { const window = Object.assign(windowFor(uuid, desktops[index]), properties); windows.push(window); workspace.windowAdded.emit(window); return window; },
    close(window) { windows = windows.filter(w => w !== window); window.closed.emit(); },
    writes: () => geometryWrites,
};
}
module.exports = { createRuntime };
