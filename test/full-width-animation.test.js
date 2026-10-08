"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const { CCNiriScrollTransition } = require("../effect/contents/code/main.js");
const globals = ["effects", "effect", "Effect", "QEasingCurve", "animationTime", "animate", "cancel", "set", "freezeInTime"];
const previous = new Map(globals.map(name => [name, global[name]]));
const realNow = Date.now;
let now = 10000, nextId = 1;
function signal() {
    const handlers = [];
    return { connect: fn => handlers.push(fn), emit: (...args) => handlers.forEach(fn => fn(...args)) };
}
function near(a, b, label) {
    for (const field of ["x", "y", "width", "height", "opacity"]) {
        if (a[field] !== undefined && b[field] !== undefined)
            assert.ok(Math.abs(a[field] - b[field]) < .001, `${label} ${field}: ${a[field]} / ${b[field]}`);
    }
}
function fixture(side = 0, solo = false) {
    const r = createRuntime({ HoldWidthAck: true, HoldNativeAck: true });
    r.evaluate("Date").now = () => now;
    if (solo) r.a.slice(1).forEach(window => r.close(window));
    r.workspace.activeWindow = r.a[side];
    const calls = [];
    global.Effect = { Translation: 1, Scale: 2, Opacity: 3, Generic: 4, Shader: 5,
        Left: 6, Right: 7, Top: 8, Bottom: 9, WindowMinimizedGrabRole: 10, WindowUnminimizedGrabRole: 11 };
    global.QEasingCurve = { OutCubic: 1, Linear: 2 };
    global.animationTime = value => value;
    global.effect = { configChanged: signal(), animationEnded: signal(), readConfig: (_key, value) => value,
        grab: () => true, ungrab: () => true };
    global.effects = { stackingOrder: [], desktopChanged: signal(), windowDataChanged: signal(),
        windowAdded: signal(), windowClosed: signal(), hasActiveFullScreenEffectChanged: signal(),
        hasActiveFullScreenEffect: false, addRepaintFull() {} };
    global.animate = request => { calls.push(request); return [nextId++]; };
    global.set = global.animate;
    global.cancel = () => {};
    global.freezeInTime = () => true;
    const windows = new Map();
    for (const window of [...r.a, ...r.b]) {
        const data = new Map([[1002, true]]);
        const ew = { id: window.internalId, screen: r.output, get geometry() { return window.frameGeometry; },
            onCurrentDesktop: window.desktops[0].id === "A", windowFrameGeometryChanged: signal(),
            data: role => data.get(role),
            setData(role, value) { data.set(role, value); effects.windowDataChanged.emit(this, role); } };
        windows.set(window, ew);
        window.frameGeometryChanged.connect(old => ew.windowFrameGeometryChanged.emit(ew, old));
        effects.stackingOrder.push(ew);
    }
    const transition = new CCNiriScrollTransition();
    const target = windows.get(r.a[side]);
    let nativeAcked = 0;
    function ackNative() {
        while (nativeAcked < r.nativeArms.length) {
            const index = nativeAcked++, plan = r.nativeArms[index];
            for (const ew of windows.values()) { ew.setData(1006, true); ew.setData(1005, null); }
            for (const entry of plan.entries) {
                const ew = [...windows.values()].find(value => value.id === entry.windowId);
                const role = entry.newPlacement === "parked" ? "outgoing"
                    : entry.oldPlacement === "parked" ? "incoming" : "continuing";
                ew.setData(1005, { ...plan, role,
                    x: plan.viewport.x + entry.logicalX - plan.newScrollOffsetX,
                    y: plan.viewport.y, width: entry.pixelWidth, height: plan.viewport.height });
            }
            r.nativeAcks[index](true);
        }
    }
    function ack(clip = true) {
        const plan = r.motionPlans.at(-1);
        for (const ew of windows.values()) ew.setData(1003, null);
        for (const entry of plan.entries) {
            const ew = [...windows.values()].find(value => value.id === entry.windowId);
            ew.setData(1003, { ...plan, ...entry });
        }
        r.motionAcks.at(-1)(true);
        if (clip) ackNative();
        return plan;
    }
    function toggle(clip = true) {
        r.shortcuts.get("CCScrollCycleColumnWidth")();
        assert.ok(r.evaluate("motionPlanCommitGate.pending"));
        return ack(clip);
    }
    function finish() {
        now += 220;
        for (const [ew, state] of [...transition.motion.states])
            for (const id of [...state.animationIds]) effect.animationEnded.emit(ew, id);
        const pending = r.evaluate("contextualWideCoordinator.pendingPark");
        if (pending) r.evaluate("contextualWideCoordinator").finalizePark({
            transitionToken: pending.token, commandId: pending.commandId, motionCompleted: true });
    }
    const sample = ew => transition.motion.visualSnapshot(ew, ew.geometry, now);
    return { r, windows, transition, target, calls, ack, ackNative, toggle, finish, sample };
}
try {
    Date.now = () => now;
    for (const side of [0, 1]) {
        const h = fixture(side);
        const old = { ...h.target.geometry };
        const oldNeighbor = h.windows.get(h.r.a[1 - side]);
        const neighborRect = { ...oldNeighbor.geometry };
        const writes = h.r.writes();
        h.r.shortcuts.get("CCScrollCycleColumnWidth")();
        assert.equal(h.r.writes(), writes, "publish before any real resize or parking");
        const plan = h.ack();
        assert.equal(plan.protocol, 1);
        assert.equal(plan.type, "PAIR_TO_WIDE");
        assert.equal(plan.entries.length, 2);
        assert.equal(h.r.state.viewport.mode, "pair", "Full is column width, not contextual Wide authority");
        near(h.sample(h.target), old, "expansion begins at actual pair frame");
        near(h.sample(oldNeighbor), neighborRect, "outgoing begins at real neighbor");
        assert.equal(h.r.a[1 - side].minimized, false, "retain real neighbor until completion");
        for (const step of [0, 16, 55, 110, 200]) {
            now = h.transition.motion.states.get(h.target).startTime + step;
            const target = h.sample(h.target), neighbor = h.sample(oldNeighbor);
            const gap = side ? target.x - neighbor.x - neighbor.width : neighbor.x - target.x - target.width;
            assert.ok(Math.abs(gap - 8) < .001, `shared timeline keeps 8px gap on side ${side} at ${step}`);
            assert.equal(h.r.a[1 - side].minimized, false);
        }
        h.r.add("editor-popup", 0, { normalWindow: false, transient: true });
        assert.equal(h.r.a[1 - side].minimized, false, "editor transient cannot retire the animation neighbor");
        h.finish();
        assert.equal(h.r.a[1 - side].minimized, true);
        assert.equal(h.target.geometry.width, 2512);
        const returning = h.toggle();
        assert.equal(returning.type, "WIDE_TO_PAIR");
        assert.equal(h.transition.motion.states.get(h.target).duration, 220);
        const neighborEntry = returning.entries.find(entry => entry.role === "neighbor");
        const incoming = [...h.windows.values()].find(ew => ew.id === neighborEntry.windowId);
        assert.equal(h.transition.motion.states.get(incoming).role, "incoming");
        const start = h.transition.motion.states.get(h.target).startTime;
        for (const step of [0, 16, 55, 110, 200]) {
            now = start + step;
            const target = h.sample(h.target), neighbor = h.sample(incoming);
            const gap = returning.side === "right" ? target.x - neighbor.x - neighbor.width
                : neighbor.x - target.x - target.width;
            assert.ok(Math.abs(gap - 8) < .001, "return uses existing synchronized Wide timeline");
        }
        h.finish();
        assert.equal(h.r.evaluate("invariantChecker.errors().length"), 0);
        // Retarget across a changed frame width AND a changed scale anchor.
        for (let i = 0; i < 10; i++) {
            now += 31;
            const painted = h.sample(h.target);
            h.toggle();
            near(h.sample(h.target), painted, "rapid resize preserves painted frame");
        }
        h.finish();
        assert.equal(h.target.geometry.width, 1252);
        assert.ok(h.calls.every(call => call.animations.every(spec => [1, 2, 3, 5].includes(spec.type))),
            "reuse paint-only Scale/Translation/Opacity, no Position/Size animation");
    }
    const partial = fixture(); partial.r.a.slice(2).forEach(w => partial.r.close(w));
    partial.toggle(); partial.finish();
    partial.r.shortcuts.get("CCScrollFocusNextColumn")();
    partial.ackNative();
    partial.r.shortcuts.get("CCScrollCycleColumnWidth")(); partial.ack(); partial.finish();
    partial.r.shortcuts.get("CCScrollCycleColumnWidth")();
    const partialReturn = partial.ack();
    assert.ok(partialReturn.transitionToken, "partial return has a scoped completion token");
    partial.finish();
    const completion = partial.windows.get(partial.r.a[1]).data(1004);
    assert.equal(completion.type, "WIDE_TO_PAIR", "actual continuing target end reports partial handoff");
    assert.equal(completion.transitionToken, partialReturn.transitionToken);
    partial.r.evaluate("contextualWideCoordinator").finalizeExit({
        transitionToken: completion.transitionToken, motionCompleted: true });
    assert.equal(partial.r.a[0].minimized, false, "actual effect completion restores Full neighbor");
    partial.ackNative();
    partial.r.shortcuts.get("CCScrollToggleFocusWide")(); partial.ack(); partial.finish();
    partial.r.shortcuts.get("CCScrollToggleFocusWide")(); partial.ack();
    const wideTarget = partial.windows.get(partial.r.a[1]);
    const fullNeighbor = partial.windows.get(partial.r.a[0]);
    assert.equal(partial.transition.motion.states.get(fullNeighbor).role, "incoming",
        "contextual Wide return reuses the same Full incoming animation");
    for (const step of [0, 55, 110, 200]) {
        now = partial.transition.motion.states.get(wideTarget).startTime + step;
        const target = partial.sample(wideTarget), neighbor = partial.sample(fullNeighbor);
        assert.ok(Math.abs(target.x - neighbor.x - neighbor.width - 8) < .001,
            "contextual Wide and Full neighbor share the existing timeline");
    }
    partial.finish();
    for (const side of [0, 1]) {
        const h = fixture(side);
        h.r.a.slice(2).forEach(w => h.r.close(w));
        h.r.evaluate("mainScreenState.columns.forEach(c => c.widthMode = 'full'); recomputeLogicalLayout(); ensureColumnVisible(columnStore.focusedColumn()); relayout('both-full-animation-fixture');");
        h.finish();
        const neighbor = h.windows.get(h.r.a[1 - side]);
        assert.equal(h.r.a[1 - side].minimized, true);
        const epoch = h.r.evaluate("layoutTransaction.currentEpoch()");
        h.toggle();
        const motion = h.transition.motion.states.get(neighbor);
        assert.ok(motion && motion.role === "incoming", "Full neighbor joins the shrinking target before completion");
        assert.equal(h.r.a[1 - side].minimized, false);
        assert.equal(h.r.workspace.activeWindow, h.r.a[side]);
        assert.equal(h.r.nativeArms.at(-1).clipPartial, true);
        assert.equal(h.r.nativeArms.at(-1).epoch, epoch + 1, "clip and width motion share one epoch");
        assert.equal(neighbor.data(1001).enabled, true, "Native clip retains the Script paint transform");
        for (const step of [0, 16, 55, 110, 200]) {
            now = h.transition.motion.states.get(h.target).startTime + step;
            const target = h.sample(h.target), incoming = h.sample(neighbor);
            const gap = side ? target.x - incoming.x - incoming.width : incoming.x - target.x - target.width;
            assert.ok(Math.abs(gap - 8) < .001, `Full incoming shares 8px gap on side ${side} at ${step}`);
            assert.equal(incoming.width, 2512, "Full neighbor retains its own width");
        }
        assert.ok(h.sample(neighbor).opacity > 0 && h.sample(neighbor).opacity < 1);
        now = h.transition.motion.states.get(h.target).startTime + 70;
        const targetPose = h.sample(h.target), neighborPose = h.sample(neighbor);
        h.toggle();
        near(h.sample(h.target), targetPose, "partial return reverses from the painted target");
        near(h.sample(neighbor), neighborPose, "partial Full incoming reverses without a flash");
        h.finish();
        assert.equal(h.r.evaluate("invariantChecker.errors().length"), 0);
    }
    // Settled half/Full -> Full/Full used to disarm clipping before the legacy
    // publish ACK, exposing the real Full frame on an adjacent output.
    for (const side of [0, 1]) {
        const h = fixture(side);
        h.r.a.slice(2).forEach(w => h.r.close(w));
        h.r.evaluate("mainScreenState.columns.forEach(c => c.widthMode = 'full'); recomputeLogicalLayout(); ensureColumnVisible(columnStore.focusedColumn()); relayout('full-handoff-fixture');");
        h.finish(); h.toggle(); h.finish();
        const exit = h.r.evaluate("contextualWideCoordinator.pendingExit");
        h.r.evaluate("contextualWideCoordinator").finalizeExit({ transitionToken: exit.token, motionCompleted: true });
        h.ackNative();
        const neighbor = h.windows.get(h.r.a[1 - side]);
        assert.equal(neighbor.geometry.width, 2512);
        assert.equal(neighbor.data(1001), null, "settled neighbor has no Script animation clip");
        const cancellations = h.r.nativeCancels.length, writes = h.r.writes();
        h.r.shortcuts.get("CCScrollCycleColumnWidth")();
        assert.equal(h.r.nativeCancels.length, cancellations, "old clip survives delayed legacy publish ACK");
        assert.equal(h.r.writes(), writes);
        const plan = h.ack(false);
        assert.equal(plan.type, "PAIR_TO_WIDE");
        assert.ok(h.r.nativeCancels.length > cancellations, "retire old clip only after Native legacy marker is installed");
        assert.equal(h.r.writes(), writes, "delayed new Native ACK keeps the old real Full surface unchanged");
        h.ackNative();
        assert.equal(h.transition.motion.states.get(neighbor).role, "outgoing");
        assert.equal(neighbor.data(1001).enabled, true);
        assert.equal(neighbor.data(1001).transactionEpoch, plan.epoch);
        assert.equal(h.r.workspace.activeWindow, h.r.a[side]);
        for (const step of [0, 16, 55, 110, 200]) {
            now = h.transition.motion.states.get(h.target).startTime + step;
            const target = h.sample(h.target), outgoing = h.sample(neighbor);
            const gap = side ? target.x - outgoing.x - outgoing.width : outgoing.x - target.x - target.width;
            assert.ok(Math.abs(gap - 8) < .001, "outgoing Full keeps the existing shared animation");
        }
        h.finish();
        assert.equal(h.r.a[1 - side].minimized, true);
        assert.equal(h.r.evaluate("invariantChecker.errors().length"), 0);
    }
    const departure = fixture(); departure.r.a.slice(2).forEach(w => departure.r.close(w));
    departure.r.evaluate("mainScreenState.columns.forEach(c => c.widthMode = 'full'); recomputeLogicalLayout(); ensureColumnVisible(columnStore.focusedColumn()); relayout('both-full-departure');");
    departure.finish(); departure.toggle(); now += 70;
    const arriving = departure.windows.get(departure.r.a[1]);
    const poses = [departure.sample(departure.target), departure.sample(arriving)];
    effects.hasActiveFullScreenEffect = true;
    departure.r.nativeSwitch(1, departure.r.b[0]);
    for (const [window, ew] of departure.windows) ew.onCurrentDesktop = window.desktops[0].id === "B";
    effects.desktopChanged.emit(null, null, null, departure.r.output);
    now += 100;
    near(departure.sample(departure.target), poses[0], "J/K freezes shrinking Full target");
    near(departure.sample(arriving), poses[1], "J/K freezes the incoming Full neighbor");
    effects.hasActiveFullScreenEffect = false; effects.hasActiveFullScreenEffectChanged.emit();
    assert.equal(departure.transition.motion.states.size, 0);
    for (const side of [0, 1]) {
        const h = fixture(side); h.r.a.slice(2).forEach(w => h.r.close(w));
        h.r.evaluate("mainScreenState.columns.forEach(c => c.widthMode = 'full'); recomputeLogicalLayout(); ensureColumnVisible(columnStore.focusedColumn()); relayout('both-full-delayed-ack');");
        h.finish();
        const neighbor = h.windows.get(h.r.a[1 - side]);
        const writes = h.r.writes();
        h.r.holdGeometry(h.r.a[side]);
        h.toggle(false);
        assert.equal(h.r.writes(), writes, "Legacy publication waits for Native clip ACK before resize");
        assert.equal(h.r.a[1 - side].minimized, true);
        h.ackNative();
        assert.equal(h.r.a[1 - side].minimized, true, "neighbor waits for the target's actual half frame");
        now += 55;
        h.r.flushGeometry(h.r.a[side]);
        assert.equal(h.r.a[1 - side].minimized, false, "target geometry ACK joins the same epoch without waiting for animation end");
        assert.equal(h.transition.motion.states.get(neighbor).role, "incoming");
        for (const step of [0, 55, 110, 200]) {
            now = h.transition.motion.states.get(h.target).startTime + step;
            const target = h.sample(h.target), incoming = h.sample(neighbor);
            const gap = side ? target.x - incoming.x - incoming.width : incoming.x - target.x - target.width;
            assert.ok(Math.abs(gap - 8) < .001, `delayed Full return keeps shared gap on side ${side}`);
        }
        h.finish();
        assert.equal(h.r.evaluate("invariantChecker.errors().length"), 0);
    }
    const solo = fixture(0, true);
    const initial = { ...solo.target.geometry };
    const enter = solo.toggle();
    assert.equal(enter.entries.length, 1, "single column needs no fake neighbor");
    near(solo.sample(solo.target), initial, "solo expansion animates");
    solo.finish(); solo.toggle();
    assert.equal(solo.transition.motion.states.get(solo.target).type, "WIDE_TO_PAIR");
    solo.finish();
    // Already matching geometry must still reverse an existing paint animation.
    const noGeometry = fixture(); noGeometry.toggle(); now += 70;
    const pose = noGeometry.sample(noGeometry.target);
    noGeometry.r.holdGeometry(noGeometry.r.a[0]);
    noGeometry.toggle(); // Shrink configure is still pending: real frame stays Full.
    const before = noGeometry.sample(noGeometry.target);
    noGeometry.toggle(); // Expand supersedes that configure with the current Full frame.
    near(noGeometry.sample(noGeometry.target), before, "no-geometry retarget keeps visual pose");
    noGeometry.r.flushGeometry(noGeometry.r.a[0]); noGeometry.finish();
    assert.equal(noGeometry.target.geometry.width, 2512);
    assert.ok(pose.width > 1252 && pose.width < 2512);
    // J/K uses the existing frozen Wide pose and compositor-idle parking gate.
    for (const side of [0, 1]) {
        const h = fixture(side); h.toggle(); now += 70;
        const neighbor = h.windows.get(h.r.a[1 - side]);
        const targetPose = h.sample(h.target), neighborPose = h.sample(neighbor);
        effects.hasActiveFullScreenEffect = true;
        h.r.nativeSwitch(1, h.r.b[0]);
        for (const [window, ew] of h.windows) ew.onCurrentDesktop = window.desktops[0].id === "B";
        effects.desktopChanged.emit(null, null, null, h.r.output);
        now += 100;
        near(h.sample(h.target), targetPose, "workspace freezes Full target");
        near(h.sample(neighbor), neighborPose, "workspace freezes outgoing neighbor");
        assert.equal(h.r.a[1 - side].minimized, false);
        const departure = [...h.r.evaluate("contextualWideCoordinator.departures")][0];
        assert.ok(departure, "reuse compositor-idle departure handoff for Full");
        h.r.setWorkspaceTransitionActive(true); departure.timer.callback();
        assert.equal(h.r.a[1 - side].minimized, false);
        h.r.setWorkspaceTransitionActive(false); departure.timer.callback();
        assert.equal(h.r.a[1 - side].minimized, true);
        effects.hasActiveFullScreenEffect = false; effects.hasActiveFullScreenEffectChanged.emit();
        assert.equal(h.transition.motion.states.size, 0);
        assert.equal(h.r.evaluate("invariantChecker.errors().length"), 0);
    }
} finally {
    Date.now = realNow;
    for (const [name, value] of previous) {
        if (value === undefined) delete global[name]; else global[name] = value;
    }
}
console.log("PASS Full reuses Pair/Wide transactions: ACK ordering, 8px gap, solo, retarget, Wayland ACK and workspace freeze/parking");
