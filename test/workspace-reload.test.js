"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const bundle = fs.readFileSync(require("node:path").join(__dirname, "../package/contents/code/main.js"), "utf8");
const desktops = [{ id: "A" }, { id: "B" }, { id: "C" }];
let saved = "";
function signal() { const handlers = new Set(); return { connect: fn => handlers.add(fn), disconnect: fn => handlers.delete(fn), emit: (...args) => [...handlers].forEach(fn => fn(...args)) }; }
function runtime(currentIndex, specifications) {
    const output = { name: "eDP-1", geometry: { x: 0, y: 0, width: 2560, height: 1440 }, geometryChanged: signal() };
    let current = desktops[currentIndex]; let activeWindow = null;
    const windows = specifications.map(([uuid, desktop, sticky = false]) => {
        const window = { internalId: uuid, output, caption: uuid, managed: true, normalWindow: true,
            moveable: true, resizeable: true, maximizable: true, opacity: 1, minimized: false, fullScreen: false,
            maximizeMode: 0, desktops: { 0: desktops[desktop], length: sticky ? 0 : 1 }, onAllDesktops: sticky,
            frameGeometry: { x: 50, y: 50, width: 800, height: 600 } };
        for (const name of ["frameGeometryChanged", "tileChanged", "quickTileModeChanged", "maximizedAboutToChange", "maximizedChanged", "outputChanged", "desktopsChanged", "fullScreenChanged", "activeChanged", "readyForPaintingChanged", "windowShown", "interactiveMoveResizeStarted", "interactiveMoveResizeFinished", "closed", "skipTaskbarChanged", "transientChanged", "modalChanged"]) window[name] = signal();
        window.setMaximize = () => {}; return window;
    });
    const workspace = { screens: [output], desktops, currentDesktopForScreen: () => current, get currentDesktop() { return current; },
        get activeWindow() { return activeWindow; }, set activeWindow(window) { activeWindow = window; }, windowList: () => windows,
        virtualScreenGeometry: output.geometry };
    for (const name of ["windowAdded", "windowActivated", "currentDesktopChanged", "desktopsChanged", "screensChanged", "screenOrderChanged", "virtualScreenGeometryChanged"]) workspace[name] = signal();
    const context = vm.createContext({ workspace, readConfig: (_key, fallback) => fallback, registerShortcut() {}, console,
        QTimer: class { constructor() { this.timeout = signal(); } start() {} stop() {} },
        callDBus: (_service, _path, _interface, method, ...args) => {
            const callback = args.at(-1);
            if (method === "GetState") callback(saved);
            else if (method === "PublishState") { saved = args[0]; callback(true); }
            else if (method === "TakePendingCommand") callback("");
            else if (typeof callback === "function") callback(true);
        } });
    vm.runInContext(bundle, context);
    const evaluate = code => vm.runInContext(code, context);
    return { evaluate, state: evaluate("mainScreenState"), switchTo(index) { const previous = current; current = desktops[index]; workspace.currentDesktopChanged.emit(previous, current, output); } };
}
const first = runtime(0, [["a0", 0], ["a1", 0], ["a2", 0], ["b0", 1], ["b1", 1]]);
first.evaluate("columnStore.reorder([mainScreenState.columns[2], mainScreenState.columns[0], mainScreenState.columns[1]]); mainScreenState.columns[0].persistentWide = true; mainScreenState.columns[0].widthMode = 'third'; recomputeLogicalLayout(); mainScreenState.scrollOffsetX = 200; publishDockState('save-a')");
first.switchTo(1);
first.evaluate("columnStore.reorder([mainScreenState.columns[1], mainScreenState.columns[0]]); mainScreenState.columns[0].persistentWide = true; columnStore.focusIndex(0); publishDockState('save-b')");
const persisted = JSON.parse(saved);
assert.equal(persisted.protocol, 2); assert.equal(persisted.workspaceId, "B");
assert.deepEqual(persisted.workspaces.find(w => w.id === "A").columns.map(c => c.uuid), ["a2", "a0", "a1"]);
assert.deepEqual(persisted.columns.map(c => c.uuid), ["b1", "b0"]);
// A real reload starts fresh while KDE may now be on a different desktop.
const second = runtime(0, [["a0", 0], ["a1", 0], ["a2", 0], ["b0", 1], ["b1", 1]]);
assert.equal(second.state.activeWorkspaceId, "A");
assert.deepEqual(Array.from(second.state.columns, c => c.window.internalId), ["a2", "a0", "a1"]);
assert.equal(second.state.scrollOffsetX, 200);
assert.equal(second.state.columns[0].widthMode, "third"); assert.equal(second.state.columns[0].persistentWide, true);
second.switchTo(1);
assert.deepEqual(Array.from(second.state.columns, c => c.window.internalId), ["b1", "b0"]);
assert.equal(second.state.columns[0].persistentWide, true); assert.equal(second.state.viewport.mode, "pair");
// Closed and sticky windows are removed; new native members append at mount.
const third = runtime(0, [["a1", 0, true], ["a2", 0], ["a3", 0], ["b0", 1], ["b1", 1]]);
assert.deepEqual(Array.from(third.state.columns, c => c.window.internalId), ["a2", "a3"]);
assert.equal(third.evaluate("workspaceSnapshots.workspaceForWindow('a0')"), null);
assert.equal(third.evaluate("workspaceSnapshots.workspaceForWindow('a1')"), null);
assert.equal(JSON.parse(saved).workspaces.find(w => w.id === "B").columns[0].uuid, "b1");
assert.equal(third.evaluate("invariantChecker.errors().length"), 0);
console.log("PASS generated runtime reloads all workspace snapshots on the actual KDE desktop and reconciles live windows");
