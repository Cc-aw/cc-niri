"use strict";
const assert = require("node:assert/strict");
const { CCNiriScrollTransition, MotionType } = require("../effect/contents/code/main.js");
function signal() {
    const handlers = new Set();
    return { connect: fn => handlers.add(fn), emit: (...args) => [...handlers].forEach(fn => fn(...args)) };
}
const screen = { name: "eDP-1", geometry: { x: 0, y: 0, width: 1920, height: 1080 } };
const other = { name: "HDMI-1", geometry: { x: 1920, y: 0, width: 1920, height: 1080 } };
function windowFor(x) {
    const data = new Map([[1002, true]]);
    const writes = [];
    return { screen, onCurrentDesktop: true, geometry: { x, y: 50, width: 932, height: 960 },
        windowFrameGeometryChanged: signal(), data: role => data.get(role),
        setData: (role, value) => { data.set(role, value); writes.push([role, value]); }, writes };
}
const a = windowFor(24); const b = windowFor(964); const orphan = windowFor(-4000);
const windows = [a, b, orphan];
let nextId = 1; let repaintCount = 0; let now = 1000;
const animations = new Map(); const cancelled = [];
const realNow = Date.now;
const names = ["effects", "effect", "Effect", "QEasingCurve", "animationTime", "animate", "cancel", "set"];
const previous = new Map(names.map(name => [name, global[name]]));
try {
    Date.now = () => now;
    global.effects = { stackingOrder: windows, desktopChanged: signal(), windowAdded: signal(), windowClosed: signal(),
        addRepaintFull: () => ++repaintCount };
    global.effect = { configChanged: signal(), animationEnded: signal(), readConfig: (_key, fallback) => fallback,
        grab: () => true, ungrab: () => true };
    global.Effect = { Translation: 1, Scale: 2, Opacity: 3, Generic: 4, Shader: 5,
        Left: 6, Right: 7, Top: 8, Bottom: 9, WindowMinimizedGrabRole: 10, WindowUnminimizedGrabRole: 11 };
    global.QEasingCurve = { OutCubic: 1, Linear: 2 };
    global.animationTime = duration => duration;
    global.animate = global.set = request => { const id = nextId++; animations.set(id, request.window); return [id]; };
    global.cancel = ids => {
        cancelled.push(...ids);
        // KWin can emit an identity-free completion synchronously on cancel.
        for (const id of ids) global.effect.animationEnded.emit(animations.get(id) || b, 0);
    };
    const transition = new CCNiriScrollTransition();
    function start(window, type = MotionType.SCROLL) {
        return transition.motion.start(window, { type, role: "outgoing", transactionEpoch: 16,
            viewport: { x: 24, y: 50, width: 1872, height: 960 }, duration: 220,
            oldGeometry: window.geometry, newGeometry: window.geometry,
            channels: [{ type: Effect.Translation, from: { value1: 0, value2: 0 }, to: { value1: -940, value2: 0 } }] });
    }
    const oldA = start(a); start(b, MotionType.PAIR_TO_WIDE);
    a.setData(1003, { type: MotionType.PAIR_TO_WIDE });
    b.setData(1003, { type: MotionType.PAIR_TO_WIDE, role: "neighbor", epoch: 16,
        transitionToken: "old-token", sessionId: "old-session", targetWindowUuid: "old-target" });
    transition.motionTransaction.begin({ type: MotionType.WIDE_TO_PAIR, deltaX: 940 });
    transition.pendingWideExit = { transactionId: 1 };
    transition.holdWideIsolation(b); transition.parkingGrabber.grab(a, "test"); transition.parkingGrabber.grab(b, "test");
    orphan.ccNiriIncomingVisual = { x: -1 }; orphan.ccNiriScrollAnimation = [999];
    effects.desktopChanged.emit({ id: "A" }, { id: "B" }, null, other);
    assert.equal(transition.motion.states.size, 2, "unrelated output leaves primary motion intact");
    effects.desktopChanged.emit({ id: "A" }, { id: "B" }, null, screen);
    assert.equal(transition.workspaceGuard.epoch, 1);
    assert.equal(transition.motion.states.size, 0); assert.equal(transition.motionTransaction.activeTransaction, null);
    assert.equal(transition.pendingWideExit, null); assert.equal(transition.wideIsolationHolds.size, 0);
    assert.equal(transition.parkingGrabber.grabbedWindows.size, 0); assert.ok(repaintCount > 0);
    assert.ok(cancelled.includes(999), "orphaned animation IDs are cancelled too");
    for (const window of windows) {
        assert.equal(window.data(1001), null); assert.equal(window.data(1003), null); assert.equal(window.data(1004), null);
        assert.equal(window.data(1002), true, "native clip capability survives cleanup");
        assert.equal(window.ccNiriIncomingVisual, undefined); assert.equal(window.ccNiriScrollAnimation, undefined);
        assert.ok(!window.writes.some(([role, value]) => role === 1004 && value), "cancel cannot emit a stale Wide completion");
    }
    effect.animationEnded.emit(a, oldA.animationIds[0]); effect.animationEnded.emit(b, 0);
    assert.equal(transition.wideIsolationHolds.size, 0);
    const fresh = start(a);
    effect.animationEnded.emit(a, oldA.animationIds[0]); effect.animationEnded.emit(a, 0);
    assert.equal(transition.motion.states.get(a), fresh, "late old IDs and early group callback cannot finish new motion");
    now += 220; effect.animationEnded.emit(a, 0);
    assert.equal(transition.motion.states.size, 0, "new animation completes at its own duration");
    b.onCurrentDesktop = false;
    const before = animations.size;
    transition.geometryChanged(b, { ...b.geometry, x: 24 });
    assert.equal(animations.size, before, "sleeping desktop geometry does not restart motion");
    assert.equal(transition.pairNeighbor(a, a.geometry, "left"), null, "Wide cannot select a sleeping neighbor");
    b.onCurrentDesktop = true;
    transition.geometryChanged(a, { ...a.geometry, x: 964 });
    assert.ok(transition.motion.states.has(a), "H/L animation remains available after switching");
    effects.desktopChanged.emit({ id: "B" }, { id: "A" }, null, screen);
    effects.desktopChanged.emit({ id: "A" }, { id: "B" }, null, screen);
    assert.equal(transition.workspaceGuard.epoch, 3); assert.equal(transition.motion.states.size, 0);
} finally {
    Date.now = realNow;
    for (const [name, value] of previous) { if (value === undefined) delete global[name]; else global[name] = value; }
}
console.log("PASS production Effect workspace cleanup, stale callbacks, sleeping windows and animation restart");
