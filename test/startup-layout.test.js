const assert = require("node:assert/strict");
const { StartupLayout } = require("../src/kwin/runtime/StartupLayout");

const windowFor = id => ({ internalId: `{${id}}` });
const layout = new StartupLayout({
    normalizeUuid: value => String(value || "").toLowerCase()
        .replace(/^\{/, "").replace(/\}$/, ""),
    targetOutput: () => "DP-1",
});
const previous = {
    protocol: 1,
    targetOutput: "DP-1",
    columns: ["a", "b", "c"].map(uuid => ({ uuid })),
    viewportAnchor: { uuid: "b", delta: 12 },
};
assert.equal(layout.load(JSON.stringify(previous)), true);
assert.deepEqual(layout.orderWindows([
    windowFor("c"), windowFor("new"), windowFor("a")
]).map(window => window.internalId), ["{a}", "{c}", "{new}"]);
assert.equal(layout.insertionIndex(windowFor("b"), [
    { window: windowFor("a") },
    { window: windowFor("c") },
    { window: windowFor("new") },
]), 1, "a late saved window returns to its original slot");
assert.equal(layout.insertionIndex(windowFor("new"), []), -1);
assert.equal(layout.restoreOffset([
    { window: windowFor("b"), logicalX: 600 },
], 0, offset => Math.min(offset, 700)), 612);
assert.equal(layout.restoreOffset([], 45, offset => offset), 45);
assert.equal(layout.load(JSON.stringify({ ...previous, targetOutput: "HDMI-1" })), false);
assert.deepEqual(layout.orderWindows([windowFor("c"), windowFor("a")])
    .map(window => window.internalId), ["{c}", "{a}"],
"an unrelated output cannot restore stale order");
assert.equal(layout.load("invalid JSON"), false);
assert.equal(layout.load(JSON.stringify({
    ...previous,
    columns: [{ uuid: "a" }, { uuid: "a" }],
})), false);

console.log("PASS startup layout restores saved order, late slots, and viewport anchor");
