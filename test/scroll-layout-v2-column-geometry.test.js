"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createV2Runtime } = require("./helpers/scroll-layout-v2-runtime");
const { createColumnGeometryPlan } = require("../src/kwin/layout/ColumnGeometryPlan");
const { ColumnGeometryClientGate } = require("../src/kwin/layout/ColumnGeometryClientGate");
const { ScrollPlanCommitGate } = require("../src/kwin/layout/ScrollPlanCommitGate");
const capability = { protocol: 4, type: "COLUMN_GEOMETRY", enabled: true,
    inputPolicy: "two-click", sourcePolicy: "painted-client-frames" };
const clone = value => JSON.parse(JSON.stringify(value));
function mounted(modes = ["half", "twoThirds", "full"]) {
    const r = createV2Runtime();
    r.mount(modes.map((widthMode, i) => ({ window: r.window(`a${i}`), widthMode })), {}, r.geometry(2560, 16, 50));
    return r;
}
function observation(r, camera) {
    const plan = r.controller.lastTarget;
    const sample = r.paint(camera);
    const a = plan.geometry.workingArea;
    return { protocol: 4, type: "COLUMN_GEOMETRY_SOURCE", sessionId: plan.sessionId,
        workspaceId: plan.workspaceId, targetOutput: plan.targetOutput, scopeRevision: plan.scopeRevision,
        epoch: sample.epoch, sampleSerial: sample.sampleSerial, cameraX: sample.cameraX,
        maxCamera: plan.maxCamera, viewport: { ...plan.geometry.outputRect },
        layoutRect: { x: a.x, y: a.y + plan.geometry.gap, width: a.width, height: a.height - 2 * plan.geometry.gap },
        entries: plan.entries.map(row => {
            const visualRect = sample.entries.find(e => e.uuid === row.uuid).visualRect;
            const frameRect = { ...visualRect, x: Math.max(0, Math.min(2560 - visualRect.width, visualRect.x)) };
            return { windowId: row.uuid, columnId: row.columnId, logicalX: row.logicalX,
                frameRect, visualRect: { ...visualRect }, acknowledged: true, owned: true, painted: true };
        }) };
}
const produce = (r, source, extra = {}) => createColumnGeometryPlan(r.controller.lastTarget,
    { capability, issuedAt: 10, observation: source, ...extra });
function widthPlan() {
    const r = mounted(), source = observation(r);
    r.controller.setWidth(r.state.columns[0], "twoThirds");
    const plan = produce(r, source);
    assert.ok(plan);
    return { r, source, plan };
}

test("P4 producer retains independent painted/client basis through a complete width cycle", () => {
    const r = mounted(["half"]);
    for (const mode of ["twoThirds", "full", "half"]) {
        const source = observation(r), old = clone(source.entries[0]);
        r.controller.setWidth(r.state.columns[0], mode);
        const plan = produce(r, source);
        assert.ok(plan); assert.equal(plan.type, "COLUMN_GEOMETRY"); assert.equal(plan.protocol, 4);
        assert.equal(plan.entries[0].oldPixelWidth, old.frameRect.width);
        assert.equal(plan.entries[0].newPixelWidth, r.state.columns[0].pixelWidth);
        assert.deepEqual(plan.entries[0].oldFrameRect, old.frameRect);
        assert.deepEqual(plan.entries[0].oldVisualRect, old.visualRect);
        assert.notEqual(plan.entries[0].oldPixelWidth, plan.entries[0].newPixelWidth);
        source.entries[0].frameRect.x = 2000;
        assert.deepEqual(plan.entries[0].oldFrameRect, old.frameRect, "wire contains owned numeric copies");
    }
});

