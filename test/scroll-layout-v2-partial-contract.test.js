"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createV2Runtime } = require("./helpers/scroll-layout-v2-runtime");
const { createPartialScrollPlan, partialScrollSafeTargets } = require("../src/kwin/layout/PartialScrollPlan");
const { ScrollPlanCommitGate } = require("../src/kwin/layout/ScrollPlanCommitGate");
const capability = { protocol: 3, type: "PARTIAL_SCROLL", enabled: true, inputPolicy: "two-click" };
const produce = intent => createPartialScrollPlan(intent, { capability, issuedAt: 1 });
function mounted() {
    const r = createV2Runtime();
    r.mount([ { window: r.window("a"), widthMode: "twoThirds" },
        { window: r.window("b"), widthMode: "half" } ], {}, r.geometry(2560, 16, 50));
    return r;
}
test("P3 initial hydration and observed H/L use OutputRect and safe frames", () => {
    const r = mounted(), initial = produce(r.controller.lastTarget);
    assert.ok(initial); assert.equal(initial.protocol, 3);
    assert.equal(initial.oldScrollOffsetX, initial.newScrollOffsetX);
    assert.deepEqual(initial.viewport, { x: 0, y: 0, width: 2560, height: 1440 });
    assert.deepEqual(initial.layoutRect, { x: 0, y: 66, width: 2560, height: 1358 });
    r.paint(); r.controller.focusRelative(1);
    const p = produce(r.controller.lastTarget);
    assert.ok(p); assert.notEqual(p.oldScrollOffsetX, p.newScrollOffsetX);
    for (const { rect } of partialScrollSafeTargets(p)) {
        assert.ok(rect.x >= 0 && rect.x + rect.width <= 2560);
        assert.equal(rect.height, 1358);
    }
    assert.equal(p.entries[0].pixelWidth, r.state.columns[0].pixelWidth);
});
test("P3 fails closed for unavailable source, malformed data and P4 basis changes", () => {
    const r = mounted();
    assert.equal(createPartialScrollPlan(r.controller.lastTarget, { capability: { ...capability, enabled: false }, issuedAt: 1 }), null);
    r.controller.focusRelative(1); assert.equal(produce(r.controller.lastTarget), null);
    r.paint(); r.controller.focusRelative(-1);
    const intent = r.controller.lastTarget;
    assert.ok(produce(intent));
    for (const change of [ { epoch: -1 }, { scopeRevision: 0 }, { maxCamera: Infinity },
        { cameraTargetX: -1 }, { source: { cameraX: 0 } },
        { entries: [ ...intent.entries, intent.entries[0] ] },
        { entries: intent.entries.map(e => ({ ...e, uuid: "{bad}" })) },
        { source: { ...intent.source, entries: intent.source.entries.map(e => ({ ...e, visualRect: { ...e.visualRect, x: e.visualRect.x + 1 } })) } } ])
        assert.equal(produce({ ...intent, ...change }), null);
    r.paint(); r.controller.setWidth(r.state.columns[0], "full");
    assert.equal(produce(r.controller.lastTarget), null, "resize cannot borrow a camera-only ACK");
    r.paint(); r.controller.moveFocused(1);
    assert.equal(produce(r.controller.lastTarget), null);
    const far = createV2Runtime();
    far.mount(["a", "b", "c", "d", "e"].map(id => ({ window: far.window(id), widthMode: "half" })));
    far.paint(); far.controller.focusWindow(far.state.columns[4].window);
    assert.equal(produce(far.controller.lastTarget), null, "a swept parked-only client requires the P4 hydration contract");
});
function gateFixture() {
    let epoch = 1;
    const commits = [], failures = [], calls = [], timers = new Set();
    const gate = new ScrollPlanCommitGate({ timeoutMs: 150, currentEpoch: () => epoch,
        prepare: (_, cb) => calls.push(["membership", cb]), publish: (_, cb) => calls.push(["motion", cb]),
        arm: (_, cb) => calls.push(["arm", cb]), disarm: (_, cb) => calls.push(["cancel", cb]),
        setTimer: cb => { timers.add(cb); return cb; }, clearTimer: cb => timers.delete(cb), warn: () => {},
        commit: (p, c, w) => commits.push([p.epoch, c.nativeScroll, w]),
        onPartialFailure: (p, _, result) => failures.push([p.epoch, result.cancelled]) });
    const ack = (name, result) => calls.findLast(c => c[0] === name)[1](result);
    const schedule = () => gate.schedule({ epoch }, { type: "PARTIAL_SCROLL" }, {});
    return { gate, commits, failures, calls, timers, ack, schedule, setEpoch: e => { epoch = e; } };
}
test("P3 membership → motion → Native ACK precedes geometry and activation", () => {
    const f = gateFixture(); f.schedule(); f.gate.deferActivation("b");
    assert.deepEqual(f.calls.map(c => c[0]), ["membership"]);
    f.ack("membership", true); f.ack("motion", true);
    assert.equal(f.commits.length, 0); f.ack("arm", true);
    assert.deepEqual(f.commits, [[1, true, "b"]]); assert.equal(f.timers.size, 0);
});
test("P3 timeout and rejected cancel never trigger static partial commit", () => {
    for (const cancelAck of [true, false, null]) {
        const f = gateFixture(); f.schedule(); f.ack("membership", true); f.ack("motion", true);
        const arm = f.calls.at(-1)[1]; [...f.timers][0]();
        assert.equal(f.commits.length, 0);
        if (cancelAck === null) [...f.timers][0](); else f.ack("cancel", cancelAck);
        assert.deepEqual(f.failures, [[1, cancelAck === true]]);
        arm(true); f.ack("cancel", true);
        assert.equal(f.commits.length, 0); assert.equal(f.timers.size, 0);
    }
});
test("P3 obsolete ACKs and 5000 failed requests leave bounded callbacks", () => {
    const f = gateFixture();
    for (let i = 1; i <= 5000; i++) {
        f.setEpoch(i); f.schedule(); f.ack("membership", false); [...f.timers][0]();
        f.calls.length = 0; f.failures.length = 0;
        assert.equal(f.gate.disarming.size, 0); assert.equal(f.timers.size, 0);
    }
    f.setEpoch(5001); f.schedule(); f.ack("membership", true); f.ack("motion", true);
    const stale = f.calls.at(-1)[1]; f.setEpoch(5002); f.schedule(); stale(true);
    assert.equal(f.commits.length, 0);
    f.gate.cancel(); assert.equal(f.gate.pending, null);
    [...f.timers].forEach(cb => cb()); assert.equal(f.timers.size, 0);
});
test("P3 Native two-click focus intent is scoped to the latest JS epoch", () => {
    const r = mounted(), c = r.controller;
    const request = { sessionId: c.sessionId, workspaceId: "A", targetOutput: r.getPrimary().name,
        scopeRevision: c.scopeRevision, epoch: r.state.geometryGeneration, windowUuid: "b" };
    for (const patch of [{ sessionId: "old" }, { workspaceId: "B" }, { targetOutput: "other" },
        { scopeRevision: 0 }, { epoch: 0 }, { windowUuid: "missing" }])
        assert.equal(c.focusPartialRequest({ ...request, ...patch }), false);
    assert.equal(c.focusWindow(r.state.columns[1].window, "partial-input"), false);
    assert.equal(c.focusPartialRequest(request), true);
    assert.equal(r.state.focusedColumnIndex, 1);
    assert.equal(c.focusPartialRequest(request), false);
});

