"use strict";

const assert = require("node:assert/strict");
const {
    WorkspaceSnapshotStore, normalizeWorkspaceSnapshot, migrateLegacyWorkspaceSnapshot,
} = require("../src/kwin/workspace/WorkspaceSnapshotStore");

const raw = {
    columns: [null, { uuid: " {A} ", widthMode: "third", persistentWide: true,
        window: { internalId: "live" }, columnId: 99 }, { uuid: "a" },
    { uuid: "B", widthMode: "twoThirds" }, { uuid: 42 }, { uuid: "c", widthMode: "bad" }],
    focusedUuid: "{B}", viewportAnchor: { uuid: "{A}", delta: 12 },
    viewport: { mode: "wide", wideUuid: "B", pendingReveal: true },
    presentation: { mode: "maximized", windowUuid: "{B}", pendingExit: true },
    pendingPark: true, scrollOffsetX: 999, focusedColumnIndex: 2,
};
const expected = {
    workspaceId: "WS-A",
    columns: [
        { uuid: "a", widthMode: "half", previousNonFullWidthMode: "half", persistentWide: true },
        { uuid: "b", widthMode: "half", previousNonFullWidthMode: "half", persistentWide: false },
        { uuid: "c", widthMode: "half", previousNonFullWidthMode: "half", persistentWide: false },
    ],
    focusedUuid: "b", viewportAnchor: { uuid: "a", delta: 0 },
    viewport: { mode: "wide", wideUuid: "b" },
    presentation: { mode: "maximized", windowUuid: "b" },
};
assert.deepEqual(normalizeWorkspaceSnapshot(" WS-A ", raw), expected);
assert.deepEqual(normalizeWorkspaceSnapshot("WS-A", null), {
    workspaceId: "WS-A", columns: [], focusedUuid: null, viewportAnchor: null,
    viewport: { mode: "pair", wideUuid: null },
    presentation: { mode: "normal", windowUuid: null },
});
for (const delta of [-1, Infinity, NaN, "12", null]) {
    assert.equal(normalizeWorkspaceSnapshot("A", { ...raw, viewportAnchor: { uuid: "a", delta } }).viewportAnchor, null);
}
const dangling = normalizeWorkspaceSnapshot("A", {
    columns: [{ uuid: "a" }], focusedUuid: "missing",
    viewportAnchor: { uuid: "missing", delta: 0 },
    viewport: { mode: "wide", wideUuid: "missing" },
    presentation: { mode: "wide", windowUuid: "missing" },
});
assert.equal(dangling.focusedUuid, null);
assert.equal(dangling.viewportAnchor, null);
assert.deepEqual(dangling.viewport, { mode: "pair", wideUuid: null });
assert.deepEqual(dangling.presentation, { mode: "normal", windowUuid: null });
assert.throws(() => normalizeWorkspaceSnapshot("", raw), TypeError);

const store = new WorkspaceSnapshotStore();
const saved = store.set("WS-A", raw);
assert.deepEqual(saved, expected);
raw.columns[1].uuid = "changed";
saved.columns[0].uuid = "changed";
store.get("WS-A").viewportAnchor.delta = 999;
store.all()[0].columns.pop();
assert.deepEqual(store.get("WS-A"), expected, "input and all returned data are detached copies");
assert.equal(store.workspaceForWindow("{A}"), "WS-A");
assert.equal(store.has(" WS-A "), true);
assert.equal(store.get("missing"), null);
store.set("WS-B", { columns: [{ uuid: "d" }] });
assert.throws(() => store.set("WS-B", { columns: [{ uuid: "A" }] }), /duplicate-workspace-owner:a/);
assert.equal(store.workspaceForWindow("d"), "WS-B", "rejected replacement must be atomic");
assert.equal(store.get("WS-B").columns[0].uuid, "d");
store.set("WS-A", { ...expected, columns: expected.columns.slice(1) });
assert.equal(store.workspaceForWindow("a"), null, "replacement drops stale owner entries");
assert.equal(store.get("WS-A").viewportAnchor, null);
store.set("WS-B", { columns: [{ uuid: "d" }, { uuid: "a" }] });
assert.equal(store.workspaceForWindow("a"), "WS-B");
assert.equal(store.removeWindow("{B}"), true);
const afterClose = store.get("WS-A");
assert.equal(afterClose.focusedUuid, null);
assert.deepEqual(afterClose.viewport, { mode: "pair", wideUuid: null });
assert.deepEqual(afterClose.presentation, { mode: "normal", windowUuid: null });
assert.equal(store.removeWindow("missing"), false);
assert.equal(store.remove("WS-B"), true);
assert.equal(store.workspaceForWindow("a"), null);
assert.equal(store.remove("WS-B"), false);
store.clear();
assert.deepEqual(store.all(), []);
assert.equal(store.workspaceForWindow("c"), null);

const legacy = {
    protocol: 1, targetOutput: "DP-1", columns: [{ uuid: "{A}", widthMode: "half" }, { uuid: "B" }],
    focusedUuid: "B", viewportAnchor: { uuid: "A", delta: 8 },
    presentation: { mode: "wide", windowUuid: "B" },
};
const migrated = migrateLegacyWorkspaceSnapshot(legacy, "current-desktop-id", "DP-1");
assert.equal(migrated.workspaceId, "current-desktop-id");
assert.deepEqual(migrated.columns.map(column => column.uuid), ["a", "b"]);
assert.deepEqual(migrated.viewportAnchor, { uuid: "a", delta: 8 });
assert.deepEqual(migrated.viewport, { mode: "wide", wideUuid: "b" });
assert.equal(migrated.columns[1].persistentWide, true, "legacy active Wide implies the Column preference");
assert.deepEqual(migrateLegacyWorkspaceSnapshot(JSON.stringify(legacy), "current-desktop-id", "DP-1"), migrated);
for (const invalid of [null, "bad json", { ...legacy, protocol: 2 },
    { ...legacy, columns: {} }, { ...legacy, columns: [{ uuid: "a" }, { uuid: "{A}" }] },
    { ...legacy, columns: [{ uuid: null }] }]) {
    assert.equal(migrateLegacyWorkspaceSnapshot(invalid, "current-desktop-id", "DP-1"), null);
}
assert.equal(migrateLegacyWorkspaceSnapshot(legacy, "current-desktop-id", "HDMI-1"), null);
assert.equal(migrateLegacyWorkspaceSnapshot(legacy, "", "DP-1"), null);
assert.equal(legacy.columns[0].uuid, "{A}", "migration must not mutate protocol 1 data");
store.set(migrated.workspaceId, migrated);
assert.equal(store.workspaceForWindow("A"), "current-desktop-id");
console.log("PASS workspace snapshots normalize stable data, protect UUID ownership and migrate protocol 1");
