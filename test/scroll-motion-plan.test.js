"use strict";
const assert = require("node:assert/strict");
const { computeLayoutPlan } = require("../src/kwin/layout/LayoutEngine");
const { createViewportScrollPlan } = require("../src/kwin/layout/ScrollMotionPlan");
const { createRuntime } = require("./helpers/workspace-runtime");
const columns = [0, 1, 2, 3].map(index => ({ id: index + 1,
    logicalX: index * 1260.25, pixelWidth: 1252.25,
    window: { internalId: `{UUID-${index}}` } }));
const layout = computeLayoutPlan({ reason: "focus-next", epoch: 41, columns,
    safeRect: { x: -1920, y: 50, width: 2512.5, height: 1320 }, innerGap: 8,
    parkingBaseX: -99999, scrollOffsetX: 1260.25,
    scrollOffsets: { oldScrollOffsetX: 0, newScrollOffsetX: 1260.25 } });
const context = { workspaceId: "workspace", targetOutput: "eDP-1", issuedAt: 100,
    normalizeUuid: uuid => uuid.replace(/[{}]/g, "").toLowerCase() };
const plan = createViewportScrollPlan(layout.scrollTransaction, context);
assert.equal(plan.protocol, 2);
assert.equal(plan.epoch, 41);
assert.equal(plan.oldScrollOffsetX, 0);
assert.equal(plan.newScrollOffsetX, 1260.25);
assert.deepEqual(plan.entries.map(e => [e.windowId, e.logicalX, e.pixelWidth]),
    [["uuid-0", 0, 1252.25], ["uuid-1", 1260.25, 1252.25], ["uuid-2", 2520.5, 1252.25]]);
assert.ok(plan.entries.every(e => e.logicalX !== -99999), "logical coordinates never inherit parking geometry");
plan.entries[0].logicalX = 55; plan.viewport.x = 55;
assert.equal(layout.scrollTransaction.entries[0].logicalX, 0);
assert.equal(layout.scrollTransaction.viewport.x, -1920, "envelope has no mutable plan aliases");
assert.equal(createViewportScrollPlan(null, context), null);
assert.equal(createViewportScrollPlan(layout.scrollTransaction, {...context, workspaceId: null}), null);

const r = createRuntime({ DynamicTrailingWorkspace: true, AutoRecycleWorkspaces: true });
const next = () => r.shortcuts.get("CCScrollFocusNextColumn")();
const previous = () => r.shortcuts.get("CCScrollFocusPreviousColumn")();
assert.equal(r.motionPlans.length, 0);
next();
assert.equal(r.motionPlans.length, 0, "focus inside same pair has no scroll plan");
const beforePublish = r.writes();
next();
assert.equal(r.motionPublishWrites[0], beforePublish, "plan is sent before geometry writes");
assert.ok(r.writes() > beforePublish);
assert.equal(r.motionPlans.length, 1);
const first = r.motionPlans[0];
assert.equal(first.protocol, 2); assert.equal(first.type, "SCROLL");
assert.equal(first.workspaceId, "A"); assert.equal(first.targetOutput, "eDP-1");
assert.equal(first.oldScrollOffsetX, 0);
assert.equal(first.newScrollOffsetX, 1260);
assert.deepEqual(first.entries.map(e => e.windowId), ["a0", "a1", "a2"]);
assert.equal(r.workspace.activeWindow, r.a[2], "geometry/focus commit does not await telemetry ACK");
assert.equal(r.evaluate("motionPlanCommitGate.pending"), null, "Wide gate not used by observer SCROLL");
next(); previous(); previous();
const plans = r.motionPlans.filter(p => p.type === "SCROLL");
assert.equal(plans.length, 3);
assert.ok(plans[0].epoch < plans[1].epoch && plans[1].epoch < plans[2].epoch);
assert.equal(plans[2].oldScrollOffsetX, 2520); assert.equal(plans[2].newScrollOffsetX, 1260);
const order = r.ids();
r.nativeSwitch(1, r.b[0]);
const writes = r.writes();
r.motionAcks[0](false); // Late rejection of A after mounting B is data-only.
assert.equal(r.writes(), writes); assert.equal(r.state.activeWorkspaceId, "B");
assert.deepEqual(r.ids(), ["b0", "b1"]);
r.nativeSwitch(0, r.a[1]);
assert.deepEqual(r.ids(), order, "publishing preserves workspace order");
assert.ok(!r.logs.some(line => /INVARIANT_FAIL|FAIL_SAFE/.test(line)));
console.log("PASS explicit SCROLL plans preserve existing geometry/focus and workspace barriers");

const missing = createRuntime();
missing.evaluate(`const originalInvoke = dockGateway.invoke;
    dockGateway.invoke = function(...args) {
        if (args[3] === "PublishMotionPlan") throw new Error("Bridge unavailable");
        return originalInvoke(...args);
    };`);
missing.shortcuts.get("CCScrollFocusNextColumn")();
missing.shortcuts.get("CCScrollFocusNextColumn")();
assert.equal(missing.workspace.activeWindow, missing.a[2], "synchronous IPC error does not block H/L");
assert.ok(missing.logs.some(line => /SCROLL_PLAN.*publish unavailable/.test(line)));
