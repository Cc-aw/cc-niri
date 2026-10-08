"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const { computeLayoutPlan } = require("../src/kwin/layout/LayoutEngine");
const safeRect = { x: 24, y: 50, width: 2512, height: 1382 };
for (const fullFirst of [true, false]) {
    const columns = [0, 1].map(i => ({ id: i + 1, logicalX: i === 0 ? 0 : (fullFirst ? 2520 : 1260),
        pixelWidth: (i === 0) === fullFirst ? 2512 : 1252,
        widthMode: (i === 0) === fullFirst ? "full" : "half",
        window: { internalId: "a" + i } }));
    const offset = fullFirst ? 1260 : 0;
    const p = computeLayoutPlan({ columns, safeRect, epoch: 1, innerGap: 8,
        parkingBaseX: -9000, scrollOffsetX: offset, clipPartial: true });
    assert.deepEqual(p.windows.map(w => w.placement), ["visible", "visible"]);
    assert.equal(p.windows.filter(w => w.partial).length, 1);
    assert.equal(p.windows.find(w => w.partial).rect.width, 2512);
    assert.equal(p.scrollTransaction.clipPartial, true);
    assert.equal(p.scrollTransaction.retargetOnly, true);
}
function fixture(config = {}) {
    const r = createRuntime(config);
    r.a.slice(2).forEach(w => r.close(w));
    r.shortcuts.get("CCScrollCycleColumnWidth")();
    const park = r.evaluate("contextualWideCoordinator.pendingPark");
    r.evaluate("contextualWideCoordinator").finalizePark({ transitionToken: park.token,
        commandId: park.commandId, motionCompleted: true });
    r.shortcuts.get("CCScrollFocusNextColumn")();
    return r;
}
const r = fixture();
assert.equal(r.a[0].frameGeometry.width, 2512);
assert.equal(r.a[0].frameGeometry.x, -1236);
assert.equal(r.a[0].minimized, false);
assert.equal(r.a[1].frameGeometry.x, 1284);
assert.equal(r.nativeArms.at(-1).clipPartial, true);
// Contextual Wide uses the same protocol handoff when its neighbor is Full.
r.shortcuts.get("CCScrollToggleFocusWide")();
r.shortcuts.get("CCScrollToggleFocusWide")();
assert.equal(r.a[1].frameGeometry.width, 1252, "Wide return commits half through the clip ACK");
assert.equal(r.a[0].minimized, false, "Wide return animates its partial Full neighbor too");
assert.equal(r.nativeArms.at(-1).clipPartial, true);
assert.deepEqual(r.nativeArms.at(-1).viewport, safeRect, "all Pair/Wide handoffs carry the safe viewport");
const pending = r.evaluate("deferredScrollParking.pending");
pending.timer.callback();
r.scrollStatusAcks.at(-1)(JSON.stringify({ ...pending.context, epoch: pending.epoch,
    active: true, completed: true, clipPartial: true }));
assert.equal(r.a[0].minimized, false, "completion retains partially visible Full");
assert.equal(r.evaluate("deferredScrollParking.pending.paused"), true);
const cancels = r.nativeCancels.length;
r.add("editor-popup", 0, { normalWindow: false, transient: true });
assert.equal(r.nativeCancels.length, cancels, "unmanaged editor popup cannot retire persistent clipping");
assert.equal(r.a[0].minimized, false);
r.nativeSwitch(1, r.b[0]);
assert.equal(r.a[0].minimized, false, "workspace departure keeps source until native transition retires it");
r.nativeSwitch(0, r.a[1]);
assert.equal(r.nativeArms.at(-1).clipPartial, true);
assert.equal(r.a[0].minimized, false, "mount arms clip before restoring visible partial geometry");
assert.equal(r.evaluate("invariantChecker.errors().length"), 0);
// Returning from Full arms Native clipping before restoring its Full neighbor
// into the existing width animation, without waiting for target completion.
r.shortcuts.get("CCScrollCycleColumnWidth")();
const park = r.evaluate("contextualWideCoordinator.pendingPark");
if (park) r.evaluate("contextualWideCoordinator").finalizePark({ transitionToken: park.token,
    commandId: park.commandId, motionCompleted: true });
r.shortcuts.get("CCScrollCycleColumnWidth")();
const exiting = r.evaluate("contextualWideCoordinator.pendingExit");
assert.ok(exiting && exiting.requireMotionComplete);
assert.equal(r.a[0].minimized, false, "ACKed clip allows the neighbor to enter during the width animation");
r.evaluate("contextualWideCoordinator").finalizeExit({ transitionToken: exiting.token,
    motionCompleted: true });
