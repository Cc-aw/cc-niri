"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const key = (r, number) => r.shortcuts.get(`CCScrollWorkspace${number}`)();
const snapshot = (r, id) => r.published.at(-1).workspaces.find(w => w.id === id);
function fixture(config = {}) {
    const r = createRuntime(config), requests = [];
    r.workspace.setCurrentDesktopForScreen = (desktop, output) => {
        assert.equal(output, r.output, "direct navigation targets only the managed output");
        requests.push(desktop.id);
        r.nativeSwitch(r.desktops.indexOf(desktop), r.workspace.windowList().find(w => w.desktops[0] === desktop));
    };
    return { ...r, requests };
}
function check(r) {
    assert.equal(r.state.enabled, true, r.logs.join("\n"));
    assert.deepEqual(Array.from(r.evaluate("invariantChecker.errors()")), []);
    assert.equal(r.evaluate("workspaceSwitchController.phase"), "IDLE");
    assert.equal(r.logs.some(line => /INVARIANT.*errors=|FAIL_SAFE/.test(line)), false, r.logs.join("\n"));
    for (const state of r.published) {
        const active = state.workspaces.find(w => w.id === state.workspaceId);
        assert.deepEqual(state.columns, active.columns.map(c => ({ uuid: c.uuid, widthMode: c.widthMode })));
        const owners = state.workspaces.flatMap(w => w.columns.map(c => c.uuid));
        assert.equal(new Set(owners).size, owners.length);
    }
}
{
    const r = fixture(); const membership = r.workspace.windowList().map(w => [w.internalId, Array.from(w.desktops, d => d.id)]);
    const generation = r.published.at(-1).generation;
    assert.equal(key(r, 3), true); // Skip occupied B and mount the existing empty C.
    assert.deepEqual(r.requests, ["C"]);
    assert.deepEqual(r.ids(), []); assert.equal(r.state.activeWorkspaceId, "C");
    assert.equal(r.published.at(-1).generation, generation + 1, "one switch transaction, not repeated J/K");
    assert.equal(key(r, 1), true); assert.deepEqual(r.ids(), r.a.map(w => w.internalId));
    assert.equal(key(r, 2), true); assert.deepEqual(r.ids(), ["b0", "b1"]);
    assert.deepEqual(r.workspace.windowList().map(w => [w.internalId, Array.from(w.desktops, d => d.id)]), membership,
        "P5 only changes the current desktop, never window membership");
    assert.equal(r.desktopCreates.length, 0);
    check(r);
}
{
    const r = fixture(); const count = r.published.length, writes = r.writes();
    for (const number of [1, 4, 5, 6, 7, 8, 9]) assert.equal(key(r, number), false);
    for (const invalid of [0, -1, 10, 1.5, "2", null, NaN, Infinity])
        assert.equal(r.evaluate("workspaceSwitchController").focusNumber(invalid), false);
    assert.equal(r.published.length, count); assert.equal(r.writes(), writes);
    assert.deepEqual(r.requests, []); assert.equal(r.desktopCreates.length, 0);
    check(r);
}
for (const busy of ["disabled", "mount-stopped", "mounting", "no-output"]) {
    const r = fixture(); const count = r.published.length, writes = r.writes();
    if (busy === "disabled") r.state.enabled = false;
    if (busy === "mount-stopped") r.evaluate("workspaceMountController.stopped = true");
    if (busy === "mounting") r.state.workspaceSwitching = true;
    if (busy === "no-output") r.evaluate("workspaceSwitchController.mount.refreshState = () => {}");
    if (busy === "no-output") r.state.targetOutput = null;
    assert.equal(key(r, 2), false, busy);
    assert.equal(r.published.length, count); assert.equal(r.writes(), writes);
    assert.deepEqual(r.requests, []);
}
{
    const r = fixture(); r.workspace.activeWindow = null;
    assert.equal(key(r, 2), true, "navigation also works without an active managed Column");
    assert.equal(r.state.activeWorkspaceId, "B");
    check(r);
}
{
    const r = fixture();
    for (let i = 0; i < 6; ++i) r.workspace.createDesktop(r.desktops.length, "");
    for (let number = 1; number <= 9; ++number) {
        key(r, number);
        assert.equal(r.state.activeWorkspaceId, r.desktops[number - 1].id, "each registered number has its own target");
    }
    assert.equal(r.desktopCreates.length, 6, "navigation does not create any additional desktop");
    assert.equal(r.shortcuts.has("CCScrollWorkspace10"), false);
    check(r);
}
{
    const r = fixture(); key(r, 2);
    r.workspace.createDesktop(0, "");
    assert.equal(key(r, 2), true); assert.equal(r.state.activeWorkspaceId, "A", "fresh order after insertion");
    r.workspace.removeDesktop(r.desktops[0]);
    assert.equal(key(r, 2), true); assert.equal(r.state.activeWorkspaceId, "B", "fresh order after removal");
    r.desktops.reverse(); r.workspace.desktopsChanged.emit();
    assert.equal(key(r, 1), true); assert.equal(r.state.activeWorkspaceId, "C", "fresh order after reordering");
    assert.equal(snapshot(r, "A").columns.length, 5);
    assert.equal(snapshot(r, "B").columns.length, 2);
    check(r);
}
{
    const r = fixture(); r.workspace.activeWindow = r.a[2];
    r.shortcuts.get("CCScrollToggleColumnFull")();
    const saved = snapshot(r, "A").columns;
    key(r, 3); key(r, 1);
    assert.deepEqual(snapshot(r, "A").columns, saved, "Full / previous width preferences survive a nonadjacent round trip");
    check(r);
}
{
    const r = fixture();
    r.workspace.activeWindow = r.a[2];
    r.shortcuts.get("CCScrollToggleFocusWide")(); r.motionAcks.at(-1)(true);
    key(r, 3);
    r.workspace.setCurrentDesktopForScreen = desktop => r.nativeSwitch(r.desktops.indexOf(desktop), r.a[2]);
    key(r, 1);
    assert.equal(r.state.viewport.mode, "wide-focus");
    assert.equal(r.state.columns[2].persistentWide, true);
    check(r);
}
for (const hold of ["HoldScrollAck", "HoldNativeAck", "HoldWidthAck"]) {
    const r = fixture({ [hold]: true });
    r.shortcuts.get(hold === "HoldWidthAck" ? "CCScrollCycleColumnWidth" : "CCScrollFocusNextColumn")();
    key(r, 3); key(r, 1);
    const writes = r.writes();
    r.motionAcks.forEach(callback => callback(true)); r.nativeAcks.forEach(callback => callback(true));
    assert.equal(r.writes(), writes, "late source motion ACK cannot overwrite the mounted workspace");
    check(r);
}
for (const finish of ["signal", "timeout", "deleted", "rejected", "stop"]) {
    const r = fixture();
    r.workspace.setCurrentDesktopForScreen = () => { if (finish === "rejected") throw new Error("request rejected"); };
    key(r, 2);
    const timer = r.evaluate("workspaceSwitchController.timer");
    if (finish !== "rejected") {
        assert.equal(key(r, 3), false, "same switch barrier rejects overlapping direct requests");
        assert.equal(r.shortcuts.get("CCScrollWorkspaceNext")(), false);
        assert.equal(r.shortcuts.get("CCScrollMoveColumnNextWorkspace")(), false);
    }
    if (finish === "signal") {
        r.workspace.createDesktop(0, "");
        r.nativeSwitch(r.desktops.findIndex(d => d.id === "B"), r.b[0]);
        assert.equal(r.state.activeWorkspaceId, "B", "in-flight request retains ID even when the number shifts");
    }
    if (finish === "timeout") {
        timer.timer.timeout.emit(); assert.equal(r.state.activeWorkspaceId, "A", "timeout mounts actual KDE authority");
    }
    if (finish === "deleted") {
        r.b.forEach(w => r.close(w)); r.workspace.removeDesktop(r.desktops[1]);
        assert.equal(r.state.activeWorkspaceId, "A");
        assert.equal(r.published.at(-1).workspaces.some(w => w.id === "B"), false);
    }
    if (finish === "stop") {
        r.evaluate("emergencyRestoreAllWindows('direct-stop')");
        const writes = r.writes(); timer.timer.timeout.emit();
        assert.equal(r.writes(), writes); assert.equal(key(r, 1), false);
    } else check(r);
}
console.log("PASS P5 direct workspace shortcuts: current order, ID authority, no-op boundaries, primary output, preferences and existing motion/switch barriers");