test("P4 reorders and rapid R/H/L retain the last observed source, including camera above the new bound", () => {
    const r = mounted(), source = observation(r);
    r.controller.setWidth(r.state.columns[0], "twoThirds");
    r.controller.focusRelative(1); r.controller.moveFocused(1); r.controller.focusRelative(-1);
    const p = produce(r, source);
    assert.ok(p); assert.equal(p.sourceEpoch, source.epoch);
    assert.equal(p.oldScrollOffsetX, source.cameraX);
    assert.equal(p.entries.find(e => e.windowId === "a1").oldLogicalX, source.entries[1].logicalX);
    assert.notEqual(p.entries.find(e => e.windowId === "a1").newLogicalX, source.entries[1].logicalX);
    const far = mounted();
    far.controller.focusRelative(1); far.controller.focusRelative(1);
    const farSource = observation(far);
    far.controller.remove(far.state.columns[0].window);
    farSource.entries = farSource.entries.filter(e => e.windowId !== "a0");
    const shrunk = produce(far, farSource);
    assert.ok(shrunk); assert.ok(shrunk.oldScrollOffsetX > shrunk.maxCamera);
    assert.ok(shrunk.oldScrollOffsetX <= shrunk.oldMaxCamera);
});

test("P4 insertion requires a hidden unowned client's real frame, never a fabricated painted pose", () => {
    const r = mounted(["half", "twoThirds"]), source = observation(r);
    r.controller.adopt(r.window("new"), { index: 1, widthMode: "full" });
    assert.equal(produce(r, source), null);
    const row = r.controller.lastTarget.entries.find(e => e.uuid === "new");
    source.entries.push({ windowId: "new", columnId: row.columnId, acknowledged: true,
        owned: false, painted: false, hidden: true, visualRect: null,
        frameRect: { x: -4000, y: 100, width: 800, height: 600 } });
    const p = produce(r, source); assert.ok(p);
    const added = p.entries.find(e => e.windowId === "new");
    assert.equal(added.sourceKind, "parked"); assert.equal(added.oldLogicalX, null);
    assert.equal(added.oldVisualRect, null); assert.equal(added.oldPixelWidth, 800);
    for (const patch of [{ hidden: false }, { painted: true }, { acknowledged: false }, { visualRect: row.visualRect }]) {
        const s = clone(source); Object.assign(s.entries.at(-1), patch);
        assert.equal(produce(r, s), null);
    }
});

test("P4 long jumps include parked-only intermediate columns; every target frame stays in its output", () => {
    const r = mounted(["half", "twoThirds", "full", "half", "twoThirds", "full"]);
    const source = observation(r);
    r.controller.focusWindow(r.state.columns.at(-1).window);
    const p = produce(r, source); assert.ok(p);
    assert.equal(p.entries.length, 6);
    assert.ok(p.entries.some(e => e.oldPlacement === "parked" && e.newPlacement === "parked"));
    for (const row of p.entries) {
        const rect = row.committedTargetRect;
        assert.ok(rect.x >= p.viewport.x && rect.x + rect.width <= p.viewport.x + p.viewport.width);
        assert.equal(rect.width, row.newPixelWidth); assert.equal(rect.height, p.layoutRect.height);
    }
});

test("P4 panel basis changes retire the old scope and require safe rehydration", () => {
    const r = mounted(), source = observation(r);
    r.controller.setGeometry(r.geometry(2560, 24, 100, 1.5));
    assert.ok(r.controller.lastTarget.scopeRevision > source.scopeRevision);
    assert.equal(produce(r, source), null);
    r.controller.setGeometry(r.geometry(1920, 16, 50));
    assert.equal(produce(r, source), null);
});

