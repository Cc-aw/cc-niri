"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const { captureSingleColumnLayout, classifySingleColumnTransition } =
    require("../src/kwin/layout/SingleColumnTransition");

const fixture = config => createRuntime({ AlwaysCenterSingleColumn: true,
    PrimaryWindowCount: 1, OtherWorkspaceWindowCount: 0, ValidateScrollMembership: true, ...config });
function adopt(r, window, focus = true) {
    // Resolve the fixture window through the runtime's own list.
    const id = JSON.stringify(window.internalId);
    assert.equal(r.evaluate(`(() => {
        const window = workspace.windowList().find(w => w.internalId === ${id});
        adoptionController.transition(window, stateFor(window), ADOPTION_SETTLING, "test-adopt");
        const accepted = adoptNewWindowAsColumn(window, "test-single-add", ${focus});
        ${focus ? "activateColumnWhenReady(window);" : ""}
        return accepted;
    })()`), true);
}
function check(r) {
    assert.equal(r.evaluate("invariantChecker.errors().length"), 0, r.logs.join("\n"));
    assert.equal(r.logs.some(line => /INVARIANT_FAIL|FAIL_SAFE/.test(line)), false, r.logs.join("\n"));
    r.state.columns.forEach(c => assert.equal(c.window.opacity, 1));
}
{
    const config = { AlwaysCenterSingleColumn: true, PrimaryWindowCount: 1,
        OtherWorkspaceWindowCount: 0, ValidateScrollMembership: true };
    const r = createRuntime(config), a = r.a[0], b = r.add("added", 0);
    config.HoldStateAck = config.HoldScrollAck = config.HoldNativeAck = true;
    const generation = r.evaluate("runtimeBridge.generation()");
    const writes = r.writes(), motions = r.motionPlans.length, arms = r.nativeArms.length;
    adopt(r, b);
    assert.equal(r.motionPlans.length, motions, "membership ACK must precede MotionPlan");
    assert.equal(r.writes(), writes);
    assert.equal(r.workspace.activeWindow, a, "explicit new-window activation waits for the geometry batch");
    r.stateAcks.at(-1)(true);
    assert.equal(r.motionPlans.length, motions + 1);
    assert.equal(r.nativeArms.length, arms, "publish ACK precedes native arm");
    assert.equal(r.writes(), writes);
    r.motionAcks.at(-1)(true);
    assert.equal(r.nativeArms.length, arms + 1);
    assert.equal(r.writes(), writes, "native ACK precedes all configure writes");
    const plan = r.nativeArms.at(-1);
    assert.deepEqual([plan.oldScrollOffsetX, plan.newScrollOffsetX], [0, 630]);
    assert.equal(plan.entries.find(e => e.windowId === "a0").logicalX, 630);
    assert.deepEqual(plan.entries.map(e => e.oldPlacement), ["visible", "parked"]);
    assert.equal(r.published.at(-1).columns.some(c => c.uuid === "added"), true);
    r.nativeAcks.at(-1)(true);
    assert.deepEqual([a.frameGeometry.x, b.frameGeometry.x], [24, 1284]);
    assert.equal(r.workspace.activeWindow, b);
    assert.equal(r.evaluate("runtimeBridge.generation()"), generation + 1, "one membership generation");
    const cancels = r.nativeCancels.length;
    r.evaluate("settleAdoptionGeometry(workspace.activeWindow, 1, 'test-settle')");
    assert.equal(r.nativeCancels.length, cancels, "settling does not stop the newly armed Spring");
    check(r);
    config.HoldStateAck = config.HoldScrollAck = config.HoldNativeAck = false;
    r.close(b);
    assert.deepEqual([r.nativeArms.at(-1).oldScrollOffsetX, r.nativeArms.at(-1).newScrollOffsetX], [630, 0]);
    assert.equal(a.frameGeometry.x, 654);
    assert.equal(r.workspace.activeWindow, a); check(r);
}
for (const failure of ["RejectState", "RejectScrollPlan", "RejectNativeArm", "HoldStateAck", "HoldScrollAck", "HoldNativeAck"]) {
    const config = { AlwaysCenterSingleColumn: true, PrimaryWindowCount: 1, OtherWorkspaceWindowCount: 0,
        ValidateScrollMembership: true };
    const r = createRuntime(config), b = r.add(`fallback-${failure}`, 0);
    config[failure] = true;
    adopt(r, b);
    if (failure.startsWith("Hold")) r.evaluate("scrollPlanCommitGate.pending.timer.timer.timeout.emit()");
    assert.deepEqual([r.a[0].frameGeometry.x, b.frameGeometry.x], [24, 1284], failure);
    assert.equal(b.minimized, false); assert.equal(r.workspace.activeWindow, b);
    assert.equal(r.evaluate("scrollPlanCommitGate.pending"), null);
    const writes = r.writes(), arms = r.nativeArms.length;
    r.stateAcks.forEach(reply => reply(true)); r.motionAcks.forEach(reply => reply(true));
    r.nativeAcks.forEach(reply => reply(true));
    assert.equal(r.writes(), writes, "late ACK cannot replay geometry after fallback");
    assert.equal(r.nativeArms.length, arms, "late membership/publish ACK cannot arm old motion");
    check(r);
}
{
    const config = { AlwaysCenterSingleColumn: true, PrimaryWindowCount: 1,
        OtherWorkspaceWindowCount: 0, HoldNativeAck: true, ValidateScrollMembership: true };
    const r = createRuntime(config), b = r.add("reverse", 0);
    adopt(r, b);
    const oldAck = r.nativeAcks.at(-1);
    r.close(b);
    const returning = r.nativeArms.at(-1);
    assert.equal(returning.retargetOnly, true);
    assert.deepEqual([returning.oldScrollOffsetX, returning.newScrollOffsetX], [0, 0]);
    assert.deepEqual(returning.entries.map(e => e.windowId), ["a0"]);
    const writes = r.writes(); oldAck(true); assert.equal(r.writes(), writes);
    r.nativeAcks.at(-1)(true);
    assert.equal(r.a[0].frameGeometry.x, 654); check(r);
    // Closing the last window while another arm is pending cannot replay a dead wrapper.
    const next = r.add("last-pending", 0); adopt(r, next);
    r.close(next); const lastAck = r.nativeAcks.at(-1); r.close(r.a[0]);
    const emptyWrites = r.writes(); lastAck(true);
    assert.equal(r.writes(), emptyWrites); assert.equal(r.state.columns.length, 0);
    assert.equal(r.state.scrollOffsetX, 0);
    assert.equal(r.evaluate("scrollPlanCommitGate.pending"), null); check(r);
}
{
    const r = fixture({ PrimaryWindowCount: 2 });
    r.workspace.activeWindow = r.a[1];
    r.close(r.a[0]);
    assert.equal(r.a[1].frameGeometry.x, 654);
    assert.equal(r.nativeArms.length, 1);
    assert.equal(r.nativeArms[0].type, "COLUMN_REINDEX");
    assert.equal(r.nativeArms[0].sourceLogicalX, 1890);
    assert.equal(r.nativeArms[0].entries[0].logicalX, 630);
    assert.deepEqual([r.nativeArms[0].oldScrollOffsetX, r.nativeArms[0].newScrollOffsetX], [630, 0]);
    assert.equal(r.workspace.activeWindow, r.a[1]); check(r);
}
for (const timeout of [false, true]) {
    const config = { AlwaysCenterSingleColumn: true, PrimaryWindowCount: 1,
        OtherWorkspaceWindowCount: 0, ValidateScrollMembership: true };
    const r = createRuntime(config), b = r.add(`cancel-reindex-${timeout}`, 0);
    adopt(r, b);
    assert.equal(b.frameGeometry.x, 1284);
    config.HoldCancelAck = config.RejectNativeArm = true;
    const arms = r.nativeArms.length;
    r.close(r.a[0]);
    assert.equal(r.nativeArms.length, arms + 1);
    assert.equal(r.nativeArms.at(-1).type, "COLUMN_REINDEX");
    assert.equal(b.frameGeometry.x, 1284, "old ownership is cancelled before moving the real survivor");
    assert.equal(r.evaluate("scrollPlanCommitGate.pending.fallback"), true);
    if (timeout) r.evaluate("scrollPlanCommitGate.pending.timer.timer.timeout.emit()");
    else r.cancelAcks.forEach(reply => reply());
    assert.equal(b.frameGeometry.x, 654);
    assert.equal(r.workspace.activeWindow, b);
    assert.equal(r.evaluate("scrollPlanCommitGate.idleCallbacks.length"), 0, "timeout retires its idle closure");
    const writes = r.writes(); r.cancelAcks.forEach(reply => reply()); assert.equal(r.writes(), writes);
    check(r);
}
{
    const r = fixture({ HoldNativeAck: true }), b = r.add("pending-switch", 0);
    adopt(r, b);
    const oldAck = r.nativeAcks.at(-1);
    r.nativeSwitch(1, null);
    const writes = r.writes(); oldAck(true);
    assert.equal(r.writes(), writes, "old workspace ACK cannot apply a previous center/pair geometry");
    assert.equal(r.state.activeWorkspaceId, "B"); assert.equal(r.state.columns.length, 0); check(r);
}
{
    const r = fixture();
    r.evaluate(`startupLayout.load(JSON.stringify({protocol:1,targetOutput:"eDP-1",columns:[{uuid:"left"},{uuid:"a0"}]}))`);
    const b = r.add("left", 0); adopt(r, b);
    assert.deepEqual(r.ids(), ["left", "a0"]);
    assert.deepEqual([b.frameGeometry.x, r.a[0].frameGeometry.x], [24, 1284]);
    assert.equal(r.nativeArms.at(-1).type, "COLUMN_REINDEX");
    assert.equal(r.nativeArms.at(-1).sourceLogicalX, 630);
    assert.equal(r.nativeArms.at(-1).sourceWindowId, "a0");
    assert.deepEqual(r.nativeArms.at(-1).entries.map(e => e.oldPlacement), ["parked", "visible"]);
    check(r);
}
{
    const r = fixture(), b = r.add("inactive", 0), before = r.workspace.activeWindow;
    adopt(r, b, false);
    assert.equal(r.workspace.activeWindow, before, "focusNew=false preserves actual focus");
    assert.equal(r.state.scrollOffsetX, 0); assert.equal(r.a[0].frameGeometry.x, 654);
    r.workspace.activeWindow = b;
    assert.equal(r.state.scrollOffsetX, 630);
    assert.deepEqual([r.a[0].frameGeometry.x, b.frameGeometry.x], [24, 1284]); check(r);
}
{
    const output = {}, window = {};
    const state = { enabled: true, activeWorkspaceId: "A", targetOutput: output,
        safeRect: {x:24,y:50,width:2512,height:1382}, viewport: {mode:"pair"}, presentation:{mode:"normal"},
        columns: [{window,widthMode:"half",logicalX:630,pixelWidth:1252}] };
    const old = captureSingleColumnLayout(state, true);
    state.columns.push({window:{},widthMode:"half",logicalX:1890,pixelWidth:1252});
    assert.equal(classifySingleColumnTransition(old, state), "scroll");
    state.safeRect.width = 2500; assert.equal(classifySingleColumnTransition(old, state), "rebase");
    state.activeWorkspaceId = "B"; assert.equal(classifySingleColumnTransition(old, state), null);
    assert.equal(captureSingleColumnLayout(state, false), null);
}
{
    const r = fixture(), original = r.workspace.activeWindow;
    r.evaluate(`startupLayout.load(JSON.stringify({protocol:1,targetOutput:"eDP-1",columns:[{uuid:"left-unfocused"},{uuid:"a0"}]}))`);
    const left = r.add("left-unfocused", 0); adopt(r, left, false);
    assert.equal(r.workspace.activeWindow, original, "unfocused left insertion keeps the actual survivor focus");
    assert.equal(original.minimized, false, "reindex does not park the actual focused survivor");
    assert.equal(r.nativeArms.at(-1).type, "COLUMN_REINDEX");
    assert.deepEqual([left.frameGeometry.x, original.frameGeometry.x], [24, 1284]); check(r);
}
for (const hold of [false, true]) {
    const r = fixture({ PrimaryWindowCount: 2, HoldNativeAck: hold });
    r.workspace.activeWindow = r.a[1]; r.close(r.a[0]);
    const cancels = r.nativeCancels.length, added = r.add(`inactive-during-reindex-${hold}`, 0);
    adopt(r, added, false);
    assert.equal(r.nativeArms.at(-1).type, "SCROLL");
    assert.equal(r.nativeArms.at(-1).retargetOnly, true, "unchanged camera continues the existing Spring across membership");
    assert.deepEqual([r.nativeArms.at(-1).oldScrollOffsetX, r.nativeArms.at(-1).newScrollOffsetX], [0,0]);
    assert.equal(r.nativeCancels.length, cancels, "inactive new window does not cancel the survivor's in-flight center motion");
    if (hold) r.nativeAcks.at(-1)(true);
    assert.equal(r.workspace.activeWindow, r.a[1]); assert.equal(r.a[1].minimized, false);
    assert.equal(r.a[1].opacity, 1); assert.equal(added.minimized, true);
    assert.equal(r.evaluate("invariantChecker.errors().length"), 0, r.logs.join("\n"));
}
for (const insert of [false, true]) {
    const config = { AlwaysCenterSingleColumn: true, PrimaryWindowCount: insert ? 1 : 2,
        OtherWorkspaceWindowCount: 0, ValidateScrollMembership: true };
    const r = createRuntime(config);
    if (insert) r.evaluate(`startupLayout.load(JSON.stringify({protocol:1,targetOutput:"eDP-1",columns:[{uuid:"left-ack"},{uuid:"a0"}]}))`);
    const addition = insert ? r.add("left-ack", 0) : null;
    if (!insert) r.workspace.activeWindow = r.a[1];
    config.HoldStateAck = config.HoldScrollAck = config.HoldNativeAck = true;
    const generation = r.evaluate("runtimeBridge.generation()"), writes = r.writes();
    if (insert) adopt(r, addition);
    else r.close(r.a[0]);
    assert.equal(r.motionPlans.length, 0); assert.equal(r.writes(), writes);
    r.stateAcks.at(-1)(true); assert.equal(r.motionPlans.at(-1).type, "COLUMN_REINDEX");
    assert.equal(r.nativeArms.length, 0); assert.equal(r.writes(), writes);
    r.motionAcks.at(-1)(true); assert.equal(r.nativeArms.length, 1); assert.equal(r.writes(), writes);
    r.nativeAcks.at(-1)(true);
    assert.equal(r.evaluate("runtimeBridge.generation()"), generation + 1, `insert=${insert}\n${r.logs.slice(-40).join("\n")}`);
    assert.deepEqual(Array.from(r.state.columns, c => c.window.frameGeometry.x), insert ? [24,1284] : [654]);
    check(r);
}
for (const failure of ["RejectState", "RejectScrollPlan", "RejectNativeArm", "HoldStateAck", "HoldScrollAck", "HoldNativeAck"]) {
    const config = { AlwaysCenterSingleColumn: true, PrimaryWindowCount: 2,
        OtherWorkspaceWindowCount: 0, ValidateScrollMembership: true };
    const r = createRuntime(config); r.workspace.activeWindow = r.a[1]; config[failure] = true;
    r.close(r.a[0]);
    if (failure.startsWith("Hold")) r.evaluate("scrollPlanCommitGate.pending.timer.timer.timeout.emit()");
    assert.equal(r.a[1].frameGeometry.x, 654, failure);
    const writes = r.writes(), arms = r.nativeArms.length;
    r.stateAcks.forEach(reply => reply(true)); r.motionAcks.forEach(reply => reply(true));
    r.nativeAcks.forEach(reply => reply(true));
    assert.equal(r.writes(), writes); assert.equal(r.nativeArms.length, arms); check(r);
}
{
    const config = { AlwaysCenterSingleColumn: true, PrimaryWindowCount: 1,
        OtherWorkspaceWindowCount: 0, ValidateScrollMembership: true, HoldNativeAck: true };
    const r = createRuntime(config);
    r.evaluate(`startupLayout.load(JSON.stringify({protocol:1,targetOutput:"eDP-1",columns:[{uuid:"rapid-left"},{uuid:"a0"}]}))`);
    const left = r.add("rapid-left", 0); adopt(r, left);
    const oldAck = r.nativeAcks.at(-1); r.close(left);
    assert.equal(r.nativeArms.at(-1).type, "COLUMN_REINDEX");
    assert.equal(r.nativeArms.at(-1).sourceLogicalX, 1890);
    const writes = r.writes(); oldAck(true); assert.equal(r.writes(), writes);
    r.nativeAcks.at(-1)(true); assert.equal(r.a[0].frameGeometry.x, 654); check(r);
}
{
    const config = { AlwaysCenterSingleColumn: true, PrimaryWindowCount: 2,
        OtherWorkspaceWindowCount: 0, ValidateScrollMembership: true, HoldNativeAck: true };
    const r = createRuntime(config); r.workspace.activeWindow = r.a[1]; r.close(r.a[0]);
    const oldAck = r.nativeAcks.at(-1), added = r.add("right-after-reindex", 0); adopt(r, added);
    assert.equal(r.nativeArms.at(-1).type, "SCROLL");
    assert.deepEqual([r.nativeArms.at(-1).oldScrollOffsetX,r.nativeArms.at(-1).newScrollOffsetX], [0,630]);
    const writes = r.writes(); oldAck(true); assert.equal(r.writes(), writes);
    r.nativeAcks.at(-1)(true); assert.deepEqual(Array.from(r.state.columns, c => c.window.frameGeometry.x), [24,1284]); check(r);
}
console.log("PASS single-column membership ACK ordering, generation, failure/timeout, reversal, reindex safety and focusNew");
