"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
function owner(r, uuid) { return r.evaluate(`workspaceSnapshots.workspaceForWindow('${uuid}')`); }
function check(r) {
    assert.equal(r.evaluate("invariantChecker.errors().length"), 0, r.logs.join("\n"));
    assert.equal(r.state.enabled, true);
    assert.equal(r.logs.some(line => /INVARIANT_FAIL|FAIL_SAFE/.test(line)), false, r.logs.join("\n"));
    for (const published of r.published) {
        const active = published.workspaces.find(w => w.id === published.workspaceId);
        assert.deepEqual(published.columns, active.columns.map(c => ({ uuid: c.uuid, widthMode: c.widthMode })));
        const uuids = published.workspaces.flatMap(w => w.columns.map(c => c.uuid));
        assert.equal(new Set(uuids).size, uuids.length);
    }
}
{
    const r = createRuntime();
    r.evaluate("mainScreenState.columns[4].widthMode = 'third'; mainScreenState.columns[4].persistentWide = true; recomputeLogicalLayout(); publishDockState('save-preference')");
    assert.equal(r.a[4].opacity, 0); assert.equal(r.a[4].minimized, true);
    const focus = r.workspace.activeWindow;
    r.move(r.a[4], ["B"]);
    assert.deepEqual(r.ids(), ["a0", "a1", "a2", "a3"]);
    assert.equal(r.a[4].opacity, 1); assert.equal(r.a[4].minimized, false);
    assert.ok(r.a[4].frameGeometry.x >= 0);
    assert.equal(r.workspace.activeWindow, focus, "transfer does not activate a successor or destination");
    assert.equal(owner(r, "a4"), "B");
    assert.equal(r.evaluate("stateFor(workspace.windowList().find(w => w.internalId==='a4')).adoptionPhase"), "waiting-workspace");
    const entry = r.published.at(-1).workspaces.find(w => w.id === "B").columns.at(-1);
    assert.equal(entry.widthMode, "third"); assert.equal(entry.persistentWide, true);
    r.move(r.a[4], ["B"]);
    assert.equal(r.published.at(-1).workspaces.find(w => w.id === "B").columns.filter(c => c.uuid === "a4").length, 1);
    r.nativeSwitch(1, r.b[0]);
    assert.deepEqual(r.ids(), ["b0", "b1", "a4"]);
    assert.equal(r.state.columns[2].widthMode, "third"); assert.equal(r.state.columns[2].persistentWide, true);
    check(r);
}
{
    const r = createRuntime();
    const focus = r.workspace.activeWindow;
    r.evaluate("const savedB=workspaceSnapshots.get('B'); savedB.columns[0].widthMode='third'; savedB.columns[0].persistentWide=true; workspaceSnapshots.set('B',savedB)");
    r.move(r.b[0], ["A"]);
    assert.equal(r.workspace.activeWindow, focus);
    assert.ok(!r.ids().includes("b0"), "inactive incoming window waits for native activation");
    assert.equal(owner(r, "b0"), null, "old snapshot reference removed while active graph has no incoming column yet");
    r.workspace.activeWindow = r.b[0];
    assert.ok(r.ids().includes("b0")); assert.equal(owner(r, "b0"), "A");
    assert.equal(r.state.columns.find(c => c.window === r.b[0]).widthMode, "third");
    assert.equal(r.state.columns.find(c => c.window === r.b[0]).persistentWide, true);
    r.move(r.b[1], ["C"]);
    assert.equal(owner(r, "b1"), "C");
    r.nativeSwitch(2, r.b[1]); assert.deepEqual(r.ids(), ["b1"]);
    r.close(r.b[1]); assert.equal(owner(r, "b1"), null); assert.deepEqual(r.ids(), []);
    check(r);
}
{
    const r = createRuntime();
    r.evaluate("mainScreenState.columns[4].widthMode='third'; mainScreenState.columns[4].persistentWide=true");
    r.nativeSwitch(1, r.b[0]);
    assert.equal(r.a[4].opacity, 0);
    r.move(r.a[4], ["B"]);
    assert.equal(r.a[4].opacity, 1); assert.equal(r.a[4].minimized, false);
    assert.ok(r.a[4].frameGeometry.x >= 0); assert.equal(r.workspace.activeWindow, r.b[0]);
    assert.ok(!r.ids().includes("a4"));
    r.workspace.activeWindow = r.a[4];
    assert.equal(r.state.columns.find(c => c.window === r.a[4]).widthMode, "third");
    assert.equal(r.state.columns.find(c => c.window === r.a[4]).persistentWide, true);
    assert.equal(r.a[3].opacity, 0);
    r.move(r.a[3], ["C"]);
    assert.equal(owner(r, "a3"), "C"); assert.equal(r.a[3].opacity, 1);
    assert.equal(r.a[3].minimized, false); assert.ok(r.a[3].frameGeometry.x >= 0);
    check(r);
}
{
    const r = createRuntime();
    r.evaluate("toggleFocusWide(workspace.activeWindow)");
    const callbacks = r.motionAcks.slice();
    r.move(r.a[0], ["B"]);
    assert.equal(r.state.presentation.mode, "normal"); assert.equal(r.state.viewport.mode, "pair");
    assert.equal(owner(r, "a0"), "B");
    const writes = r.writes(); callbacks.forEach(callback => callback(true));
    assert.equal(r.writes(), writes, "old Wide ACK cannot move a transferred window");
    r.move(r.a[4], []);
    assert.equal(r.a[4].opacity, 1); assert.equal(r.a[4].minimized, false);
    assert.ok(r.a[4].frameGeometry.x >= 0); assert.equal(owner(r, "a4"), null);
    assert.ok(!r.ids().includes("a4"));
    r.move(r.a[3], ["A", "B"]); assert.equal(owner(r, "a3"), null); assert.ok(!r.ids().includes("a3"));
    r.move(r.a[3], ["C"]); assert.equal(owner(r, "a3"), "C");
    check(r);
}
{
    const r = createRuntime();
    r.evaluate("floatingController.detach(workspace.activeWindow, 'test-floating')");
    const geometry = Object.assign({}, r.a[0].frameGeometry);
    r.move(r.a[0], ["B"]);
    assert.equal(owner(r, "a0"), null); assert.deepEqual(Object.assign({}, r.a[0].frameGeometry), geometry);
    assert.equal(r.evaluate("stateFor(workspace.windowList()[0]).floating"), true);
    const dialog = r.add("dialog", 1); dialog.normalWindow = false; dialog.dialog = true;
    dialog.transientChanged.emit(); r.move(dialog, ["A"]);
    assert.equal(owner(r, "dialog"), null); assert.ok(!r.ids().includes("dialog"));
    const newWindow = r.add("new-inactive", 2);
    assert.equal(owner(r, "new-inactive"), "C"); assert.ok(!r.ids().includes("new-inactive"));
    r.close(newWindow); assert.equal(owner(r, "new-inactive"), null);
    assert.equal(r.published.at(-1).workspaces.some(w => w.columns.some(c => c.uuid === "new-inactive")), false,
        "closing a sleeping window immediately publishes its removed snapshot reference");
    const nativeFullscreen = r.add("new-fullscreen", 2, { fullScreen: true });
    assert.equal(owner(r, "new-fullscreen"), null, "native fullscreen is not newly adopted through an inactive snapshot");
    r.nativeSwitch(2, nativeFullscreen); assert.ok(!r.ids().includes("new-fullscreen"));
    check(r);
}
{
    const r = createRuntime();
    r.workspace.setCurrentDesktopForScreen = () => {};
    r.shortcuts.get("CCScrollWorkspaceNext")();
    const generation = r.published.at(-1).generation;
    r.move(r.a[4], ["B"]);
    assert.equal(r.published.at(-1).generation, generation, "no intermediate Dock commit through switch barrier");
    assert.equal(owner(r, "a4"), "B"); assert.equal(r.a[4].opacity, 1);
    r.nativeSwitch(1, r.b[0]); assert.deepEqual(r.ids(), ["b0", "b1", "a4"]);
    r.nativeSwitch(0, r.a[0]); assert.deepEqual(r.ids(), ["a0", "a1", "a2", "a3"]);
    check(r);
    r.evaluate("emergencyRestoreAllWindows('transfer-stop')");
    const writes = r.writes(); r.move(r.a[4], ["C"]);
    assert.equal(r.writes(), writes); assert.equal(r.evaluate("workspaceTransferController.stopped"), true);
}
{
    const r = createRuntime();
    const transfer = r.evaluate("workspaceTransferController");
    const release = transfer.releaseWindow;
    let changed = false;
    transfer.releaseWindow = (window, reason) => {
        release(window, reason);
        if (!changed) { changed = true; r.move(window, ["C"]); }
    };
    r.evaluate("mainScreenState.columns[4].widthMode='twoThirds'; mainScreenState.columns[4].persistentWide=true");
    r.move(r.a[4], ["B"]);
    assert.equal(owner(r, "a4"), "C", "synchronous reentry follows final native membership");
    const entry = r.published.at(-1).workspaces.find(w => w.id === "C").columns[0];
    assert.equal(entry.widthMode, "twoThirds"); assert.equal(entry.persistentWide, true);
    check(r);
}
{
    const r = createRuntime();
    const transfer = r.evaluate("workspaceTransferController");
    const release = transfer.releaseWindow;
    let nested = false;
    transfer.releaseWindow = (window, reason) => {
        release(window, reason);
        if (!nested) { nested = true; r.move(r.a[3], ["C"]); }
    };
    r.move(r.a[4], ["B"]);
    assert.equal(owner(r, "a4"), "B"); assert.equal(owner(r, "a3"), "C");
    check(r);
}
{
    const r = createRuntime();
    const transfer = r.evaluate("workspaceTransferController");
    const release = transfer.releaseWindow;
    transfer.releaseWindow = (window, reason) => { release(window, reason); r.close(window); };
    r.move(r.a[4], ["B"]);
    assert.equal(owner(r, "a4"), null, "close during parking release cannot append a ghost to the target");
    assert.ok(!r.ids().includes("a4"));
    assert.equal(r.published.at(-1).workspaces.some(w => w.columns.some(c => c.uuid === "a4")), false);
    check(r);
}
{
    const r = createRuntime();
    r.evaluate("workspaceTransferController.append = () => { throw new Error('test-save-failure'); }");
    r.move(r.a[4], ["B"]);
    assert.equal(r.state.enabled, false);
    assert.equal(r.evaluate("workspaceTransferController.stopped"), true);
    for (const window of r.workspace.windowList()) {
        assert.equal(window.opacity, 1); assert.equal(window.minimized, false);
    }
}
console.log("PASS production transfer: parked/visible/Wide, inactive/active, native policies, new/closed windows, switch barriers and reentry recovery");