test("P4 rejects stale/cross-scope/duplicate/nonfinite and unacknowledged source facts", () => {
    const { r, source } = widthPlan();
    for (const mutate of [
        s => { s.protocol = 3; }, s => { s.sessionId = "retired"; }, s => { s.workspaceId = "other"; },
        s => { s.targetOutput = "other"; }, s => { s.scopeRevision++; }, s => { s.epoch++; },
        s => { s.sampleSerial++; }, s => { s.cameraX = NaN; }, s => { s.maxCamera = Infinity; },
        s => { s.viewport.width++; }, s => { s.layoutRect.y++; }, s => { s.entries.pop(); },
        s => { s.entries[1] = s.entries[0]; }, s => { s.entries[0].columnId++; },
        s => { s.entries[0].windowId = "gone"; }, s => { s.entries[0].windowId = "{a0}"; },
        s => { s.entries[0].acknowledged = false; }, s => { s.entries[0].painted = false; },
        s => { s.entries[0].frameRect.width += 0.01; }, s => { s.entries[0].frameRect.x = -1; },
        s => { s.entries[0].visualRect.x++; }, s => { s.entries[0].logicalX = -1; },
    ]) { const bad = clone(source); mutate(bad); assert.equal(produce(r, bad), null, mutate.toString()); }
    for (const patch of [{ protocol: 3 }, { enabled: false }, { sourcePolicy: "camera-only" }, { inputPolicy: "inject" }])
        assert.equal(produce(r, source, { capability: { ...capability, ...patch } }), null);
    for (const mutate of [p => { p.epoch = -1; }, p => { p.entries.push(p.entries[0]); },
        p => { p.entries[0].pixelWidth = Infinity; }, p => { p.entries[1].columnId = p.entries[0].columnId; },
        p => { p.entries[1].logicalX = p.entries[0].logicalX; }, p => { p.entries[0].visualRect.x++; },
        p => { p.entries = Array(257).fill(p.entries[0]); }]) {
        const bad = clone(r.controller.lastTarget); mutate(bad);
        assert.equal(createColumnGeometryPlan(bad, { capability, issuedAt: 10, observation: source }), null);
    }
});

function gateFixture() {
    const { plan: envelope } = widthPlan();
    let epoch = envelope.epoch, serial = envelope.sourceSampleSerial + 1;
    const clients = new Map(envelope.entries.map(e => [e.windowId,
        { id: e.windowId, live: true, frame: { ...e.oldFrameRect }, listeners: new Set() }]));
    const timers = new Set(), calls = [], events = [], failures = [], completion = new Set();
    const clientGate = new ColumnGeometryClientGate({ isCurrent: e => e.epoch === epoch,
        resolve: id => clients.get(id), eligible: w => w.live, readFrame: w => w.frame,
        observeClient: (w, changed, closed) => {
            const listener = { changed, closed }; w.listeners.add(listener);
            return () => w.listeners.delete(listener);
        }, observeCompletion: (_, notify) => { completion.add(notify); return () => completion.delete(notify); } });
    let commitAction = () => {};
    const gate = new ScrollPlanCommitGate({ timeoutMs: 150, geometryTimeoutMs: 3500, columnGeometry: clientGate,
        currentEpoch: () => epoch, setTimer: (cb, ms) => { const t = { cb, ms }; timers.add(t); return t; },
        clearTimer: t => timers.delete(t), warn: () => {},
        prepare: (_, cb) => calls.push(["membership", cb]), publish: (_, cb) => calls.push(["motion", cb]),
        arm: (_, cb) => calls.push(["arm", cb]), disarm: (_, cb) => calls.push(["cancel", cb]),
        commit: () => { throw new Error("COLUMN_GEOMETRY must never use the legacy commit/focus callback"); },
        commitColumnGeometry: (p, c, mayCommit) => { events.push(["geometry", p.epoch, c, null]); commitAction(mayCommit); },
        activateColumnGeometry: (window, p) => events.push(["activate", p.epoch, window]),
        completeColumnGeometry: p => events.push(["park", p.epoch]),
        onColumnGeometryFailure: (p, _, result) => failures.push([p.epoch, result.cancelled]) });
    const ack = (name, result = true) => calls.findLast(c => c[0] === name)[1](result);
    const schedule = () => gate.schedule({ epoch }, { ...envelope, epoch }, {});
    const frame = (id, rect) => {
        const w = clients.get(id); w.frame = { ...rect }; [...w.listeners].forEach(l => l.changed());
    };
    const ackFrames = () => envelope.entries.forEach(e => frame(e.windowId, e.committedTargetRect));
    const paint = (patch = {}) => [...completion].forEach(fn => fn({ protocol: 4, type: "COLUMN_GEOMETRY_COMPLETION",
        sessionId: envelope.sessionId, workspaceId: envelope.workspaceId, targetOutput: envelope.targetOutput,
        scopeRevision: envelope.scopeRevision, epoch, sampleSerial: serial++, painted: true, completed: true, ...patch }));
    const arm = () => { schedule(); gate.deferActivation("a0"); ack("membership"); ack("motion"); ack("arm"); };
    const clean = () => {
        assert.equal(completion.size, 0); clients.forEach(w => assert.equal(w.listeners.size, 0));
        assert.equal(timers.size, 0); assert.equal(gate.pending, null);
    };
    return { gate, clientGate, envelope, clients, timers, calls, events, failures, ack, schedule, frame, ackFrames,
        paint, arm, clean, setEpoch: e => { epoch = e; }, setCommit: action => { commitAction = action; } };
}

