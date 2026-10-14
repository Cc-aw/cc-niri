"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { FocusRingController } = require("../src/kwin/visual/FocusRingController");
const { WindowStateStore } = require("../src/kwin/model/WindowStateStore");
const { WorkspaceSnapshotStore } = require("../src/kwin/workspace/WorkspaceSnapshotStore");
const { ScrollPlanCommitGate } = require("../src/kwin/layout/ScrollPlanCommitGate");

test("5000 lost Native cancel ACKs retire their request and timer at the protocol deadline", () => {
    const timers = new Map(); let timerId = 0, reply, finishes = 0;
    const gate = new ScrollPlanCommitGate({
        disarm: (_epoch, callback) => { reply = callback; }, timeoutMs: 150,
        setTimer: callback => { timers.set(++timerId, callback); return timerId; },
        clearTimer: id => timers.delete(id), warn: () => {},
    });
    for (let epoch = 0; epoch < 5000; ++epoch) {
        gate.abort(epoch, () => { finishes++; });
        assert.equal(gate.disarming.size, 1); assert.equal(timers.size, 1);
        timers.values().next().value();
        assert.equal(gate.disarming.size, 0); assert.equal(timers.size, 0);
        reply(); assert.equal(finishes, epoch + 1, "late ACK is idempotent");
    }
    assert.equal(gate.idleCallbacks.length, 0);
});

function signal() {
    const handlers = new Set();
    return {
        connect: handler => handlers.add(handler),
        disconnect: handler => handlers.delete(handler),
        emit: (...args) => [...handlers].forEach(handler => handler(...args)),
        size: () => handlers.size,
    };
}

test("5000 model window closes release Ring watchers, tombstones and window states", () => {
    const output = { name: "DP-1" };
    const desktop = { id: "workspace" };
    const state = { enabled: true, activeWorkspaceId: desktop.id, targetOutput: output, columns: [] };
    const workspace = { windowList: () => [] };
    for (const name of ["windowAdded", "windowActivated", "currentDesktopChanged",
        "desktopsChanged", "screensChanged", "screenOrderChanged"]) workspace[name] = signal();
    const windowStates = new WindowStateStore(() => ({ floating: false }));
    let publications = 0;
    const ring = new FocusRingController({
        workspace, sessionId: "model-memory-audit", getState: () => state,
        getCurrentDesktop: () => desktop, getWindowState: window => windowStates.get(window),
        membership: { belongsTo: () => true }, windowPolicy: { canJoinColumn: () => true },
        invoke: (_service, _path, _interface, _method, json, callback) => {
            assert.ok(JSON.parse(json).windows.length <= 1);
            publications += 1;
            callback(true);
        },
    });
    ring.start();
    for (let i = 0; i < 5000; i += 1) {
        const window = { internalId: `aaaaaaaa-aaaa-4aaa-8aaa-${i.toString(16).padStart(12, "0")}`, output };
        for (const name of ["closed", "outputChanged", "desktopsChanged", "skipTaskbarChanged",
            "transientChanged", "modalChanged", "fullScreenChanged", "minimizedChanged",
            "activitiesChanged"]) window[name] = signal();
        windowStates.ensure(window);
        state.columns = [{ window }];
        workspace.windowAdded.emit(window);
        assert.equal(ring.watched.size, 1);
        assert.equal(window.closed.size(), 1);
        window.closed.emit();
        assert.equal(ring.watched.size, 0);
        assert.equal(ring.closed.size, 1, "close guard lives until the column is removed");
        for (const name of ["internalId", "output"]) Object.defineProperty(window, name, {
            get() { throw new Error("destroyed wrapper accessed"); },
        });
        ring.publish(true);
        state.columns = [];
        ring.membershipChanged();
        windowStates.delete(window);
        assert.equal(ring.closed.size, 0);
        assert.equal(windowStates.states.size, 0);
        assert.equal(window.closed.size(), 0);
        assert.equal(window.outputChanged.size(), 0);
    }
    ring.stop();
    assert.equal(ring.connections.length, 0);
    assert.equal(workspace.windowAdded.size(), 0);
    assert.equal(workspace.windowActivated.size(), 0);
    assert.ok(publications >= 5000);
});

test("5000 snapshot close and workspace recycle cycles leave no historical UUID owners", () => {
    const snapshots = new WorkspaceSnapshotStore();
    for (let i = 0; i < 5000; i += 1) {
        const id = `workspace-${i}`;
        const uuid = `window-${i}`;
        snapshots.set(id, { columns: [{ uuid, widthMode: "half" }], focusedUuid: uuid,
            viewportAnchor: { uuid, delta: 0 }, presentation: { mode: "wide", windowUuid: uuid } });
        assert.equal(snapshots.uuidOwner.size, 1);
        assert.equal(snapshots.removeWindow(uuid), true);
        const snapshot = snapshots.get(id);
        assert.equal(snapshot.columns.length, 0);
        assert.equal(snapshot.focusedUuid, null);
        assert.equal(snapshot.viewportAnchor, null);
        assert.equal(snapshot.presentation.windowUuid, null);
        assert.equal(snapshots.uuidOwner.size, 0);
        assert.equal(snapshots.remove(id), true);
        assert.equal(snapshots.snapshots.size, 0);
    }
});
