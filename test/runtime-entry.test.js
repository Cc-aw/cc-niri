const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createShortcutCatalog } =
    require("../src/kwin/runtime/ShortcutCatalog");
const { CCNiri } = require("../src/kwin/runtime/CCNiri");

const calls = [];
const actions = {
    focusPrevious: () => calls.push("focusPrevious"),
    focusNext: () => calls.push("focusNext"),
    toggleWide: () => calls.push("toggleWide"),
    moveLeft: () => calls.push("moveLeft"),
    moveRight: () => calls.push("moveRight"),
    toggleFloating: () => calls.push("toggleFloating"),
    publishDockState: () => calls.push("publishDockState"),
    applyDockCommand: () => calls.push("applyDockCommand"),
    emergencyRestore: () => calls.push("emergencyRestore"),
};
const catalog = createShortcutCatalog(actions);
assert.equal(catalog.length, 10);
assert.deepEqual(catalog.map(item => item.defaultSequence), [
    "Meta+H",
    "Meta+L",
    "Meta+Z",
    "Meta+Shift+H",
    "Meta+Shift+L",
    "Meta+Shift+Return",
    "Meta+Shift+Enter",
    "",
    "Meta+Ctrl+Alt+Shift+F11",
    "Meta+Ctrl+Alt+Shift+F12",
]);
catalog.forEach(item => item.handler());
assert.deepEqual(calls, [
    "focusPrevious", "focusNext", "toggleWide", "moveLeft", "moveRight",
    "toggleFloating", "toggleFloating", "publishDockState",
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