test("P4 uses membership/motion/Native ACK before frame writes, client ACK and painted completion before focus/park", () => {
    for (const paintFirst of [true, false]) {
        const f = gateFixture(); f.schedule(); f.gate.deferActivation("a0");
        assert.equal(f.events.length, 0); f.ack("membership"); f.ack("motion");
        assert.equal(f.events.length, 0); f.ack("arm");
        assert.deepEqual(f.events.map(e => e[0]), ["geometry"]);
        assert.equal(f.events[0][2].deferActivation, true); assert.equal(f.events[0][3], null);
        if (paintFirst) f.paint(); else f.ackFrames();
        assert.equal(f.events.length, 1);
        if (paintFirst) {
            f.ackFrames();
            assert.equal(f.events.length,1,"frame mismatch revokes the premature completion proof");
            f.paint();
        } else f.paint();
        assert.deepEqual(f.events.map(e => e[0]), ["geometry", "activate", "park"]); f.clean();
    }
});

test("P4 subscriptions precede synchronous configure/paint ACK and release exactly once", () => {
    const f = gateFixture(); f.setCommit(() => { f.ackFrames(); f.paint(); }); f.arm();
    assert.deepEqual(f.events.map(e => e[0]), ["geometry", "activate", "park"]); f.clean();
    f.ack("arm"); f.paint(); assert.equal(f.events.length, 3);
});

test("P4 ignores wrong completion scopes, camera-only completion and near-but-unacknowledged widths", () => {
    const f = gateFixture(); f.arm(); f.ackFrames();
    for (const patch of [{ protocol: 3 }, { sessionId: "old" }, { workspaceId: "other" }, { targetOutput: "other" },
        { scopeRevision: 0 }, { epoch: 1 }, { completed: false }, { painted: false },
        { sampleSerial: f.envelope.sourceSampleSerial }, { sampleSerial: NaN }]) {
        f.paint(patch); assert.equal(f.events.length, 1);
    }
    const row = f.envelope.entries[0];
    f.frame(row.windowId, { ...row.committedTargetRect, width: row.committedTargetRect.width - 0.01 });
    f.paint(); assert.equal(f.events.length, 1);
    f.frame(row.windowId, row.committedTargetRect);
    assert.equal(f.events.length,1,"late exact ACK still needs a fresh real paint");f.paint();
    assert.deepEqual(f.events.map(e => e[0]), ["geometry", "activate", "park"]); f.clean();
});

test("P4 configure timeout, missing paint and closed client cancel without static writes or focus replay", () => {
    for (const reason of ["configure-timeout", "paint-timeout", "close"]) {
        const f = gateFixture(); f.arm();
        if (reason === "paint-timeout") f.ackFrames();
        if (reason === "close") {
            const w = f.clients.values().next().value; w.live = false; [...w.listeners].forEach(l => l.closed());
        } else [...f.timers].find(t => t.ms === 3500).cb();
        assert.equal(f.gate.activeEpoch, null);
        f.ack("cancel", true); f.ackFrames(); f.paint(); f.ack("arm");
        assert.deepEqual(f.events.map(e => e[0]), ["geometry"]);
        assert.deepEqual(f.failures, [[f.envelope.epoch, true]]); f.clean();
    }
});

