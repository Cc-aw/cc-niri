"use strict";
const assert = require("node:assert/strict");
const {createRuntime} = require("./helpers/workspace-runtime");
const r = createRuntime();
r.evaluate("toggleFocusWide(workspace.activeWindow)");
r.motionAcks.at(-1)(true);
const original = {...r.a[0].frameGeometry};
const oldId = r.state.viewport.wideColumnId;
assert.equal(r.state.viewport.mode, "wide-focus");
r.nativeSwitch(1, r.b[0]); assert.equal(r.state.viewport.mode, "pair");
const beforeReturnPlans = r.motionPlans.length;
r.nativeSwitch(0, r.a[0]);
assert.equal(r.motionPlans.length, beforeReturnPlans,
    "restoring saved Wide is not a new Pair-to-Wide animation");
assert.equal(r.evaluate("contextualWideCoordinator.pendingPark"), null,
    "restored Wide does not retain a normal neighbor for delayed parking");
assert.equal(r.a[1].opacity, 0, "normal neighbor stays hidden on first restored frame");
assert.equal(r.state.viewport.mode, "wide-focus");
assert.notEqual(r.state.viewport.wideColumnId, oldId);
r.motionAcks.at(-1)(true);
assert.deepEqual({...r.a[0].frameGeometry}, original, "actual Wide width and position survive J/K roundtrip");
assert.equal(r.evaluate("invariantChecker.errors().length"), 0);
// Late activation of the same owner does not undo restored Wide.
r.workspace.windowActivated.emit(r.a[0]); assert.equal(r.state.viewport.mode, "wide-focus");
r.nativeSwitch(1, r.b[0]);
r.nativeSwitch(0, r.a[1]); assert.equal(r.state.viewport.mode, "pair");
const removed = createRuntime();
removed.evaluate("toggleFocusWide(workspace.activeWindow)"); removed.motionAcks.at(-1)(true);
removed.nativeSwitch(1, removed.b[0]); removed.close(removed.a[0]);
removed.nativeSwitch(0, removed.a[1]); assert.equal(removed.state.viewport.mode, "pair", "closed Wide owner is not revived");
assert.equal(removed.evaluate("invariantChecker.errors().length"), 0);
// Both anchors, including departure before the original motion ACK. Observe
// every opacity assignment during mount, not merely the eventual settled state.
for (const index of [0, 1]) for (const acknowledge of [false, true]) {
    const sample = createRuntime();
    const owner = sample.a[index], neighbor = sample.a[1-index];
    sample.workspace.activeWindow = owner;
    sample.evaluate("toggleFocusWide(workspace.activeWindow)");
    const oldAck = sample.motionAcks.at(-1);
    if (acknowledge) oldAck(true);
    sample.nativeSwitch(1, sample.b[0]);
    const before = sample.motionPlans.length;
    let opacity = neighbor.opacity;
    const opacityWrites = [];
    Object.defineProperty(neighbor, "opacity", {
        get: () => opacity,
        set: value => { opacityWrites.push(value); opacity = value; },
    });
    for (let round = 0; round < 3; ++round) {
        sample.nativeSwitch(0, owner);
        assert.equal(sample.motionPlans.length, before, "mount does not publish a new presentation animation");
        assert.equal(neighbor.opacity, 0, "neighbor is hidden immediately without a motion ACK");
        assert.equal(sample.evaluate("contextualWideCoordinator.pendingPark"), null);
        assert.ok(owner.frameGeometry.width > neighbor.frameGeometry.width, "Wide geometry is committed immediately");
        oldAck(true);
        assert.equal(neighbor.opacity, 0, "stale original ACK cannot reveal restored neighbor");
        assert.equal(sample.evaluate("invariantChecker.errors().length"), 0);
        sample.nativeSwitch(1, sample.b[0]);
    }
    assert.ok(opacityWrites.every(value => value === 0), "restoration never transiently unhides the retained pair neighbor");
}
console.log("PASS production workspace Wide geometry, immediate neighbor isolation, both anchors, pending/stale ACKs and restoration");
