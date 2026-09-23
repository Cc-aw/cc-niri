const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    wideNeighborStart,
    anchoredScaleTranslation,
    widePairEdgeError,
    wideTimelineSample,
    widePairMotionSnapshot,
} = require("../src/effect/WideMotionGeometry");
const {
    wideExitNeighborMatches,
    CCNiriScrollTransition,
    MotionTransaction,
    MotionType,
} = require("../effect/contents/code/main.js");

const wide = { x: 375, y: 50, width: 1809, height: 1320 };
const left = { x: 24, y: 50, width: 1252, height: 1320 };
const right = { x: 1284, y: 50, width: 1252, height: 1320 };
const gap = 8;
const virtualRight = wideNeighborStart(wide, right.width, "right", gap);
const virtualLeft = wideNeighborStart(wide, left.width, "left", gap);
assert.equal(virtualRight, 2192);
assert.equal(virtualRight - right.x, 908);
assert.equal(virtualLeft, -885);
assert.equal(virtualLeft - left.x, -909);
const exitSnapshot = widePairMotionSnapshot("WIDE_TO_PAIR", wide, right,
    "right", gap);
assert.deepEqual(exitSnapshot.neighbor.oldVisualRect,
    { x: -885, y: 50, width: 1252, height: 1320 });
assert.deepEqual(exitSnapshot.neighbor.newVisualRect, left);
assert.deepEqual([exitSnapshot.neighbor.oldOpacity,
    exitSnapshot.neighbor.newOpacity], [0, 1]);
const enterSnapshot = widePairMotionSnapshot("PAIR_TO_WIDE", wide, right,
    "right", gap);
assert.deepEqual(enterSnapshot.neighbor.oldVisualRect, left);
assert.deepEqual(enterSnapshot.neighbor.newVisualRect,
    exitSnapshot.neighbor.oldVisualRect);
assert.deepEqual(wideTimelineSample(1000, 1000, 220),
    { progress: 0, remainingDuration: 220 });
assert.deepEqual(wideTimelineSample(1000, 1110, 220),
    { progress: 0.875, remainingDuration: 110 });
for (const elapsed of [0, 20, 55, 110, 180, 220]) {
    const sample = wideTimelineSample(1000, 1000 + elapsed, 220);
    const targetVisual = {
        x: wide.x + (right.x - wide.x) * sample.progress,
        width: wide.width + (right.width - wide.width) * sample.progress,
    };
    const neighborVisual = {
        x: left.x + (virtualLeft - left.x) * (1 - sample.progress),
        width: left.width,
    };
    assert.ok(Math.abs(widePairEdgeError(targetVisual, neighborVisual,
        "left", gap)) < 1,
    `a late neighbor remains attached at ${elapsed} ms`);
}
assert.equal(wideExitNeighborMatches({ pairRect: right, side: "right" }, left, gap), true);
assert.equal(wideExitNeighborMatches({ pairRect: left, side: "left" }, right, gap), true);
assert.equal(wideExitNeighborMatches({ pairRect: right, side: "right" }, right, gap), false);
assert.equal(wideExitNeighborMatches({ pairRect: right, side: "right" },
    Object.assign({}, left, { width: left.width - 20 }), gap), false);
const scrollingNeighborVisual = { x: 1284, width: 1252 };
const virtualPairSource = {
    x: scrollingNeighborVisual.x + scrollingNeighborVisual.width + gap,
    width: right.width,
};
assert.equal(virtualPairSource.x, 2544,
    "a parked target entering Wide starts at the current neighbor visual edge");

for (const [pairTarget, pairNeighbor, side, virtualX] of [
    [left, right, "right", virtualRight],
    [right, left, "left", virtualLeft],
]) {
    const anchor = side === "right" ? "left" : "right";
    const transform = anchoredScaleTranslation(wide, pairTarget, anchor);
    assert.ok(Math.abs(transform.scaleX - 1809 / 1252) < 1e-9);
    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const targetVisual = {
            x: wide.x + (pairTarget.x - wide.x) * progress,
            width: wide.width + (pairTarget.width - wide.width) * progress,
        };
        const neighborVisual = {
            x: virtualX + (pairNeighbor.x - virtualX) * progress,
            width: pairNeighbor.width,
        };
        assert.ok(Math.abs(widePairEdgeError(
            targetVisual, neighborVisual, side, gap)) < 1,
        `Wide and neighbor remain edge-coupled at progress ${progress}`);
    }
}