test("P4 failed and void cancel ACK are not proof that Native ownership ended", () => {
    for (const cancelled of [false, undefined, null]) {
        const f = gateFixture(); f.arm(); [...f.timers][0].cb();
        f.calls.findLast(c => c[0] === "cancel")[1](cancelled);
        assert.deepEqual(f.failures, [[f.envelope.epoch, false]]);
        assert.deepEqual(f.events.map(e => e[0]), ["geometry"]); f.clean();
    }
});

test("P4 epoch replacement/workspace release/cancel detach every client and ignore old completions", () => {
    for (const release of ["releaseForWorkspace", "retainForLegacy", "cancel", "replace"]) {
        const f = gateFixture(); f.arm();
        const old = [...f.clients.values()].flatMap(w => [...w.listeners]);
        if (release === "replace") { f.setEpoch(f.envelope.epoch + 1); f.schedule(); }
        else f.gate[release]();
        old.forEach(l => l.changed()); f.ackFrames(); f.paint();
        assert.deepEqual(f.events.map(e => e[0]), ["geometry"]);
        f.gate.cancel(); [...f.timers].forEach(t => t.cb()); f.clean();
    }
});

test("P4 source changed before Native ACK and subscribe failure do not write geometry", () => {
    for (const reason of ["changed", "missing", "subscribe-throws", "reentrant-close", "reentrant-source"]) {
        const f = gateFixture(); f.schedule(); f.ack("membership"); f.ack("motion");
        if (reason === "changed") f.clients.get("a0").frame.width++;
        if (reason === "missing") f.clients.delete("a0");
        if (reason.startsWith("subscribe") || reason.startsWith("reentrant")) {
            const original = f.clientGate.observeClient;
            f.clientGate.observeClient = (w, changed, closed) => {
                if (reason === "subscribe-throws") throw new Error("disconnected");
                const dispose = original(w, changed, closed);
                if (reason === "reentrant-close") { w.live = false; closed(); }
                else { w.frame.width++; changed(); }
                return dispose;
            };
        }
        f.ack("arm"); f.ack("cancel");
        assert.deepEqual(f.events, [], reason); f.clean();
    }
});

test("P4 strictly boolean ACKs and duplicate membership/motion/arm callbacks cannot repeat a transaction", () => {
    for (const phase of ["membership", "motion", "arm"]) {
        const f = gateFixture(); f.schedule();
        if (phase !== "membership") f.ack("membership");
        if (phase === "arm") f.ack("motion");
        f.ack(phase, "true"); f.ack("cancel"); assert.equal(f.events.length, 0); f.clean();
    }
    const f = gateFixture(); f.schedule(); f.ack("membership"); f.ack("membership");
    f.ack("motion"); f.ack("motion"); f.ack("arm"); f.ack("arm");
    assert.deepEqual(f.calls.map(c => c[0]), ["membership", "motion", "arm"]);
    f.ackFrames(); f.paint(); assert.deepEqual(f.events.map(e => e[0]), ["geometry", "park"]); f.clean();
});

test("P4 the retired arm deadline cannot cancel a transaction waiting for configure/paint", () => {
    const f = gateFixture(); f.schedule(); const oldDeadline = [...f.timers][0];
    f.ack("membership"); f.ack("motion"); f.ack("arm");
    oldDeadline.cb(); assert.equal(f.calls.filter(c => c[0] === "cancel").length, 0);
    f.gate.deferActivation("a1"); f.ackFrames(); f.paint();
    assert.deepEqual(f.events.map(e => e[0]), ["geometry", "activate", "park"]);
    assert.equal(f.events[1][2], "a1"); f.clean();
});

