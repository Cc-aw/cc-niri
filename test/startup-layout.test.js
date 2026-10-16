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
assert.equal(layout.insertionIndex(windowFor("b"), [
    { window: windowFor("a") },
    { window: windowFor("c") },
    { window: windowFor("new") },
]), 1, "a late saved window returns to its original slot");
assert.equal(layout.insertionIndex(windowFor("new"), []), -1);
assert.equal(layout.load(JSON.stringify({ ...previous, targetOutput: "HDMI-1" })), false);
assert.equal(layout.insertionIndex(windowFor("a"), []), -1,
    "an unrelated output cannot restore stale order");
assert.equal(layout.load("invalid JSON"), false);
assert.equal(layout.load(JSON.stringify({
    ...previous,
    columns: [{ uuid: "a" }, { uuid: "a" }],
})), false);

console.log("PASS legacy startup order restores late slots and rejects invalid snapshots");
