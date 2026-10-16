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
if (config.OutputScale) output.devicePixelRatio = config.OutputScale;
let current = desktops[0];
let activeWindow;
let windows = [];
let geometryWrites = 0;
const logs = [];
const published = [];
const stateAcks = [];
const traffic = [];
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
const geometryControls = new Map();
let v2Plan = null, v2Painted = null, v2Serial = 0;
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
    let held = false;
    let requested = null;
    const acknowledge = value => {
        const previous = geometry;
        geometry = config.ClientBufferScale ? { ...value, height: Math.round(value.height * config.ClientBufferScale) / config.ClientBufferScale } : value;
        window.frameGeometryChanged.emit(previous);
    };
    geometryControls.set(window, {
        hold() { held = true; },
        flush() { held = false; if (requested) acknowledge(requested); requested = null; },
    });
    Object.defineProperty(window, "frameGeometry", { get: () => geometry, set: value => {
        geometryWrites += 1;
        if (held) requested = value;
        else acknowledge(value);
    } });
    window.setMaximize = (horizontal, vertical) => { window.maximizeMode = horizontal && vertical ? 3 : 0; window.maximizedChanged.emit(); };
    return window;
}
const a = Array.from({ length: config.PrimaryWindowCount === undefined ? 5 : config.PrimaryWindowCount },
    (_, index) => windowFor(`a${index}`, desktops[0]));
const b = Array.from({ length: config.OtherWorkspaceWindowCount === undefined ? 2 : config.OtherWorkspaceWindowCount },
    (_, index) => windowFor(`b${index}`, desktops[1]));
