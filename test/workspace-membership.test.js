"use strict";

const assert = require("node:assert/strict");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
const a = { id: "Desktop-A" };
const b = { id: "Desktop-B" };
const primary = { name: "eDP-1" };
const membership = new WorkspaceMembership({ getCurrentDesktop: output => output === primary ? a : b });
const normal = { desktops: [a], onAllDesktops: false };
assert.deepEqual(membership.desktopIds(normal), ["Desktop-A"]);
assert.equal(membership.isSingleDesktop(normal), true);
assert.equal(membership.isSticky(normal), false);
assert.equal(membership.ownerId(normal), "Desktop-A");
assert.equal(membership.belongsTo(normal, "Desktop-A"), true);
assert.equal(membership.belongsTo(normal, "desktop-a"), false, "stable desktop IDs preserve case");
assert.equal(membership.belongsToActive(normal, primary), true);
assert.equal(membership.belongsToActive(normal, null), false);
membership.desktopIds(normal).pop();
assert.equal(normal.desktops.length, 1);
for (const window of [null, {}, { desktops: [] }, { desktops: [a], onAllDesktops: true },
    { desktops: [a, b] }, { desktops: [a, a] }, { desktops: [{ id: "" }] },
    { desktops: [null] }, { desktops: [{ id: 1 }] }, { desktops: "A" }]) {
    assert.equal(membership.isSingleDesktop(window), false);
    assert.equal(membership.ownerId(window), null);
    assert.equal(membership.belongsTo(window, "Desktop-A"), false);
}
assert.equal(membership.isSticky({ desktops: [], onAllDesktops: false }), true,
    "KWin represents all-desktop membership with an empty desktop list");
assert.equal(membership.isSticky({ desktops: [a, b] }), false, "multi-desktop differs from sticky");
assert.equal(new WorkspaceMembership().belongsToActive(normal, primary), false, "unknown current desktop fails closed");
console.log("PASS workspace membership excludes sticky, multi-desktop and unknown membership");