test("P4 geometry exceptions and disconnected cancellation have a bounded lifetime", () => {
    const f = gateFixture(); f.setCommit(() => { throw new Error("client gone during configure"); }); f.arm();
    assert.equal(f.events.length, 1); assert.equal(f.gate.activeEpoch, null);
    [...f.timers][0].cb(); // Cancel endpoint never answers.
    assert.deepEqual(f.failures, [[f.envelope.epoch, false]]); f.clean();
    f.ack("cancel"); f.paint(); assert.equal(f.events.length, 1);
});

test("P4 a synchronous close during the real geometry writer prevents remaining batch writes", () => {
    const { GeometryCommitter } = require("../src/kwin/layout/GeometryCommitter");
    const f = gateFixture(), writes = [], states = new WeakMap();
    const writer = new GeometryCommitter({ stateFor: w => {
        if (!states.has(w)) states.set(w, {}); return states.get(w);
    }, sameRect: (a, b) => ["x", "y", "width", "height"].every(k => a[k] === b[k]),
    isTileMode: () => false, rectCopy: r => ({ ...r }), rectText: JSON.stringify, debug: () => {} });
    for (const w of f.clients.values()) Object.defineProperty(w, "frameGeometry", {
        get: () => w.frame, set: value => {
            writes.push(w.id); w.frame = { ...value };
            if (w.id === "a0") { w.live = false; [...w.listeners].forEach(l => l.closed()); }
        },
    });
    f.setCommit(mayCommit => {
        for (const e of f.envelope.entries)
            writer.commitGeometry({ window: f.clients.get(e.windowId) }, e.committedTargetRect,
                "column-geometry", mayCommit);
    });
    f.arm(); assert.deepEqual(writes, ["a0"]);
    f.ack("cancel"); assert.deepEqual(f.events.map(e => e[0]), ["geometry"]); f.clean();
});

test("P4 a scope change during activation cannot park the new workspace", () => {
    const f = gateFixture();
    f.gate.activateColumnGeometry = (window, p) => {
        f.events.push(["activate", p.epoch, window]); f.setEpoch(p.epoch + 1);
    };
    f.arm(); f.ackFrames(); f.paint();
    assert.deepEqual(f.events.map(e => e[0]), ["geometry", "activate"]); f.clean();
});

test("P4 a missing activation adapter cannot silently park instead of focusing", () => {
    const f = gateFixture(); f.gate.activateColumnGeometry = null;
    f.arm(); f.ackFrames(); f.paint(); f.ack("cancel");
    assert.deepEqual(f.events.map(e => e[0]), ["geometry"]);
    assert.deepEqual(f.failures, [[f.envelope.epoch, true]]); f.clean();
});

test("P4 2000 failed transactions leave no timers, client references or completion listeners", () => {
    const f = gateFixture();
    for (let i = 0; i < 2000; i++) {
        f.arm(); [...f.timers][0].cb(); f.ack("cancel", false); f.clean();
        f.calls.length = 0; f.events.length = 0; f.failures.length = 0;
    }
});

test("P4 requires an ACK driver; RuntimeBridge sends protocol4 without downgrade", () => {
    const f = gateFixture(); f.gate.columnGeometry = null; f.schedule();
    assert.deepEqual(f.calls.map(c => c[0]), ["cancel"]); f.ack("cancel"); f.clean();
    const { RuntimeBridge } = require("../src/kwin/integration/RuntimeBridge");
    const calls = [], results = [];
    const bridge = new RuntimeBridge({ invoke: (...args) => { calls.push(args); args.at(-1)(false); }, handlers: {}, sessionId: "s" });
    const published=bridge.publishMotionPlan(f.envelope, v => results.push(v));
    bridge.armScrollPlan(f.envelope, v => results.push(v));
    assert.equal(published.protocol,4);assert.equal(calls.length,2);
    assert.equal(JSON.parse(calls[0].at(-2)).protocol,4);
    assert.deepEqual(results,[false,false]); // older endpoint rejection is final
    bridge.publishMotionPlan({...f.envelope,protocol:3},v=>results.push(v));
    bridge.armScrollPlan({...f.envelope,protocol:3},v=>results.push(v));
    assert.equal(calls.length,2);assert.deepEqual(results,[false,false,false,false]);
});