windows = [...a, ...b];
activeWindow = a[0]; if (a[0]) a[0].active = true;
const workspace = { desktops, screens: [output], currentDesktopForScreen: () => current,
    clientArea: () => ({ x: 0, y: 50, width: output.geometry.width, height: output.geometry.height - 50 }),
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
const context = vm.createContext({ workspace, QTimer: Timer, KWin: { MaximizeArea: 0 },
    readConfig: (key, fallback) => Object.prototype.hasOwnProperty.call(config, key)
        ? config[key] : key === "DebugLogging" ? true : fallback,
    registerShortcut: (name, _description, _sequence, handler) => shortcuts.set(name, handler), console: { info: message => logs.push(message), warn: message => logs.push(message) },
    callDBus: (_service, _path, _interface, method, ...args) => {
        traffic.push({ service: _service, path: _path, method, payload: args[0] });
        const callback = args.at(-1);
        if (config.MockV2Native) {
            if (method === "GetColumnGeometryCapability") {
                callback(JSON.stringify({ protocol: 4, type: "COLUMN_GEOMETRY", enabled: true,
                    inputPolicy: "two-click", sourcePolicy: "painted-client-frames" })); return;
            }
            if (method === "GetPartialScrollCapability") {
                callback(JSON.stringify({ protocol: 3, type: "PARTIAL_SCROLL", enabled: true, inputPolicy: "two-click" })); return;
            }
            if (method === "GetScrollMotionStatus") {
                if (config.HoldV2Status) { scrollStatusAcks.push(callback); return; }
                callback(JSON.stringify({ sessionId: published.at(-1)?.sessionId,
                    epoch: v2Plan ? v2Plan.epoch : 0, active: Boolean(v2Plan && !v2Plan.cancelled), clipHandoffActive: false })); return;
            }
            if (method === "GetColumnGeometryCompletion") {
                callback(JSON.stringify(v2Painted ? { ...v2Painted, protocol: 4, type: "COLUMN_GEOMETRY_COMPLETION",
                    entries: undefined, completed: true, painted: true } : { completed: false })); return;
            }
            if (method === "GetColumnGeometrySourceFor") {
                const requested = JSON.parse(args[0]).entries;
                callback(JSON.stringify(v2Painted ? { ...v2Painted, entries: requested.map(row =>
                    v2Painted.entries.find(e => e.windowId === row.windowId) || { ...row, frameRect:
                        windows.find(w => w.internalId === row.windowId).frameGeometry,
                        owned: false, painted: false, hidden: true, acknowledged: true, visualRect: null }) } : { valid: false })); return;
            }
            if (method === "PublishMotionPlan") {
                motionPlans.push(JSON.parse(args[0])); motionPublishWrites.push(geometryWrites); callback(true); return;
            }
            if (method === "ArmScrollPlan") {
                v2Plan = JSON.parse(args[0]); nativeArms.push(v2Plan); nativeAcks.push(callback);
                if (!config.HoldNativeAck) callback(!config.RejectNativeArm);
                return;
            }
            if (method === "CancelScrollPlan") {
                nativeCancels.push(JSON.parse(args[0]));
                const epoch = v2Plan ? v2Plan.epoch : 0;
                v2Plan = { epoch, cancelled: true }; v2Painted = null;
                // Keep the last accepted epoch, exactly as the Native runtime.
                callback();
                return;
            }
        }
        if (method === "GetState") callback(config.PreviousState
            ? JSON.stringify(config.PreviousState) : "");
        else if (method === "EnsureVerticalDesktopLayout") { desktopRows.push(args[0]); callback(true); }
        else if (method === "PublishState") {
            const state = JSON.parse(args[0]);
            let replied = false;
            const reply = accepted => {
                if (replied) return;
                replied = true;
                if (accepted) published.push(state);
                callback(accepted);
            };
            stateAcks.push(reply);
            if (!config.HoldStateAck) reply(!config.RejectState);
        }
        else if (method === "PublishMotionPlan") {
            const plan = JSON.parse(args[0]);
            motionPlans.push(plan); motionPublishWrites.push(geometryWrites); motionAcks.push(callback);
            if (config.ValidateScrollMembership && ["SCROLL", "COLUMN_REINDEX"].includes(plan.type)) {
                const state = published.at(-1);
                const owners = new Set(state ? state.columns.map(column => column.uuid) : []);
                if (!state || state.workspaceId !== plan.workspaceId ||
                        state.targetOutput !== plan.targetOutput ||
                        plan.entries.some(entry => !owners.has(entry.windowId))) { callback(false); return; }
            }
            if (config.RejectScrollPlan && ["SCROLL", "COLUMN_REINDEX"].includes(plan.type)) { callback(false); return; }
            if ((["SCROLL", "COLUMN_REINDEX"].includes(plan.type) && !config.HoldScrollAck) ||
                    (plan.viewport && !["SCROLL", "COLUMN_REINDEX"].includes(plan.type) && !config.HoldWidthAck)) callback(true);
        }
        else if (method === "ArmScrollPlan") { nativeArms.push(JSON.parse(args[0])); nativeAcks.push(callback); if (!config.HoldNativeAck) callback(!config.RejectNativeArm); }
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
function nativeSwitch(index, active, expectMount = true) {
    const batches = logs.filter(line => /BEGIN epoch=.*reason=workspace-mount/.test(line)).length;
    const previous = current; current = desktops[index];
    // Exercise the problematic native signal order: activation precedes desktop signal.
    workspace.activeWindow = active;
    workspace.currentDesktopChanged.emit(previous, current, output);
    assert.equal(logs.filter(line => /BEGIN epoch=.*reason=workspace-mount/.test(line)).length, batches + Number(expectMount),
        "native desktop changes issue one relayout, including empty workspaces");
}
return { evaluate, state, ids, nativeSwitch, desktops, desktopCreates, desktopRemoves, desktopRows, output, workspace, a, b, published, stateAcks, traffic, deferred, motionAcks, motionPlans, motionPublishWrites, nativeArms, nativeAcks, nativeCancels, cancelAcks, scrollStatusAcks, timers, shortcuts, logs,
    paintV2() {
        const p = v2Plan;
        assert.ok(p && !p.cancelled, "a Native arm is required before painting");
        v2Painted = { protocol: 4, type: "COLUMN_GEOMETRY_SOURCE", valid: true,
            ...Object.fromEntries(["sessionId", "workspaceId", "targetOutput", "scopeRevision", "epoch", "maxCamera", "viewport", "layoutRect"].map(k => [k, p[k]])),
            cameraX: p.newScrollOffsetX, sampleSerial: ++v2Serial,
            entries: p.entries.map(row => {
                const logicalX = row.newLogicalX ?? row.logicalX, width = row.newPixelWidth ?? row.pixelWidth;
                const visualRect = { x: p.layoutRect.x + logicalX - p.newScrollOffsetX, y: p.layoutRect.y,
                    width, height: p.layoutRect.height };
                const culled = visualRect.x + width <= p.viewport.x || visualRect.x >= p.viewport.x + p.viewport.width;
                return { windowId: row.windowId, columnId: row.columnId, logicalX,
                    frameRect: { ...windows.find(w => w.internalId === row.windowId).frameGeometry },
                    visualRect, owned: true, painted: !culled, culled, acknowledged: true };
            }) };
        evaluate("continuousLayout.coordinator.completionWake(continuousLayout.controller.lastTarget)");
    },
    queueCommand(command) { pendingCommand = JSON.stringify(command); },
    workspaceTransitionAcks,
    setWorkspaceTransitionActive(value) { workspaceTransitionActive = value; },
    move(window, ids) { window.desktops = ids.map(id => desktops.find(d => d.id === id)); window.onAllDesktops = !ids.length; window.desktopsChanged.emit(); },
    add(uuid, index, properties = {}) { const window = Object.assign(windowFor(uuid, desktops[index]), properties); windows.push(window); workspace.windowAdded.emit(window); return window; },
    close(window) { windows = windows.filter(w => w !== window); window.closed.emit(); },
    writes: () => geometryWrites,
    holdGeometry(window) { geometryControls.get(window).hold(); },
    flushGeometry(window) { geometryControls.get(window).flush(); },
};
}
module.exports = { createRuntime };
