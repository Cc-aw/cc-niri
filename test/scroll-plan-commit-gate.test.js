"use strict";
const assert = require("node:assert/strict");
const { ScrollPlanCommitGate } = require("../src/kwin/layout/ScrollPlanCommitGate");
let epoch = 1;
const published = [], arms = [], cancelled = [], commits = [], timers = [], contexts = [];
const gate = new ScrollPlanCommitGate({
    publish: (p, cb) => published.push(cb), arm: (p, cb) => arms.push(cb),
    disarm: (e, cb) => { cancelled.push(e); cb(); }, currentEpoch: () => epoch,
    setTimer: cb => { timers.push(cb); return cb; }, clearTimer: () => {}, timeoutMs: 150,
    commit: (plan, context, window) => { contexts.push(context); commits.push([plan.epoch, window]); }, warn: () => {},
});
gate.schedule({epoch}, {}, {}); gate.deferActivation("a");
published[0](true); assert.equal(commits.length, 0, "Bridge ACK alone cannot commit");
arms[0](true); assert.deepEqual(commits, [[1, "a"]]);
assert.equal(contexts[0].nativeScroll, true, "only native ACK opts into native reveal order");
epoch = 2; gate.schedule({epoch}, {}, {}); published[1](true);
gate.pending.timer(); assert.deepEqual(commits.at(-1), [2, null]);
assert.equal(contexts.at(-1).nativeScroll, false, "timeout keeps legacy reveal order");
arms[1](true); assert.equal(commits.length, 2); assert.ok(cancelled.includes(2));
epoch = 3; gate.schedule({epoch}, {}, {}); published[2](true);
epoch = 4; gate.schedule({epoch}, {}, {}); arms[2](true);
assert.equal(commits.length, 2, "superseded native ACK cannot commit");
published[3](false); assert.equal(commits.length, 3);
epoch = 5; gate.schedule({epoch}, {}, {}); published[4](true); gate.cancel();
arms[3](true); assert.equal(commits.length, 3, "cancel blocks both ACK and timer");
epoch = 6; gate.schedule({epoch}, {}, {}); epoch = 7; published[5](true); assert.equal(arms.length, 4, "stale Bridge ACK cannot arm native");
assert.equal(commits.length, 3, "stale current epoch blocks commit");
const { createRuntime } = require("./helpers/workspace-runtime");
const r = createRuntime({HoldScrollAck: true, HoldNativeAck: true});
r.shortcuts.get("CCScrollFocusNextColumn")();
const before = r.writes();
r.shortcuts.get("CCScrollFocusNextColumn")();
assert.equal(r.writes(), before); assert.equal(r.workspace.activeWindow, r.a[1]);
r.motionAcks[0](true); assert.equal(r.writes(), before);
assert.equal(r.nativeArms[0].sessionId, r.motionPlans[0].sessionId);
r.nativeAcks[0](true); assert.ok(r.writes() > before); assert.equal(r.workspace.activeWindow, r.a[2]);
r.shortcuts.get("CCScrollFocusNextColumn")(); r.motionAcks[1](true);
r.nativeSwitch(1, r.b[0]); const mounted = r.writes(); r.nativeAcks[1](true);
assert.equal(r.writes(), mounted); assert.equal(r.state.activeWorkspaceId, "B");
assert.ok(r.nativeCancels.length > 0);
console.log("PASS native ACK precedes geometry/focus, timeout/rejection/switch cancel ownership");

const fallback = createRuntime({HoldNativeAck: true, HoldCancelAck: true});
fallback.shortcuts.get("CCScrollFocusNextColumn")();
const fallbackBefore = fallback.writes();
fallback.shortcuts.get("CCScrollFocusNextColumn")();
const pendingTimer = fallback.evaluate("scrollPlanCommitGate.pending.timer.timer");
pendingTimer.timeout.emit();
assert.equal(fallback.writes(), fallbackBefore, "fallback waits for ownership removal ACK");
assert.equal(fallback.workspace.activeWindow, fallback.a[1]);
fallback.cancelAcks.at(-1)();
assert.ok(fallback.writes() > fallbackBefore); assert.equal(fallback.workspace.activeWindow, fallback.a[2]);
fallback.nativeAcks[0](true);
assert.equal(fallback.evaluate("scrollPlanCommitGate.pending"), null, "late native ACK cannot recommit fallback");

const unavailable = createRuntime({HoldNativeAck: true, HoldCancelAck: true});
unavailable.shortcuts.get("CCScrollFocusNextColumn")();
unavailable.shortcuts.get("CCScrollFocusNextColumn")();
unavailable.evaluate("scrollPlanCommitGate.pending.timer.timer").timeout.emit();
unavailable.evaluate("scrollPlanCommitGate.pending.timer.timer").timeout.emit();
assert.equal(unavailable.workspace.activeWindow, unavailable.a[2], "unavailable cancel endpoint has bounded fallback");
const unavailableWrites = unavailable.writes(); unavailable.cancelAcks.at(-1)(); unavailable.nativeAcks[0](true);
assert.equal(unavailable.writes(), unavailableWrites, "late cancellation ACK cannot recommit");

const retained = [], retainedCommits = [], retainedArms = [];
let handoffEpoch = 9;
const handoff = new ScrollPlanCommitGate({
    publish: (_plan, cb) => cb(true), arm: (_plan, cb) => retainedArms.push(cb),
    disarm: (epoch, cb) => { retained.push(epoch); cb(); }, currentEpoch: () => handoffEpoch,
    setTimer: cb => cb, clearTimer: () => {}, warn: () => {},
    commit: plan => retainedCommits.push(plan.epoch), releaseDeferred: () => {},
});
handoff.activeEpoch = 8;
handoff.schedule({ epoch: 9 }, {}, {});
handoffEpoch = 10;
handoff.retainForLegacy();
assert.deepEqual(retained, [], "publishing a width plan must keep old and in-flight clipping");
retainedArms[0](true);
assert.deepEqual(retainedCommits, [], "late old arm ACK cannot commit the superseded width layout");
handoff.cancel();
assert.deepEqual(retained.sort(), [8, 9], "after legacy ACK both retained epochs retire before a cold width clip");
handoff.cancel();
assert.equal(retained.length, 2, "retirement is idempotent");
handoff.activeEpoch = 10;
handoff.retainForLegacy(); handoff.releaseForWorkspace(); handoff.cancel();
assert.equal(retained.length, 2, "workspace release transfers the retained clip without cancelling a departure");
