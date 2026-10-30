"use strict";

// No timers, DBus, compositor, packages or user configuration are touched here.
// Retired callbacks are deliberately retained by the TEST, then delivered late.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RuntimeLifecycle } = require("../src/kwin/runtime/RuntimeLifecycle");
const { RecoveryCompletionGate } = require("../src/kwin/stability/RecoveryCompletionGate");
const { LayoutTransaction } = require("../src/kwin/stability/LayoutTransaction");
const { SessionPauseController } = require("../src/kwin/runtime/SessionPauseController");
const { createRuntime } = require("./helpers/workspace-runtime");

function signal() {
    const slots = new Set();
    return {
        connect: fn => slots.add(fn), disconnect: fn => slots.delete(fn),
        snapshot: () => [...slots], size: () => slots.size,
        emit: () => [...slots].forEach(fn => fn()),
    };
}
function clock() {
    const live = new Set();
    return {
        live,
        setTimer(fn) { const handle = { fn }; live.add(handle); return handle; },
        clearTimer(handle) { live.delete(handle); },
    };
}
function lifecycleFixture() {
    const timers = clock(), reads = [], commits = [];
    const workspace = { windowList: () => [] };
    for (const name of ["windowAdded", "windowActivated", "screensChanged",
        "virtualScreenGeometryChanged", "screenOrderChanged"]) workspace[name] = signal();
    const lifecycle = new RuntimeLifecycle({
        workspace, ...timers, shortcuts: [], registerShortcut() {}, setupWindow() {},
        onWindowAdded() {}, onWindowActivated() {}, onScreensChanged() {},
        onVirtualScreenGeometryChanged() {}, connectManagedGeometry() {},
        readPreviousState: done => reads.push(done),
        initializeScrollLayout: snapshot => commits.push(snapshot),
        markInitialized() {}, commitInitialState() {},
    });
    return { lifecycle, timers, reads, commits, workspace };
}

test("SA-01: retired startup replies and deadlines cannot initialize a restarted lifecycle", () => {
    const f = lifecycleFixture();
    for (let i = 0; i < 200; ++i) {
        f.lifecycle.start();
        const oldRead = f.reads.at(-1), oldDeadline = [...f.timers.live][0].fn;
        f.lifecycle.stop(); f.lifecycle.start();
        oldRead("retired"); oldDeadline();
        assert.equal(f.commits.length, i);
        const fresh = f.reads.at(-1), deadline = [...f.timers.live][0].fn;
        // Both callback orders; neither callback can complete twice.
        if (i % 2) { deadline(); fresh("late"); } else { fresh("fresh"); deadline(); }
        assert.equal(f.commits.length, i + 1);
        assert.equal(f.commits.at(-1), i % 2 ? "" : "fresh");
        f.lifecycle.stop();
        assert.equal(f.lifecycle.connections.length, 0);
        assert.equal(f.timers.live.size, 0);
        assert.equal(f.workspace.windowAdded.size(), 0);
    }
});

test("SA-02: owner cleanup uses object identity and survives a destroyed signal wrapper", () => {
    const f = lifecycleFixture(); f.lifecycle.start();
    const old = { internalId: "same-id" }, replacement = { internalId: "same-id" };
    const destroyed = signal(), live = signal(), other = signal();
    f.lifecycle.connect(destroyed, () => {}, old);
    destroyed.disconnect = () => { throw new Error("QObject already destroyed"); };
    f.lifecycle.connect(live, () => {}, old);
    f.lifecycle.connect(other, () => {}, replacement);
    f.lifecycle.disconnectOwner(old); f.lifecycle.disconnectOwner(old);
    assert.equal(live.size(), 0);
    assert.equal(other.size(), 1, "the replacement instance keeps its subscription");
    assert.equal(f.lifecycle.connections.some(c => c.owner === old), false);
    f.lifecycle.stop(); assert.equal(other.size(), 0);
    assert.equal(f.lifecycle.connections.length, 0);
});

function recoveryFixture() {
    const timers = clock();
    const window = { frameGeometry: { x: 0 }, opacity: 0, minimized: true };
    for (const name of ["frameGeometryChanged", "opacityChanged", "minimizedChanged", "closed"])
        window[name] = signal();
    let windows = [window];
    const gate = new RecoveryCompletionGate({ ...timers, getWindows: () => windows,
        sameRect: (a, b) => a.x === b.x });
    const row = { window, target: { x: 100 }, opacity: 1, minimized: false };
    return { gate, timers, window, row, remove: () => { windows = []; },
        assertDrained() {
            assert.equal(gate.pending, null); assert.equal(timers.live.size, 0);
            for (const name of ["frameGeometryChanged", "opacityChanged", "minimizedChanged", "closed"])
                assert.equal(window[name].size(), 0, name);
        } };
}

