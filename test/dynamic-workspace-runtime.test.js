"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
function setup(config) {
    const r = createRuntime(config);
    function flush() {
        const active = r.timers.filter(timer => timer.running);
        active.forEach(timer => { timer.running = false; timer.timeout.emit(); });
    }
    return { ...r, calls: r.desktopCreates, flush };
}
{
    const r = setup(); r.add("last-desktop", 2); r.flush();
    assert.equal(r.calls.length, 0, "default runtime never creates desktops");
    assert.equal(r.desktopRows.length, 0, "disabled feature does not change KDE's grid");
}
{
    const r = setup({ DynamicTrailingWorkspace: true }); r.flush();
    assert.equal(r.calls.length, 0, "existing trailing desktop is empty at startup");
    const focus = r.workspace.activeWindow;
    const columns = r.ids();
    const window = r.add("last-desktop", 2); r.flush(); r.flush();
    assert.deepEqual(r.calls, [{ position: 3, name: "" }]);
    assert.equal(r.desktopRows.at(-1), 4, "production create path requests one column immediately");
    assert.equal(r.workspace.currentDesktop.id, "A");
    assert.equal(r.workspace.activeWindow, focus); assert.deepEqual(r.ids(), columns);
    assert.equal(r.evaluate("workspaceSnapshots.workspaceForWindow('last-desktop')"), "C");
    r.move(window, ["D1"]); r.flush(); r.flush();
    assert.equal(r.calls.length, 2, "native membership transfer occupies the new tail");
    r.close(window); r.flush(); assert.equal(r.desktops.length, 5, "close never deletes KDE desktops");
    const next = r.add("new-tail", 4); r.flush();
    assert.equal(r.calls.length, 3);
    r.evaluate("emergencyRestoreAllWindows('dynamic-stop')");
    r.move(next, ["D3"]); r.flush();
    assert.equal(r.calls.length, 3, "emergency stop cancels confirmation and late create requests");
    assert.equal(r.evaluate("dynamicWorkspaceController.stopped"), true);
}
{
    const r = setup({ DynamicTrailingWorkspace: true }); r.flush();
    const window = r.add("other-output", 2, { output: { name: "other" } }); r.flush();
    assert.equal(r.calls.length, 0);
    window.output = r.output; window.outputChanged.emit(); r.flush(); r.flush();
    assert.equal(r.calls.length, 1, "outputChanged triggers occupancy without user activation");
    assert.equal(r.evaluate("invariantChecker.errors().length"), 0);
    assert.equal(r.logs.some(line => /FAIL_SAFE|INVARIANT_FAIL/.test(line)), false);
}
console.log("PASS production dynamic workspace opt-in, native signals, no focus/column changes and emergency cancellation");
