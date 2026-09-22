const assert = require("node:assert/strict");
const { RuntimeLifecycle } = require("../src/kwin/runtime/RuntimeLifecycle");

function signal() {
    const handlers = new Set();
    return {
        connect: handler => handlers.add(handler),
        disconnect: handler => handlers.delete(handler),
        emit: value => handlers.forEach(handler => handler(value)),
        size: () => handlers.size,
    };
}

const existing = [{ id: "a" }, { id: "b" }];
const workspace = {
    windowList: () => existing,
    windowAdded: signal(),
    windowActivated: signal(),
    screensChanged: signal(),
    virtualScreenGeometryChanged: signal(),
    screenOrderChanged: signal(),
};
const events = [];
const shortcuts = [{
    name: "test-shortcut",
    description: "Test Shortcut",
    defaultSequence: "Meta+T",
    handler: () => events.push("shortcut-fired"),
}];
const lifecycle = new RuntimeLifecycle({
    workspace,
    setupWindow: window => events.push(`setup:${window.id}`),
    onWindowAdded: window => events.push(`added:${window.id}`),
    onWindowActivated: window => events.push(`activated:${window.id}`),
    onScreensChanged: () => events.push("screens"),
    onVirtualScreenGeometryChanged: () => events.push("virtual"),
    connectManagedGeometry: () => events.push("managed-geometry"),
    initializeScrollLayout: () => events.push("initialize"),
    markInitialized: value => events.push(`initialized:${value}`),
    registerShortcut: (name, description, sequence, handler) => {
        events.push(`register:${name}:${description}:${sequence}`);
        handler();
    },
    shortcuts,
    commitInitialState: () => events.push("commit"),
});

assert.equal(lifecycle.start(), true);
assert.equal(lifecycle.start(), false, "start is idempotent");
assert.deepEqual(events.slice(0, 2), ["setup:a", "setup:b"]);
assert.equal(workspace.windowAdded.size(), 1);
assert.equal(workspace.screenOrderChanged.size(), 1);
workspace.windowAdded.emit({ id: "c" });
workspace.windowActivated.emit({ id: "c" });
assert.ok(events.includes("added:c"));
assert.ok(events.includes("activated:c"));
assert.equal(events.filter(event => event.startsWith("register:")).length, 1);
assert.ok(events.indexOf("shortcut-fired") < events.indexOf("commit"));

assert.equal(lifecycle.stop(), true);
assert.equal(lifecycle.stop(), false, "stop is idempotent");
assert.equal(workspace.windowAdded.size(), 0);
assert.equal(workspace.windowActivated.size(), 0);
assert.equal(workspace.screensChanged.size(), 0);
assert.equal(events.at(-1), "initialized:false");

assert.equal(lifecycle.start(), true, "a stopped lifecycle can reconnect");
assert.equal(events.filter(event => event.startsWith("register:")).length, 1,
    "non-removable KWin shortcuts are only registered once");

console.log("PASS runtime lifecycle owns idempotent start, stop, signals, and shortcuts");
