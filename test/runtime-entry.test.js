const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createShortcutCatalog } =
    require("../src/kwin/runtime/ShortcutCatalog");
const { CCNiri } = require("../src/kwin/runtime/CCNiri");

const calls = [];
const actions = {
    workspacePrevious: () => calls.push("workspacePrevious"),
    workspaceNext: () => calls.push("workspaceNext"),
    workspaceFocus: number => calls.push(`workspaceFocus:${number}`),
    moveWorkspacePrevious: () => calls.push("moveWorkspacePrevious"),
    moveWorkspaceNext: () => calls.push("moveWorkspaceNext"),
    moveWorkspaceNumber: number => calls.push(`moveWorkspaceNumber:${number}`),
    focusPrevious: () => calls.push("focusPrevious"),
    focusNext: () => calls.push("focusNext"),
    cycleWidth: () => calls.push("cycleWidth"),
    toggleFull: () => calls.push("toggleFull"),
    toggleWide: () => calls.push("toggleWide"),
    moveLeft: () => calls.push("moveLeft"),
    moveRight: () => calls.push("moveRight"),
    toggleFloating: () => calls.push("toggleFloating"),
    publishFocusRingState: () => calls.push("publishFocusRingState"),
    publishDockState: () => calls.push("publishDockState"),
    applyDockCommand: () => calls.push("applyDockCommand"),
    emergencyRestore: () => calls.push("emergencyRestore"),
};
const catalog = createShortcutCatalog(actions);
assert.equal(catalog.length, 35);
assert.deepEqual(catalog.map(item => item.defaultSequence), [
    "Meta+K", "Meta+J",
    ...Array.from({ length: 9 }, (_, index) => `Meta+${index + 1}`),
    "Meta+Shift+K", "Meta+Shift+J",
    ...Array.from({ length: 9 }, (_, index) => `Meta+Ctrl+${index + 1}`),
    "Meta+H",
    "Meta+L",
    "Meta+R",
    "Meta+F",
    "Meta+Z",
    "Meta+Shift+H",
    "Meta+Shift+L",
    "Meta+Shift+Return",
    "Meta+Shift+Enter",
    "",
    "",
    "Meta+Ctrl+Alt+Shift+F11",
    "Meta+Ctrl+Alt+Shift+F12",
]);
catalog.forEach(item => item.handler());
assert.deepEqual(calls, [
    "workspacePrevious", "workspaceNext", ...Array.from({ length: 9 }, (_, index) => `workspaceFocus:${index + 1}`),
    "moveWorkspacePrevious", "moveWorkspaceNext", ...Array.from({ length: 9 }, (_, index) => `moveWorkspaceNumber:${index + 1}`),
    "focusPrevious", "focusNext", "cycleWidth", "toggleFull", "toggleWide", "moveLeft", "moveRight",
    "toggleFloating", "toggleFloating", "publishFocusRingState", "publishDockState",
    "applyDockCommand", "emergencyRestore",
]);

function signal() {
    return { connect: () => {}, disconnect: () => {} };
}
const lifecycleOptions = {
    workspace: {
        windowList: () => [],
        windowAdded: signal(),
        windowActivated: signal(),
        screensChanged: signal(),
        virtualScreenGeometryChanged: signal(),
        screenOrderChanged: signal(),
    },
    setupWindow: () => {},
    onWindowAdded: () => {},
    onWindowActivated: () => {},
    onScreensChanged: () => {},
    onVirtualScreenGeometryChanged: () => {},
    connectManagedGeometry: () => {},
    initializeScrollLayout: () => {},
    markInitialized: () => {},
    registerShortcut: () => {},
    shortcuts: [],
    commitInitialState: () => {},
};
const events = [];
const app = new CCNiri({
    lifecycle: lifecycleOptions,
    onStarted: () => events.push("started"),
    onStopping: () => events.push("stopping"),
});
assert.equal(app.start(), true);
assert.equal(app.start(), false);
assert.equal(app.stop(), true);
assert.equal(app.stop(), false);
assert.deepEqual(events, ["started", "stopping"]);

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);
assert.match(mainSource, /const app = new CCNiri\(/);
assert.match(mainSource, /app\.start\(\);/);

console.log("PASS CCNiri entry façade and shortcut catalog preserve runtime contract");
