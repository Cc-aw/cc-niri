const assert = require("node:assert/strict");
const { WindowDisposition, WindowPolicy, isPlasmaShellWindow } =
    require("../src/kwin/policy/WindowPolicy");

const policy = new WindowPolicy();
const normal = {
    managed: true, normalWindow: true, moveable: true,
    resizeable: true, maximizable: true,
};
const classify = overrides => policy.classify({ ...normal, ...overrides });
assert.equal(classify({}).kind, WindowDisposition.MANAGED_ELIGIBLE);
assert.equal(policy.canJoinColumn(normal), true);
assert.equal(policy.managedLayoutEligible(normal), true);

for (const type of ["dialog", "modal", "transient", "utility", "toolbar"]) {
    const parent = { internalId: "parent" };
    const decision = classify({ [type]: true, transientFor: parent });
    assert.equal(decision.kind, WindowDisposition.POLICY_FLOATING, type);
    assert.equal(decision.reason, type);
    assert.equal(decision.parent, parent);
    assert.equal(policy.canJoinColumn({ ...normal, [type]: true }), false);
    assert.equal(policy.managedLayoutEligible({ ...normal, [type]: true }), false);
}
for (const type of ["popupWindow", "dropdownMenu", "menu", "splash",
    "dock", "desktopWindow", "specialWindow", "skipTaskbar"]) {
    assert.equal(classify({ [type]: true }).kind,
        WindowDisposition.NATIVE_ONLY, type);
}
assert.equal(classify({ popupWindow: true, transient: true }).kind,
    WindowDisposition.NATIVE_ONLY, "popup wins over transient");
assert.equal(classify({ dialog: true, skipTaskbar: true }).kind,
    WindowDisposition.POLICY_FLOATING, "dialog wins over skipTaskbar");
assert.equal(classify({ managed: false }).kind, WindowDisposition.NATIVE_ONLY);
assert.equal(classify({ normalWindow: false }).kind, WindowDisposition.NATIVE_ONLY);
assert.equal(classify({ moveable: false }).kind, WindowDisposition.NATIVE_ONLY);
assert.equal(classify({ resizeable: false }).kind, WindowDisposition.NATIVE_ONLY);
assert.equal(policy.managedLayoutEligible({ ...normal, maximizable: false }), false);
assert.equal(isPlasmaShellWindow({ resourceClass: "plasmashell" }), true);
assert.equal(classify({ desktopFileName: "org.kde.plasmashell" }).kind,
    WindowDisposition.NATIVE_ONLY);

console.log("PASS WindowPolicy classifies semantic ownership and layout eligibility");