const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"), "utf8"
);
assert.ok(effectSource.includes("MotionType.WIDE_TO_PAIR"));
assert.ok(effectSource.includes("MotionType.PAIR_TO_WIDE"));
assert.ok(effectSource.includes("role=incoming virtualX="));
assert.ok(effectSource.includes("this.motion.startTransaction(neighbor"));

const previousEffect = global.Effect;
const previousSet = global.set;
const previousCancel = global.cancel;
const previousEffects = global.effects;
const held = [];
const cancelled = [];
let repaints = 0;
global.Effect = { Opacity: 1, Translation: 2, Scale: 3 };
global.set = options => { held.push(options); return [17]; };
global.cancel = ids => cancelled.push(ids);
global.effects = { addRepaintFull: () => { repaints += 1; } };
try {
    const transition = Object.create(CCNiriScrollTransition.prototype);
    transition.wideIsolationHolds = new Map();
    transition.debug = () => {};
    const window = {
        geometry: left,
        screen: { geometry: { x: 0, y: 0, width: 2560, height: 1440 } },
    };
    assert.equal(transition.holdWideIsolation(window), true);
    assert.equal(held.length, 1);
    assert.equal(repaints, 1, "opacity hold invalidates the stale scene frame");
    assert.deepEqual(held[0].animations, [{ type: 1, from: 0, to: 0 }]);
    assert.equal(transition.holdWideIsolation(window), false);
    assert.equal(transition.releaseWideIsolation(window, "test"), true);
    assert.deepEqual(cancelled, [[17]]);
    assert.equal(repaints, 2, "releasing the hold invalidates the scene frame");
    transition.targetOutputName = "DP-1";
    window.screen.name = "HDMI-1";
    assert.equal(transition.holdWideIsolation(window), true);
    transition.geometryChanged(window, left);
    assert.deepEqual(cancelled, [[17], [17]],
        "moving to another output releases the persistent opacity hold");

    const recovering = Object.create(CCNiriScrollTransition.prototype);
    recovering.targetOutputName = "DP-1";
    recovering.innerGap = gap;
    recovering.duration = 220;
    recovering.presentationDuration = 220;
    recovering.wideIsolationHolds = new Map();
    recovering.motionTransaction = new MotionTransaction(80);
    recovering.parkingGrabber = { grab: () => {}, release: () => {} };
    recovering.viewportClip = { shaderFor: () => null };
    recovering.debug = () => {};
    let recoveredMotion = null;
    recovering.motion = {
        states: new Map(),
        startTransaction: (_window, transaction, role, options) => {
            recoveredMotion = { transaction, role, options };
            return {};
        },
    };
    recovering.pendingWideExit = {
        wide: {
            wideRect: wide, pairRect: right, side: "right",
            snapshot: exitSnapshot,
        },
        viewport: { x: 24, y: 50, width: 2512, height: 1320 },
        armedAt: Date.now(),
        transactionId: 999,
    };
    recovering.motionTransaction.begin({
        type: MotionType.SCROLL, deltaX: 1260, now: Date.now(),
    });
    const enteringNeighbor = {
        geometry: left,
        screen: {
            name: "DP-1",
            geometry: { x: 0, y: 0, width: 2560, height: 1440 },
        },
    };
    recovering.geometryChanged(enteringNeighbor,
        Object.assign({}, left, { x: -5000 }));
    assert.equal(recoveredMotion.transaction.type, MotionType.WIDE_TO_PAIR);
    assert.equal(recoveredMotion.role, "incoming");
    assert.ok(Math.abs(recoveredMotion.options.channels[0].from.value1 + 909) < 20,
        `recovered translation=${recoveredMotion.options.channels[0].from.value1}`);
    assert.equal(recoveredMotion.options.synchronizeDuration, true);
    assert.equal(recovering.pendingWideExit, null);

    const markerEntries = [{
        role: "target", windowId: "right",
        oldVisualRect: right, newVisualRect: wide,
    }, {
        role: "neighbor", windowId: "left",
        oldVisualRect: left,
        newVisualRect: enterSnapshot.neighbor.newVisualRect,
    }];
    const explicitTarget = {
        screen: { name: "DP-1",
            geometry: { x: 0, y: 0, width: 2560, height: 1440 } },
        geometry: wide,
        data: () => ({
            type: MotionType.PAIR_TO_WIDE, role: "target", epoch: 42,
            issuedAt: Date.now(),
            side: "right", oldVisualRect: right, newVisualRect: wide,
            entries: markerEntries,
        }),
    };
    const planned = recovering.readMotionPlan(explicitTarget,
        Object.assign({}, right, { y: 51 }), wide,
        explicitTarget.screen.geometry);
    assert.equal(planned.epoch, 42);
    assert.equal(planned.snapshot.neighbor.newVisualRect.x, -885);
    const nativeListTarget = Object.assign({}, explicitTarget, {
        data: () => Object.assign({}, explicitTarget.data(), {
            entries: { 0: markerEntries[0], 1: markerEntries[1], length: 2 },
        }),
    });
    const nativeListPlan = recovering.readMotionPlan(nativeListTarget,
        right, wide, explicitTarget.screen.geometry);
    assert.equal(nativeListPlan.snapshot.target.windowId, "right",
        "KWin QVariantList is array-like but fails Array.isArray");
    const explicitNeighbor = {
        screen: explicitTarget.screen,
        geometry: left,
        data: () => Object.assign({}, explicitTarget.data(), {
            role: "neighbor", oldVisualRect: left,
            newVisualRect: enterSnapshot.neighbor.newVisualRect,
        }),
    };
    assert.equal(recovering.readMotionPlan(explicitNeighbor, left,
        explicitNeighbor.geometry, explicitNeighbor.screen.geometry), null,
    "the pair neighbor stays at its real slot while the effect translates it");
    let targetMotion = null;
    recovering.motion.startTransaction = (_window, transaction, role, options) => {
        if (role === "continuing") targetMotion = { transaction, role, options };
        return {};
    };
    global.effects.stackingOrder = [explicitNeighbor];
    recovering.pairNeighbor = () => null;
    recovering.geometryChanged(explicitTarget, Object.assign({}, right, { y: 51 }));
    assert.equal(targetMotion.transaction.type, MotionType.PAIR_TO_WIDE);
    assert.equal(targetMotion.transaction.layoutEpoch, 42);
    assert.equal(targetMotion.role, "continuing");
    let outgoingMotion = null;
    recovering.pairNeighbor = () => ({ geometry: left });
    recovering.motion.startTransaction = (_window, transaction, role, options) => {
        if (role === "outgoing") outgoingMotion = { transaction, options };
        return {};
    };
    recovering.geometryChanged(explicitTarget, right);
    assert.equal(outgoingMotion.transaction.type, MotionType.PAIR_TO_WIDE);
    assert.equal(outgoingMotion.options.newGeometry.x, 24);
    assert.equal(outgoingMotion.options.channels[0].from.value1, 0);
    assert.equal(outgoingMotion.options.channels[0].to.value1, -909,
        "neighbor translates continuously away from its real pair slot");

    const completionWrites = [];
    const completionWindow = {
        data: () => ({ type: MotionType.PAIR_TO_WIDE,
            role: "neighbor", epoch: 42, sessionId: "session",
            transitionToken: "token-1", targetWindowUuid: "target" }),
        setData: (role, value) => completionWrites.push([role, value]),
    };
    assert.equal(recovering.reportWideMotionComplete(completionWindow,
        { transactionEpoch: 42 }), true);
    assert.equal(completionWrites[0][0], 1004);
    assert.deepEqual(completionWrites[0][1], {
        type: MotionType.PAIR_TO_WIDE, sessionId: "session",
        transitionToken: "token-1", targetWindowUuid: "target",
    });
    assert.equal(recovering.reportWideMotionComplete(completionWindow,
        { transactionEpoch: 43 }), false);
} finally {
    global.Effect = previousEffect;
    global.set = previousSet;
    global.cancel = previousCancel;
    global.effects = previousEffects;
}
console.log("PASS Wide/Pair target and neighbor share edge-coupled geometry");
