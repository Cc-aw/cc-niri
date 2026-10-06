"use strict";

const assert = require("node:assert/strict");
const { CCNiriScrollTransition, MotionType } = require("../effect/contents/code/main.js");
const { widePairMotionSnapshot } = require("../src/effect/WideMotionGeometry");
function signal() {
    const handlers = new Set();
    return { connect: fn => handlers.add(fn), emit: (...args) => [...handlers].forEach(fn => fn(...args)) };
}
const screen = { name: "eDP-1", geometry: { x: 0, y: 0, width: 1920, height: 1080 } };
const left = { x: 24, y: 50, width: 932, height: 960 }, right = { ...left, x: 964 };
const wide = { x: 286, y: 50, width: 1348, height: 960 };
const globals = ["effects", "effect", "Effect", "QEasingCurve", "animationTime", "animate", "cancel", "set", "freezeInTime"];
const previous = new Map(globals.map(name => [name, global[name]]));
const realNow = Date.now;
let now = 1000, nextId = 1;
function fixture(side) {
    const animations = new Map(), frozen = new Map(), cancelled = [];
    function windowFor(id, rect) {
        const roles = new Map([[1002, true]]);
        return { id, screen, geometry: { ...rect }, onCurrentDesktop: true,
            windowFrameGeometryChanged: signal(), data: role => roles.get(role),
            setData(role, value) { roles.set(role, value); effects.windowDataChanged.emit(this, role); } };
    }
    const pair = side === "left" ? left : right;
    const target = windowFor("target", pair), neighbor = windowFor("neighbor", side === "left" ? right : left);
    global.effects = { stackingOrder: [target, neighbor], desktopChanged: signal(), windowDataChanged: signal(),
        windowAdded: signal(), windowClosed: signal(), hasActiveFullScreenEffectChanged: signal(),
        hasActiveFullScreenEffect: false, addRepaintFull() {} };
    global.effect = { configChanged: signal(), animationEnded: signal(), readConfig: (_key, value) => value,
        grab: () => true, ungrab: () => true };
    global.Effect = { Translation: 1, Scale: 2, Opacity: 3, Generic: 4, Shader: 5, Left: 6, Right: 7,
        Top: 8, Bottom: 9, WindowMinimizedGrabRole: 10, WindowUnminimizedGrabRole: 11 };
    global.QEasingCurve = { OutCubic: 1, Linear: 2 };
    global.animationTime = value => value;
    global.animate = global.set = request => { const id = nextId++; animations.set(id, request); return [id]; };
    global.cancel = ids => {
        for (const id of ids) { cancelled.push(id); frozen.delete(id); effect.animationEnded.emit(animations.get(id).window, 0); }
    };
    global.freezeInTime = (id, elapsed) => { frozen.set(id, elapsed); return true; };
    const transition = new CCNiriScrollTransition();
    const snapshot = widePairMotionSnapshot(MotionType.PAIR_TO_WIDE, wide, pair, side, 8);
    const entries = [{ ...snapshot.target, role: "target", windowId: "target" },
        { ...snapshot.neighbor, role: "neighbor", windowId: "neighbor" }];
    const common = { type: MotionType.PAIR_TO_WIDE, epoch: 1, issuedAt: now, side, entries,
        sessionId: "s", transitionToken: "1", targetWindowUuid: "target" };
    target.setData(1003, { ...common, ...entries[0] });
    neighbor.setData(1003, { ...common, ...entries[1] });
    target.geometry = { ...wide };
    target.windowFrameGeometryChanged.emit(target, pair);
    return { transition, target, neighbor, frozen, cancelled };
}
try {
    Date.now = () => now;
    for (const side of ["left", "right"]) for (const interruption of [20, 80, 180]) {
        const h = fixture(side);
        now += interruption;
        const windows = [h.target, h.neighbor];
        const pose = windows.map(w => h.transition.motion.visualSnapshot(w, w.geometry, now));
        const ids = windows.flatMap(w => h.transition.motion.states.get(w).animationIds);
        assert.ok(pose[0].width < wide.width && pose[0].width > left.width);
        assert.ok(pose[1].opacity > 0 && pose[1].opacity < 1);
        effects.hasActiveFullScreenEffect = true;
        windows.forEach(w => { w.onCurrentDesktop = false; });
        effects.desktopChanged.emit({ id: "A" }, { id: "B" }, null, screen);
        assert.equal(h.frozen.size, ids.length, "freeze existing KWin channels instead of cancelling to 72%");
        assert.deepEqual(h.cancelled, [], "source pose survives the first Slide frame");
        now += 1000;
        windows.forEach((w, index) => {
            assert.deepEqual(h.transition.motion.visualSnapshot(w, w.geometry, now), pose[index],
                "width, position and neighbor opacity stay at the interrupted sample while Slide runs");
            effect.animationEnded.emit(w, 0);
            assert.equal(w.data(1004), null, "frozen/stale completion cannot publish a Wide completion");
            assert.equal(h.transition.workspaceGuard.canAnimate(w), false);
        });
        effects.hasActiveFullScreenEffect = false;
        effects.hasActiveFullScreenEffectChanged.emit();
        assert.equal(h.transition.motion.states.size, 0);
        assert.equal(h.frozen.size, 0, "release all frozen channels after Slide ends");
        windows.forEach(w => { assert.equal(w.data(1001), null); assert.equal(w.data(1003), null); });
    }
    const returned = fixture("right");
    now += 80;
    effects.hasActiveFullScreenEffect = true;
    returned.target.onCurrentDesktop = returned.neighbor.onCurrentDesktop = false;
    effects.desktopChanged.emit({ id: "A" }, { id: "B" }, null, screen);
    returned.target.onCurrentDesktop = returned.neighbor.onCurrentDesktop = true;
    effects.desktopChanged.emit({ id: "B" }, { id: "A" }, null, screen);
    assert.equal(returned.transition.motion.states.size, 0, "rapid return retires the departing pose before a new mount");
    assert.equal(returned.frozen.size, 0);
} finally {
    Date.now = realNow;
    for (const [name, value] of previous) { if (value === undefined) delete global[name]; else global[name] = value; }
}
console.log("PASS Wide workspace departure preserves intermediate target/neighbor pose, Slide lifetime, stale completion and rapid return");