assert.equal(r.a[0].minimized, false, "Legacy half return restores persistent Native clip");
assert.equal(r.nativeArms.at(-1).clipPartial, true);
const rejected = fixture({ HoldNativeAck: true });
rejected.nativeAcks.at(-1)(false);
assert.equal(rejected.a[0].minimized, true, "Native rejection parks partial physical surfaces safely");
assert.equal(rejected.a[1].minimized, false);
assert.equal(rejected.state.enabled, true);
const failedWidth = createRuntime({ HoldWidthAck: true, HoldNativeAck: true });
failedWidth.a.slice(2).forEach(w => failedWidth.close(w));
failedWidth.evaluate("mainScreenState.columns.forEach(c => c.widthMode = 'full'); recomputeLogicalLayout(); ensureColumnVisible(columnStore.focusedColumn()); relayout('both-full-rejected-clip');");
failedWidth.shortcuts.get("CCScrollCycleColumnWidth")();
failedWidth.motionAcks.at(-1)(true);
failedWidth.nativeAcks.at(-1)(false);
assert.equal(failedWidth.a[1].minimized, true, "width exit with rejected clip cannot expose the Full neighbor");
assert.equal(failedWidth.workspace.activeWindow, failedWidth.a[0]);

// Restoring a parked client can synchronously request activation. The Native
// ACK arrives after relayout's original transaction has already ended.
for (const targetIndex of [0, 1]) {
    const pair = createRuntime({ HoldWidthAck: true, HoldNativeAck: true });
    pair.a.slice(2).forEach(w => pair.close(w));
    pair.evaluate("mainScreenState.columns.forEach(c => c.widthMode = 'full'); recomputeLogicalLayout();");
    pair.workspace.activeWindow = pair.a[targetIndex];
    pair.evaluate("ensureColumnVisible(columnStore.focusedColumn()); relayout('full-pair-fixture');");
    const target = pair.a[targetIndex], neighbor = pair.a[1 - targetIndex];
    assert.equal(target.frameGeometry.width, 2512);
    assert.equal(neighbor.minimized, true);
    let minimized = neighbor.minimized, activations = 0;
    Object.defineProperty(neighbor, "minimized", { get: () => minimized, set: value => {
        const wasMinimized = minimized; minimized = value;
        if (wasMinimized && !value) { activations++; pair.workspace.activeWindow = neighbor; }
    } });
    pair.shortcuts.get("CCScrollCycleColumnWidth")();
    pair.motionAcks.at(-1)(true);
    const pendingExit = pair.evaluate("contextualWideCoordinator.pendingExit");
    assert.ok(pendingExit && pendingExit.requireMotionComplete);
    assert.equal(activations, 0, "Legacy ACK alone cannot expose an unclipped Full surface");
    const epoch = pair.evaluate("layoutTransaction.currentEpoch()");
    assert.equal(pair.evaluate("layoutTransaction.isActive()"), false);
    pair.nativeAcks.at(-1)(true);
    assert.equal(activations, 1, "exercise a real activation request during neighbor restore");
    assert.equal(pair.workspace.activeWindow, target, "width change keeps the original active window");
    assert.equal(pair.state.columns[pair.state.focusedColumnIndex].window, target);
    assert.equal(target.frameGeometry.width, 1252);
    assert.equal(target.frameGeometry.x, targetIndex ? 1284 : 24);
    assert.equal(neighbor.frameGeometry.width, 2512);
    assert.equal(neighbor.frameGeometry.x, targetIndex ? -1236 : 1284);
    assert.equal(neighbor.minimized, false);
    assert.equal(pair.evaluate("layoutTransaction.currentEpoch()"), epoch,
        "activation inside ACK commit cannot publish a second layout epoch");
    assert.equal(pair.evaluate("layoutTransaction.isActive()"), false);
    assert.equal(pair.evaluate("invariantChecker.errors().length"), 0);
    assert.deepEqual(pair.ids(), ["a0", "a1"], "resize never replaces or reorders window identities");
    pair.evaluate("contextualWideCoordinator").finalizeExit({
        transitionToken: pendingExit.token, motionCompleted: true });
    pair.nativeAcks.at(-1)(true);
    assert.equal(pair.workspace.activeWindow, target, "completion retains the original focus too");
    pair.shortcuts.get("CCScrollCycleColumnWidth")();
    pair.motionAcks.at(-1)(true);
    assert.equal(pair.state.columns[targetIndex].widthMode, "full", "next R still targets the original window");
    assert.equal(pair.state.columns[1 - targetIndex].widthMode, "full");
    // A later user activation still scrolls to the Full column normally.
    pair.workspace.activeWindow = neighbor;
    pair.nativeAcks.at(-1)(true);
    assert.equal(pair.state.columns[pair.state.focusedColumnIndex].window, neighbor);
}
console.log("PASS Full/half visibility, workspace handoff and async ACK focus retention in both resize directions");
