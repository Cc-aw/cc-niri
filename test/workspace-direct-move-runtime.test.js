"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const key = (r, number) => r.shortcuts.get(`CCScrollMoveColumnWorkspace${number}`)();
const snapshot = (r, id) => r.published.at(-1).workspaces.find(w => w.id === id);
function fixture(config = {}) {
    const r = createRuntime(config), requests = [];
    r.workspace.setCurrentDesktopForScreen = (desktop, output) => {
        assert.equal(output, r.output, "direct move follows only on the managed output");
        requests.push(desktop.id);
        r.nativeSwitch(r.desktops.indexOf(desktop), r.workspace.windowList().find(w => w.desktops[0] === desktop));
    };
    return { ...r, requests };
}
function check(r) {
    assert.equal(r.state.enabled, true, r.logs.join("\n"));
    assert.deepEqual(Array.from(r.evaluate("invariantChecker.errors()")), []);
    assert.equal(r.evaluate("workspaceMoveController.pending"), null);
    assert.equal(r.evaluate("workspaceSwitchController.phase"), "IDLE");
    assert.equal(r.logs.some(line => /INVARIANT.*errors=|FAIL_SAFE|move failed/.test(line)), false, r.logs.join("\n"));
    for (const state of r.published) {
        const active = state.workspaces.find(w => w.id === state.workspaceId);
        assert.deepEqual(state.columns, active.columns.map(c => ({ uuid: c.uuid, widthMode: c.widthMode })));
        const owners = state.workspaces.flatMap(w => w.columns.map(c => c.uuid));
        assert.equal(new Set(owners).size, owners.length, "one workspace owner per UUID at every publication");
    }
}
for (const index of [0, 1, 4]) for (const full of [false, true]) for (const number of [2, 3]) {
    const r = fixture(), window = r.a[index];
    r.workspace.activeWindow = window;
    if (full) r.shortcuts.get("CCScrollToggleColumnFull")();
    r.state.columns.find(c => c.window === window).persistentWide = true;
    r.evaluate("commitRuntimeState('direct-move-preference')");
    const preference = snapshot(r, "A").columns.find(c => c.uuid === window.internalId);
    const membership = r.workspace.windowList().filter(w => w !== window).map(w => [w.internalId, Array.from(w.desktops, d => d.id)]);
    const generation = r.published.at(-1).generation, target = r.desktops[number - 1].id;
    assert.equal(key(r, number), true);
    assert.deepEqual(r.requests, [target], "nonadjacent direct move does not traverse intermediate workspaces");
    assert.equal(r.published.at(-1).generation, generation + 1);
    assert.equal(r.state.activeWorkspaceId, target);
    assert.equal(r.workspace.activeWindow, window);
    assert.deepEqual(r.ids(), [...(number === 2 ? ["b0", "b1"] : []), window.internalId]);
    assert.deepEqual(snapshot(r, target).columns.at(-1), preference);
    assert.equal(snapshot(r, "A").focusedUuid, r.a[index === 4 ? 3 : index + 1].internalId);
    assert.equal(window.frameGeometry.width, full ? 2512 : 1252);
    assert.equal(window.minimized, false); assert.equal(window.opacity, 1);
    assert.equal(r.state.viewport.mode, "pair");
    assert.deepEqual(r.workspace.windowList().filter(w => w !== window).map(w => [w.internalId, Array.from(w.desktops, d => d.id)]), membership);
    assert.equal(key(r, 1), true);
    assert.deepEqual(snapshot(r, "A").columns.at(-1), preference);
    assert.equal(r.desktopCreates.length, 0);
    check(r);
}
{
    const r = fixture(), membership = r.a[0].desktops, writes = r.writes(), count = r.published.length;
    for (const number of [1, 4, 5, 6, 7, 8, 9]) assert.equal(key(r, number), false);
    for (const invalid of [0, -1, 10, 1.5, "2", null, NaN, Infinity])
        assert.equal(r.evaluate("workspaceMoveController").moveNumber(invalid), false);
    assert.deepEqual(r.a[0].desktops, membership); assert.equal(r.writes(), writes);
    assert.equal(r.published.length, count); assert.deepEqual(r.requests, []);
    assert.equal(r.desktopCreates.length, 0); check(r);
}
for (const condition of ["floating", "dialog", "transient", "secondary", "sticky", "multiple", "none", "disabled", "switching"]) {
    const r = fixture(), window = r.a[0];
    if (condition === "floating") r.shortcuts.get("CCScrollToggleFloating")();
    if (condition === "dialog") window.dialog = true;
    if (condition === "transient") window.transient = true;
    if (condition === "secondary") window.output = { name: "secondary" };
    if (condition === "sticky") { window.onAllDesktops = true; window.desktops = []; }
    if (condition === "multiple") window.desktops = [r.desktops[0], r.desktops[1]];
    if (condition === "none") r.workspace.activeWindow = null;
    if (condition === "disabled") r.state.enabled = false;
    if (condition === "switching") r.state.workspaceSwitching = true;
    const membership = window.desktops, count = r.published.length, writes = r.writes();
    assert.equal(key(r, 2), false, condition);
    assert.deepEqual(window.desktops, membership); assert.equal(r.published.length, count);
    assert.equal(r.writes(), writes); assert.deepEqual(r.requests, []);
}
{
    const r = fixture();
    for (let i = 0; i < 6; ++i) r.workspace.createDesktop(r.desktops.length, "");
    for (const number of [2, 3, 4, 5, 6, 7, 8, 9, 1]) {
        assert.equal(key(r, number), true);
        assert.equal(r.state.activeWorkspaceId, r.desktops[number - 1].id);
        assert.equal(r.workspace.activeWindow, r.a[0]);
        assert.equal(r.a[0].desktops[0].id, r.state.activeWorkspaceId);
    }
    assert.equal(r.desktopCreates.length, 6); assert.equal(r.shortcuts.has("CCScrollMoveColumnWorkspace10"), false);
    r.workspace.createDesktop(0, "");
    key(r, 2); assert.equal(r.state.activeWorkspaceId, "A", "same current ID after insertion is a no-op");
    key(r, 3); assert.equal(r.state.activeWorkspaceId, "B", "fresh numbering after insertion");
    r.workspace.removeDesktop(r.desktops[0]);
    key(r, 3); assert.equal(r.state.activeWorkspaceId, "C", "fresh numbering after removal");
    r.desktops.reverse(); r.workspace.desktopsChanged.emit();
    key(r, 1); assert.equal(r.state.activeWorkspaceId, r.desktops[0].id, "fresh numbering after reordering");
    check(r);
}
{
    const r = fixture({ HoldNativeAck: true, HoldCancelAck: true });
    r.shortcuts.get("CCScrollFocusNextColumn")(); r.shortcuts.get("CCScrollFocusNextColumn")();
    const window = r.workspace.activeWindow;
    assert.equal(window, r.a[1]); assert.equal(key(r, 3), true);
    assert.equal(window.desktops[0].id, "A", "membership awaits native disarm");
    for (const name of ["CCScrollMoveColumnWorkspace2", "CCScrollWorkspace2", "CCScrollWorkspaceNext", "CCScrollMoveColumnNextWorkspace"])
        assert.equal(r.shortcuts.get(name)(), false, "direct and relative requests share the switch barrier");
    r.workspace.createDesktop(0, "");
    r.cancelAcks.slice().forEach(callback => callback());
    assert.deepEqual(r.requests, ["C"], "in-flight target retains ID when its number changes");
    assert.equal(window.desktops[0].id, "C"); assert.equal(r.workspace.activeWindow, window);
    const writes = r.writes();
    r.nativeAcks.forEach(callback => callback(true)); r.motionAcks.forEach(callback => callback(true));
    r.cancelAcks.forEach(callback => callback());
    assert.equal(r.writes(), writes); check(r);
}
for (const cancel of ["close", "missing-target", "focus", "timeout", "stop"]) {
    const r = fixture({ HoldCancelAck: true });
    r.shortcuts.get("CCScrollFocusNextColumn")(); r.shortcuts.get("CCScrollFocusNextColumn")();
    const window = r.workspace.activeWindow;
    assert.equal(key(r, 3), true);
    if (cancel === "close") r.close(window);
    if (cancel === "missing-target") { r.desktops.splice(2, 1); r.workspace.desktopsChanged.emit(); }
    if (cancel === "focus") r.workspace.activeWindow = r.a[0];
    if (cancel === "timeout") r.evaluate("workspaceSwitchController.timer.timer").timeout.emit();
    if (cancel === "stop") r.evaluate("emergencyRestoreAllWindows('direct-move-stop')");
    r.cancelAcks.slice().forEach(callback => callback());
    assert.deepEqual(r.requests, [], `${cancel} cannot execute a stale direct move`);
    if (cancel !== "close") assert.equal(window.desktops[0].id, "A");
    assert.equal(r.evaluate("workspaceMoveController.pending"), null);
    if (cancel !== "stop") check(r);
}
{
    const r = fixture({ DynamicTrailingWorkspace: true, AutoRecycleWorkspaces: true });
    r.a.slice(1).forEach(window => r.close(window));
    key(r, 3);
    for (let i = 0; i < 6; ++i)
        r.timers.filter(timer => timer.running).forEach(timer => { timer.running = false; timer.timeout.emit(); });
    assert.equal(r.state.activeWorkspaceId, "C"); assert.equal(r.workspace.activeWindow, r.a[0]);
    assert.deepEqual(r.desktops.map(d => d.id), ["B", "C", "D1"]);
    assert.deepEqual(r.desktopCreates, [{ position: 3, name: "" }]); assert.deepEqual(r.desktopRemoves, ["A"]);
    assert.equal(key(r, 1), true); assert.equal(r.state.activeWorkspaceId, "B", "number updates after automatic recycling");
    check(r);
}
console.log("PASS P6 direct Column move: all nine bindings, current numbering, stable in-flight IDs, occupied/empty targets, actual focus, preferences, motion barriers and dynamic workspaces");
