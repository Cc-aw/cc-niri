"use strict";
const assert = require("node:assert/strict");
const { computeColumnWidth, deriveColumnLayout, computeStripWidth,
    scrollOffsetToRevealColumn } = require("../src/kwin/layout/ColumnLayout");
const { computeLayoutPlan } = require("../src/kwin/layout/LayoutEngine");
const { WorkspaceSnapshotStore, normalizeWorkspaceSnapshot,
    migrateLegacyWorkspaceSnapshot } = require("../src/kwin/workspace/WorkspaceSnapshotStore");
const { WorkspacePersistence } = require("../src/kwin/workspace/WorkspacePersistence");

for (const width of [1, 17, 2512, 3792, 2512.5]) {
    for (const gap of [0, 8, 10000]) assert.equal(computeColumnWidth("full", width, gap), width);
}
assert.equal(computeColumnWidth("full", 0, 8), 1);
const safeRect = { x: 24, y: 50, width: 2512, height: 1382 };
const columns = ["half", "full", "half"].map((widthMode, index) => ({
    id: index + 1, window: { id: `w${index}` }, widthMode,
}));
deriveColumnLayout(columns, safeRect.width, 8).forEach((layout, index) => Object.assign(columns[index], layout));
assert.deepEqual(columns.map(c => [c.logicalX, c.pixelWidth]), [[0, 1252], [1260, 2512], [3780, 1252]]);
const strip = computeStripWidth(columns);
assert.equal(strip, 5032);
for (const offset of [0, 1260, 2520, 99999]) {
    assert.equal(scrollOffsetToRevealColumn(offset, columns[1], strip, safeRect.width), 1260);
}
const plan = computeLayoutPlan({ reason: "focus-next", epoch: 1, columns, safeRect,
    innerGap: 8, parkingBaseX: -10000, scrollOffsetX: 1260,
    scrollOffsets: { oldScrollOffsetX: 0, newScrollOffsetX: 1260 },
    presentedColumn: null, presentedRect: null });
assert.deepEqual(plan.windows[1].rect, safeRect);
assert.equal(plan.windows[1].placement, "visible");
assert.equal(plan.scrollTransaction.entries.find(e => e.windowId === "w1").pixelWidth, 2512);
assert.equal(plan.viewportMotion, null, "Full uses ordinary SCROLL, without Wide motion");

const modes = ["third", "half", "twoThirds", "full"];
const raw = { columns: modes.map((widthMode, index) => ({ uuid: `w${index}`, widthMode,
    persistentWide: true, columnId: index, window: {} })) };
const normalized = normalizeWorkspaceSnapshot("A", raw);
assert.deepEqual(normalized.columns.map(c => c.widthMode), modes);
assert.equal(normalized.columns.at(-1).persistentWide, true);
assert.deepEqual(Object.keys(normalized.columns.at(-1)).sort(), ["persistentWide", "previousNonFullWidthMode", "uuid", "widthMode"]);
const legacy = migrateLegacyWorkspaceSnapshot({ ...raw, protocol: 1, targetOutput: "DP-1" }, "A", "DP-1");
assert.deepEqual(legacy.columns, normalized.columns, "protocol 1 retains old modes and Full");
const snapshots = new WorkspaceSnapshotStore();
snapshots.set("A", normalized);
snapshots.set("B", { columns: [{ uuid: "other", widthMode: "full" }] });
const persistence = new WorkspacePersistence({ snapshots, hasDesktop: () => true });
const saved = persistence.snapshot({ protocol: 2, targetOutput: "DP-1", workspaceId: "A", columns: raw.columns });
const restored = new WorkspaceSnapshotStore();
const loader = new WorkspacePersistence({ snapshots: restored, hasDesktop: () => true });
assert.equal(loader.restore(JSON.stringify(saved), "B", "DP-1"), true);
assert.deepEqual(restored.all(), snapshots.all());
const before = restored.all();
const mismatch = JSON.parse(JSON.stringify(saved));
mismatch.columns.at(-1).widthMode = "half";
assert.equal(loader.restore(mismatch, "A", "DP-1"), false);
assert.deepEqual(restored.all(), before, "Full/root width mismatch is rejected atomically");
console.log("PASS Full strip geometry, SCROLL protocol and protocol 1/2 persistent width roundtrip");