for (const order of [["frameGeometry", "opacity", "minimized"], ["frameGeometry", "minimized", "opacity"],
    ["opacity", "frameGeometry", "minimized"], ["opacity", "minimized", "frameGeometry"],
    ["minimized", "frameGeometry", "opacity"], ["minimized", "opacity", "frameGeometry"]]) {
    test(`SA-03: restore proof requires all three facts in order ${order.join(",")}`, () => {
        const f = recoveryFixture(), replies = [];
        f.gate.wait([f.row], value => replies.push(value));
        const deadline = [...f.timers.live][0].fn;
        const staleSignals = f.window.frameGeometryChanged.snapshot();
        order.forEach((key, i) => {
            f.window[key] = key === "frameGeometry" ? f.row.target : key === "opacity" ? 1 : false;
            f.window[`${key}Changed`].emit();
            assert.deepEqual(replies, i === 2 ? [true] : []);
        });
        deadline(); staleSignals.forEach(fn => fn());
        assert.deepEqual(replies, [true]); f.assertDrained();
    });
}

test("SA-04: reentrant recovery completion cannot let the old deadline retire a new proof", () => {
    const f = recoveryFixture(), replies = [];
    f.gate.wait([f.row], value => {
        replies.push(["old", value]);
        f.gate.wait([f.row], next => replies.push(["new", next]));
    });
    const staleDeadline = [...f.timers.live][0].fn;
    const staleSignals = f.window.opacityChanged.snapshot();
    staleDeadline();
    assert.deepEqual(replies, [["old", false]]);
    const current = f.gate.pending;
    staleDeadline(); staleSignals.forEach(fn => fn());
    assert.equal(f.gate.pending, current); assert.equal(f.timers.live.size, 1);
    f.window.frameGeometry = f.row.target; f.window.opacity = 1; f.window.minimized = false;
    f.window.frameGeometryChanged.emit();
    assert.deepEqual(replies, [["old", false], ["new", true]]); f.assertDrained();
});

test("SA-05: a partial signal subscription failure releases the already acquired listeners", () => {
    const f = recoveryFixture(), replies = [];
    f.window.opacityChanged.connect = () => { throw new Error("destroyed during subscription"); };
    f.gate.wait([f.row], value => replies.push(value));
    assert.deepEqual(replies, [false]); f.assertDrained();
});

test("SA-06: close releases restore proof without reading a destroyed window's properties", () => {
    const f = recoveryFixture(), replies = [];
    f.gate.wait([f.row], value => replies.push(value));
    const deadline = [...f.timers.live][0].fn;
    f.remove();
    for (const key of ["frameGeometry", "opacity", "minimized"]) Object.defineProperty(f.window, key, {
        get() { assert.fail(`destroyed property read: ${key}`); },
    });
    f.window.closed.emit(); deadline();
    assert.deepEqual(replies, [true]); f.assertDrained();
});

test("SA-07: synchronous ACK reentry and nested failure share one epoch and release the guard", () => {
    const audits = [];
    const transaction = new LayoutTransaction({ audit: (_reason, epoch) => audits.push(epoch), debug() {} });
    assert.throws(() => transaction.run("outer", epoch => {
        transaction.resume("synchronous-ack", epoch, () => {
            transaction.run("geometry-signal", same => {
                assert.equal(same, epoch); assert.equal(transaction.isActive(), true);
                throw new Error("client geometry failed");
            });
        });
    }), /client geometry failed/);
    assert.equal(transaction.isActive(), false); assert.deepEqual(audits, [1]);
    transaction.run("replacement", () => {});
    assert.equal(transaction.resume("retired", 1, () => assert.fail("stale write")), false);
    assert.deepEqual(audits, [1, 2]);
});

test("SA-08: a session reply already queued before stop cannot resume or publish running", () => {
    const timers = clock(), reads = [], statuses = [];
    const controller = new SessionPauseController({ ...timers, readState: done => reads.push(done),
        release: done => done(true), onResume: () => assert.fail("resume after stop"),
        onPause() {}, health: state => statuses.push(state.state), warn() {} });
    controller.refresh(); const deadline = [...timers.live][0].fn;
    for (let i = 0; i < 200; ++i) controller.refresh("queued");
    assert.equal(reads.length, 1);
    controller.stop(); reads[0]({ protocol: 1, type: "session-state", instanceId: "retired", sequence: 0, locked: false });
    deadline(); assert.deepEqual(statuses, ["stopped"]);
    assert.equal(timers.live.size, 0); assert.equal(controller.queuedReason, null);
});

test("SA-09: generated entry close churn returns owned signal and window state counts to baseline", () => {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true, PrimaryWindowCount: 1 });
    r.paintV2();
    const counts = () => Array.from(r.evaluate("[states.states.size, app.lifecycle.connections.length, focusRingController.watched.size]"));
    const baseline = counts();
    for (let i = 0; i < 100; ++i) {
        // Inactive clients on another workspace exercise lifecycle/snapshot cleanup
        // without pretending mock rendering proves real KWin object destruction.
        const window = r.add(`audit-${i}`, 1);
        assert.equal(counts()[0], baseline[0] + 1);
        r.close(window);
        assert.deepEqual(counts(), baseline);
    }
    assert.equal(r.evaluate("recovery.obligations.size"), 0);
    assert.equal(r.evaluate("continuousLayout.actions.size"), 0);
    assert.equal(r.state.enabled, true);
});
