"use strict";
const assert = require("node:assert/strict");
const { WorkspacePersistence } = require("../src/kwin/workspace/WorkspacePersistence");
const { WorkspaceSnapshotStore } = require("../src/kwin/workspace/WorkspaceSnapshotStore");
function fixture() {
    const snapshots = new WorkspaceSnapshotStore();
    const persistence = new WorkspacePersistence({ snapshots, hasDesktop: id => ["A", "B", "C"].includes(id) });
    return { snapshots, persistence };
}
const a = { id: "A", columns: [{ uuid: "a2", widthMode: "third", persistentWide: true }, { uuid: "a1" }],
    focusedUuid: "a2", viewportAnchor: { uuid: "a1", delta: 40 } };
const b = { id: "B", columns: [{ uuid: "b1" }], focusedUuid: "b1" };
const state = { protocol: 2, sessionId: "old", generation: 30, workspaceId: "B", targetOutput: "eDP-1",
    columns: b.columns, workspaces: [a, b] };
{
    const { snapshots, persistence } = fixture();
    assert.equal(persistence.restore(JSON.stringify(state), "A", "eDP-1"), true);
    assert.deepEqual(snapshots.get("A").columns.map(c => c.uuid), ["a2", "a1"]);
    assert.equal(snapshots.get("A").columns[0].persistentWide, true);
    assert.deepEqual(snapshots.get("A").viewportAnchor, { uuid: "a1", delta: 40 });
    assert.equal(snapshots.get("B").focusedUuid, "b1");
    const published = persistence.snapshot({ workspaceId: "A", columns: a.columns });
    assert.equal(published.workspaces[0].id, "A");
    assert.equal(published.workspaces[0].workspaceId, undefined);
    published.workspaces[0].columns.reverse();
    assert.equal(snapshots.get("A").columns[0].uuid, "a2");
}
{
    const { snapshots, persistence } = fixture();
    const legacy = { protocol: 1, targetOutput: "eDP-1", workspaceId: "B", columns: [{ uuid: "{A1}" }],
        viewportAnchor: { uuid: "a1", delta: 20 }, presentation: { mode: "wide", windowUuid: "a1" } };
    assert.equal(persistence.restore(legacy, "A", "eDP-1"), true);
    assert.equal(snapshots.has("B"), false); assert.equal(snapshots.get("A").focusedUuid, null);
    assert.equal(snapshots.get("A").viewport.wideUuid, "a1");
    assert.equal(snapshots.get("A").columns[0].persistentWide, true);
    assert.equal(persistence.restore({ ...state, workspaces: [...state.workspaces, { id: "removed", columns: [] }] }, "A", "eDP-1"), true);
    assert.equal(snapshots.has("removed"), false);
}
for (const invalid of ["bad json", null, { ...state, protocol: 99 }, { ...state, targetOutput: "DP-1" },
    { ...state, workspaces: null }, { ...state, workspaces: [a, a, b] },
    { ...state, workspaces: [a, { ...b, columns: [{ uuid: "{A2}" }] }] },
    { ...state, workspaces: [{ ...a, columns: [{ uuid: "" }] }, b] },
    { ...state, workspaces: [{ ...a, columns: [{ uuid: "a1" }, { uuid: "A1" }] }, b] },
    { ...state, workspaces: [a] }, { ...state, columns: [{ uuid: "different" }] }]) {
    const { snapshots, persistence } = fixture(); snapshots.set("C", { columns: [{ uuid: "kept" }] });
    assert.equal(persistence.restore(invalid, "A", "eDP-1"), false);
    assert.equal(snapshots.get("C").columns[0].uuid, "kept", "invalid restore must be atomic");
}
console.log("PASS multi-workspace persistence, protocol 1 migration and atomic invalid-data rejection");
