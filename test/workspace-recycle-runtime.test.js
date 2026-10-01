"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
function setup(config) {
    const r = createRuntime(config);
    return { ...r, drain() {
        for (let pass = 0; pass < 30; ++pass) {
            const active = r.timers.filter(timer => timer.running);
            if (!active.length) return;
            active.forEach(timer => { timer.running = false; timer.timeout.emit(); });
        }
        throw new Error("timer loop");
    } };
}
function invariant(r) {
    assert.equal(r.evaluate("invariantChecker.errors().length"), 0, r.logs.join("\n"));
    assert.equal(r.state.enabled, true);
    assert.equal(r.logs.some(line => /INVARIANT_FAIL|FAIL_SAFE/.test(line)), false);
    const s = r.published.at(-1);
    assert.deepEqual(s.columns, s.workspaces.find(w => w.id === s.workspaceId).columns.map(c => ({ uuid: c.uuid, widthMode: c.widthMode })));
    assert.equal(s.workspaces.every(w => r.desktops.some(d => d.id === w.id)), true, "Bridge persistence excludes deleted desktops");
}
{
    const r = setup({ AutoRecycleWorkspaces: true }); r.move(r.b[0], ["A"]); r.move(r.b[1], ["A"]); r.drain();
    assert.deepEqual(r.desktopRemoves, [], "recycling requires W8 too");
}
{
    const r = setup({ DynamicTrailingWorkspace: true }); r.move(r.b[0], ["A"]); r.move(r.b[1], ["A"]); r.drain();
    assert.deepEqual(r.desktopRemoves, [], "default W8 remains create-only");
}
{
    const r = setup({ DynamicTrailingWorkspace: true, AutoRecycleWorkspaces: true }); r.drain();
    const focus = r.workspace.activeWindow, columns = r.ids();
    r.move(r.b[0], ["A"]); r.move(r.b[1], ["A"]); r.drain();
    assert.deepEqual(r.desktopRemoves, ["B"]); assert.deepEqual(r.desktops.map(d => d.id), ["A", "C"]);
    assert.equal(r.workspace.activeWindow, focus); assert.deepEqual(r.ids(), columns);
    assert.equal(r.desktopRows.at(-1), 2); invariant(r);
    const tail = r.add("tail-window", 1); r.drain();
    assert.deepEqual(r.desktops.map(d => d.id), ["A", "C", "D1"]);
    assert.equal(r.desktopRows.at(-1), 3);
    r.close(tail); r.drain();
    assert.deepEqual(r.desktops.map(d => d.id), ["A", "D1"], "closed inactive tail occupant leaves exactly one trailing empty desktop");
    assert.equal(r.desktopCreates.length, 1, "no create/delete oscillation"); invariant(r);
}
{
    const r = setup({ DynamicTrailingWorkspace: true, AutoRecycleWorkspaces: true }); r.drain();
    const tail = r.add("tail-active", 2); r.drain();
    r.nativeSwitch(2, tail); r.close(tail); r.drain();
    assert.equal(r.workspace.currentDesktop.id, "C");
    assert.ok(r.desktops.some(d => d.id === "C"), "closed current workspace does not jump away");
    r.nativeSwitch(0, r.a[0]); r.drain();
    assert.equal(r.desktops.some(d => d.id === "C"), false, "leaving the empty current desktop permits reclamation"); invariant(r);
}
{
    const r = setup({ DynamicTrailingWorkspace: true, AutoRecycleWorkspaces: true }); r.drain();
    r.workspace.removeDesktop = () => { throw new Error("should not be called after emergency"); };
    r.move(r.b[0], ["A"]); r.move(r.b[1], ["A"]);
    r.evaluate("emergencyRestoreAllWindows('recycle-stop')"); r.drain();
    assert.equal(r.evaluate("workspaceRecycleController.stopped"), true); assert.deepEqual(r.desktopRemoves, []);
}
console.log("PASS production recycling: W8 coordination, membership/close/current signals, UUID snapshots, grid and emergency stop");
