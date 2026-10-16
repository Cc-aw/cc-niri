"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { WorkspaceSnapshotStore, normalizeWorkspaceSnapshot } = require("../src/kwin/workspace/WorkspaceSnapshotStore");
const { WorkspacePersistence } = require("../src/kwin/workspace/WorkspacePersistence");
const { createRuntime } = require("./helpers/workspace-runtime");
const width = (mode = "twoThirds", previous = "twoThirds") => ({ version: 1, widthMode: mode, previousNonFullWidthMode: previous });
const basis = { outputRect: { x: 0, y: 0, width: 2560, height: 1440 },
    workingArea: { x: 0, y: 50, width: 2560, height: 1390 }, gap: 16, physicalScale: 1 };
function saved() {
    const active = { columns: [{ uuid: "a0", widthMode: "twoThirds", widthV2: width(), persistentWide: true }],
        focusedUuid: "a0", viewportAnchor: null, viewportAnchorV2: { version: 1, uuid: "a0", delta: -440, basis },
        dormantViewportV1: { version: 1, mode: "wide", wideUuid: "a0" } };
    return { protocol: 2, sessionId: "old", generation: 50, targetOutput: "eDP-1", workspaceId: "A",
        ...structuredClone(active), workspaces: [{ id: "A", ...structuredClone(active) }] };
}
const plain = value => JSON.parse(JSON.stringify(value));
test("protocol 1/2 historical widths migrate to half; versioned 2/3 and signed anchors survive", () => {
    for (const protocol of [1, 2]) {
        const snapshots = new WorkspaceSnapshotStore(), persistence = new WorkspacePersistence({ snapshots, hasDesktop: () => true });
        const old = { ...saved(), protocol, columns: [{ uuid: "a0", widthMode: "twoThirds" }], viewportAnchorV2: undefined };
        old.workspaces = [{ id: "A", columns: old.columns, viewportAnchor: { uuid: "a0", delta: 40 } }];
        assert.equal(persistence.restore(old, "A", "eDP-1"), true);
        assert.equal(snapshots.get("A").columns[0].widthMode, "half");
        assert.equal(persistence.restore(saved(), "A", "eDP-1"), true);
        assert.equal(snapshots.get("A").columns[0].widthMode, "twoThirds");
        assert.equal(snapshots.get("A").viewportAnchorV2.delta, -440);
        assert.equal(snapshots.get("A").viewportAnchor, null);
    }
});
test("full remembers versioned 2/3 independently of the V1 projection", () => {
    const data = { columns: [{ uuid: "a0", widthMode: "full", previousNonFullWidthMode: "twoThirds", widthV2: width("full") }] };
    const normalized = normalizeWorkspaceSnapshot("A", data);
    assert.equal(normalized.columns[0].previousNonFullWidthMode, "twoThirds");
    delete data.columns[0].widthV2;
    assert.equal(normalizeWorkspaceSnapshot("A", data).columns[0].previousNonFullWidthMode, "half");
});
test("invalid versioned data and root/active conflicts are rejected atomically", () => {
    const bad = [];
    for (const field of ["version", "widthMode", "previousNonFullWidthMode"]) {
        const state = saved(); state.columns[0].widthV2[field] = field === "version" ? 2 : "invalid"; bad.push(state);
    }
    for (const delta of [NaN, Infinity, "-440", -10000001]) {
        const state = saved(); state.viewportAnchorV2.delta = delta; bad.push(state);
    }
    for (const mutate of [s => { s.columns[0].widthV2 = width("half", "half"); },
        s => { s.viewportAnchorV2.delta = -400; }, s => { s.workspaces[0].viewportAnchorV2.version = 2; },
        s => { s.workspaces[0].viewportAnchorV2.basis.workingArea.height = 0; },
        s => { s.workspaces.push({ id: "B", columns: s.columns }); },
        s => { s.workspaces[0].columns = Array.from({ length: 257 }, (_, i) => ({ uuid: `x${i}` })); }]) {
        const state = saved(); mutate(state); bad.push(state);
    }
    for (const state of bad) {
        const snapshots = new WorkspaceSnapshotStore(); snapshots.set("kept", { columns: [{ uuid: "untouched" }] });
        const p = new WorkspacePersistence({ snapshots, hasDesktop: () => true });
        assert.equal(p.restore(state, "A", "eDP-1"), false);
        assert.equal(snapshots.get("kept").columns[0].uuid, "untouched");
    }
});
test("normalization clones metadata, removes dangling references and excludes transient objects", () => {
    const snapshots = new WorkspaceSnapshotStore(); snapshots.set("A", saved().workspaces[0]);
    const detached = snapshots.get("A"); detached.columns[0].widthV2.widthMode = "half"; detached.viewportAnchorV2.basis.outputRect.width = 1;
    assert.equal(snapshots.get("A").viewportAnchorV2.basis.outputRect.width, 2560);
    assert.equal(snapshots.get("A").columns[0].widthV2.widthMode, "twoThirds");
    snapshots.removeWindow("a0");
    assert.equal(snapshots.get("A").viewportAnchorV2, null);
    assert.equal(snapshots.get("A").dormantViewportV1.wideUuid, null);
    const state = saved(); state.workspaces[0].columns[0].window = { destroyed: true };
    snapshots.set("A", state.workspaces[0]);
    assert.ok(!JSON.stringify(snapshots.all()).includes("destroyed"));
});
test("actual entry V2 -> V1 -> V2 preserves width, signed view and dormant Wide", () => {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true, PrimaryWindowCount: 1, PreviousState: saved() });
    r.paintV2(); assert.equal(r.state.columns[0].widthMode, "twoThirds");
    const v2 = plain(r.published.at(-1));
    assert.equal(v2.viewportAnchorV2.delta, -440);
    const old = createRuntime({ PrimaryWindowCount: 1, PreviousState: v2 });
    assert.equal(old.state.columns[0].widthMode, "half");
    assert.equal(old.state.columns[0].persistentWide, true);
    assert.equal(old.state.viewport.mode, "wide-focus");
    const roundTrip = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true, PrimaryWindowCount: 1, PreviousState: plain(old.published.at(-1)) });
    roundTrip.paintV2(); assert.equal(roundTrip.state.columns[0].widthMode, "twoThirds");
    assert.equal(roundTrip.state.viewport.mode, "pair");
    const before = roundTrip.state.columns[0].widthMode;
    roundTrip.shortcuts.get("CCScrollToggleFocusWide")();
    assert.equal(roundTrip.state.columns[0].widthMode, before);
    assert.equal(roundTrip.state.columns[0].persistentWide, true);
});
test("changed scale/workarea recomputes center instead of replaying a stale signed delta", () => {
    const state = saved(); state.viewportAnchorV2.delta = -10; state.workspaces[0].viewportAnchorV2.delta = -10;
    state.viewportAnchorV2.basis.physicalScale = 1.5; state.workspaces[0].viewportAnchorV2.basis.physicalScale = 1.5;
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true, PrimaryWindowCount: 1, PreviousState: state });
    assert.equal(r.state.scrollOffsetX, 212);
    assert.equal(r.state.columns[0].logicalX, 652);
});
test("recycled workspaces are discarded and a 256-column snapshot remains below the Bridge limit", () => {
    const snapshots = new WorkspaceSnapshotStore(), p = new WorkspacePersistence({ snapshots, hasDesktop: id => id === "A" });
    const state = saved(); state.workspaces.push({ id: "removed", columns: [{ uuid: "gone" }] });
    assert.equal(p.restore(state, "A", "eDP-1"), true); assert.equal(snapshots.has("removed"), false);
    const columns = Array.from({ length: 256 }, (_, i) => ({ uuid: `window-${i}`, widthMode: "twoThirds", widthV2: width() }));
    snapshots.set("A", { columns });
    const data = p.snapshot({ workspaceId: "A", columns });
    assert.ok(Buffer.byteLength(JSON.stringify(data)) < 1024 * 1024);
});
