"use strict";
const assert = require("node:assert/strict");
const { InvariantChecker } = require("../src/kwin/stability/InvariantChecker");
const { StabilitySupervisor } = require("../src/kwin/stability/StabilitySupervisor");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
const a = { id: "A" }; const b = { id: "B" }; const output = { name: "eDP-1" };
const window = { internalId: "uuid", desktops: [a], onAllDesktops: false, output };
const state = { managedByScrollLayout: true, columnId: 1, floating: false, adoptionPhase: "managed", workspaceOwnerId: "A" };
const sleeping = { internalId: "sleeping", desktops: [b], output };
const sleepingState = { managedByScrollLayout: false, columnId: null, workspaceOwnerId: "B" };
const states = new Map([[window, state], [sleeping, sleepingState]]);
const snapshots = { all: () => [{ workspaceId: "A", columns: [{ uuid: "uuid" }] },
    { workspaceId: "B", columns: [{ uuid: "sleeping" }] }] };
const appState = { activeWorkspaceId: "A", targetOutput: output, columns: [{ id: 1, window, logicalX: 0, pixelWidth: 100 }],
    innerGap: 8, safeRect: { width: 100 }, focusedColumnIndex: 0, scrollOffsetX: 0,
    viewport: { mode: "pair", wideColumnId: null }, presentation: { mode: "normal", windowUuid: null } };
const checker = new InvariantChecker({ appState, windowStates: states,
    workspaceMembership: new WorkspaceMembership(), workspaceSnapshots: snapshots,
    normalizeUuid: uuid => uuid, stripWidth: () => 100, managedPhases: ["managed"], normalPresentationMode: "normal" });
const supervisor = new StabilitySupervisor({});
assert.deepEqual(checker.errors(), [], "sleeping snapshots are independent from the active live graph");
window.desktops = [b]; state.workspaceOwnerId = "B";
for (const error of ["wrong-workspace:uuid", "mounted-workspace-owner:uuid", "inactive-mounted:uuid"]) {
    assert.ok(checker.errors().includes(error)); assert.equal(supervisor.isCritical(error), true);
}
window.desktops = [a]; state.workspaceOwnerId = "A";
sleepingState.columnId = 77;
assert.deepEqual(checker.errors(), ["inactive-mounted:sleeping"]);
sleepingState.columnId = null;
snapshots.all = () => [{ workspaceId: "A", columns: [{ uuid: "uuid" }] }, { workspaceId: "B", columns: [{ uuid: "uuid" }] }];
assert.deepEqual(checker.errors(), ["duplicate-workspace-owner:uuid"]);
assert.equal(supervisor.isCritical("duplicate-workspace-owner:uuid"), true);
console.log("PASS workspace membership, mounted ownership and UUID snapshot conflicts are critical invariants");