test("P3 RuntimeBridge preserves additive schema and scopes optional focus dispatch", () => {
    const { RuntimeBridge } = require("../src/kwin/integration/RuntimeBridge");
    const r = mounted(), calls = [];
    const bridge = new RuntimeBridge({ invoke: (...args) => calls.push(args), handlers: {},
        sessionId: r.controller.sessionId, protocol: 1, snapshotProtocol: 2,
        snapshotProvider: () => ({ columns: [] }), partialController: r.controller,
        service: "org.cc.CCNiriBridge", path: "/CCNiriBridge", interfaceName: "org.cc.CCNiriBridge1",
        debug: () => {}, warn: () => {} });
    const initial = produce(r.controller.lastTarget);
    bridge.publishMotionPlan(initial, () => {});
    assert.equal(JSON.parse(calls.at(-1)[4]).protocol, 3);
    bridge.publishMotionPlan({ type: "SCROLL" }, () => {});
    assert.equal(JSON.parse(calls.at(-1)[4]).protocol, 2);
    bridge.publishMotionPlan({ type: "PAIR_TO_WIDE" }, () => {});
    assert.equal(JSON.parse(calls.at(-1)[4]).protocol, 1);
    bridge.partialScrollCapability(() => {}); assert.equal(calls.at(-1)[3], "GetPartialScrollCapability");
    const command = { protocol: 1, type: "focus-partial-column", commandId: "first-click",
        sessionId: bridge.sessionId(), baseGeneration: 0, workspaceId: "A", targetOutput: r.getPrimary().name,
        scopeRevision: r.controller.scopeRevision, epoch: r.state.geometryGeneration, windowUuid: "b" };
    assert.equal(bridge.acceptPendingJson(JSON.stringify(command)), true);
    assert.equal(r.state.focusedColumnIndex, 1);
    assert.equal(bridge.acceptPendingJson(JSON.stringify(command)), false);
});
