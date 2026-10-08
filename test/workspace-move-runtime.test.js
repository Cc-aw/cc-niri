"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const key = (r, direction) => r.shortcuts.get("CCScrollMoveColumn" + direction + "Workspace")();
const snapshot = (r, id) => r.published.at(-1).workspaces.find(w => w.id === id);
const column = (r, window) => r.state.columns.find(c => c.window === window);
function fixture(config = {}) {
    const r = createRuntime(config);
    const requests = [];
    r.workspace.setCurrentDesktopForScreen = (desktop, output) => {
        assert.equal(output, r.output, "only the managed primary screen switches");
        requests.push(desktop.id);
        const active = r.workspace.windowList().find(w => w.desktops[0] === desktop);
        r.nativeSwitch(r.desktops.indexOf(desktop), active);
    };
    return { ...r, requests };
}
function check(r) {
    assert.equal(r.state.enabled, true, r.logs.join("\n"));
    assert.deepEqual(Array.from(r.evaluate("invariantChecker.errors()")), [], r.logs.join("\n"));
    assert.equal(r.logs.some(line => /INVARIANT.*errors=|FAIL_SAFE|move failed/.test(line)), false, r.logs.join("\n"));
    assert.equal(r.evaluate("workspaceMoveController.pending"), null);
    assert.equal(r.evaluate("workspaceSwitchController.phase"), "IDLE");
    for (const state of r.published) {
        const active = state.workspaces.find(w => w.id === state.workspaceId);
        assert.deepEqual(state.columns, active.columns.map(c => ({ uuid: c.uuid, widthMode: c.widthMode })));
        const uuids = state.workspaces.flatMap(w => w.columns.map(c => c.uuid));
        assert.equal(new Set(uuids).size, uuids.length, "each publication has one workspace owner per UUID");
    }
}
for (const index of [0, 1, 4]) for (const full of [false, true]) {
    const r = fixture(); const window = r.a[index];
    r.workspace.activeWindow = window;
    if (full) r.shortcuts.get("CCScrollToggleColumnFull")();
    column(r, window).persistentWide = true;
    r.evaluate("commitDockState('fixture-width')");
    const preference = snapshot(r, "A").columns.find(c => c.uuid === window.internalId);
    const expectedSuccessor = r.a[index === 4 ? 3 : index + 1].internalId;
    const generation = r.published.at(-1).generation;
    assert.equal(key(r, "Next"), true);
    assert.deepEqual(r.requests, ["B"]);
    assert.equal(r.state.activeWorkspaceId, "B");
    assert.equal(r.workspace.activeWindow, window, "override KWin's initially selected destination window after layout");
    assert.deepEqual(r.ids(), ["b0", "b1", window.internalId], "append the moved Column without changing destination order");
    assert.deepEqual(snapshot(r, "B").columns.at(-1), preference);
    assert.equal(snapshot(r, "A").focusedUuid, expectedSuccessor, "source prefers right neighbor, otherwise left");
    assert.equal(r.published.at(-1).generation, generation + 1, "publish one complete move-and-follow generation");
    assert.equal(window.frameGeometry.width, full ? 2512 : 1252);
    assert.equal(window.minimized, false); assert.equal(window.opacity, 1);
    assert.equal(r.state.viewport.mode, "pair", "transfer Wide preference, not an old Wide presentation");
    assert.equal(key(r, "Previous"), true);
    assert.equal(r.workspace.activeWindow, window);
    assert.equal(column(r, window).persistentWide, true);
    assert.equal(column(r, window).widthMode, full ? "full" : "half");
    check(r);
}
{
    const r = fixture();
    assert.equal(key(r, "Previous"), false, "first boundary does not wrap or create");
    assert.equal(r.evaluate("workspaceMoveController.moveTo('missing')"), false);
    assert.equal(r.evaluate("workspaceMoveController.moveTo('A')"), false);
    key(r, "Next"); key(r, "Next");
    assert.equal(r.state.activeWorkspaceId, "C"); assert.deepEqual(r.ids(), ["a0"]);
    const writes = r.writes(), count = r.published.length;
    assert.equal(key(r, "Next"), false, "last boundary does not wrap or create");
    assert.equal(r.writes(), writes); assert.equal(r.published.length, count);
    assert.equal(r.desktopCreates.length, 0);
    check(r);
}
for (const condition of ["floating", "dialog", "transient", "unmanaged", "secondary", "sticky", "multiple", "none", "disabled", "switching", "processing"]) {
    const r = fixture(); const window = r.workspace.activeWindow;
    if (condition === "floating") r.shortcuts.get("CCScrollToggleFloating")();
    if (condition === "dialog") window.dialog = true;
    if (condition === "transient") window.transient = true;
    if (condition === "unmanaged") window.managed = false;
    if (condition === "secondary") window.output = { name: "secondary" };
    if (condition === "sticky") { window.onAllDesktops = true; window.desktops = []; }
    if (condition === "multiple") window.desktops = [r.desktops[0], r.desktops[1]];
    if (condition === "none") r.workspace.activeWindow = null;
    if (condition === "disabled") r.state.enabled = false;
    if (condition === "switching") r.state.workspaceSwitching = true;
    if (condition === "processing") r.evaluate("workspaceTransferController.processing.add('busy')");
    const membership = window.desktops, count = r.published.length, writes = r.writes();
    assert.equal(key(r, "Next"), false, condition);
    assert.equal(key(r, "Previous"), false, condition);
    assert.deepEqual(window.desktops, membership, "do not find a remembered Column");
    assert.equal(r.published.length, count); assert.equal(r.writes(), writes); assert.equal(r.requests.length, 0);
}
for (const wideAck of [false, true]) {
    const r = fixture(); r.shortcuts.get("CCScrollToggleFocusWide")();
    const old = r.motionAcks.at(-1); if (wideAck) old(true);
    key(r, "Next");
    assert.equal(column(r, r.a[0]).persistentWide, true);
    assert.equal(r.state.presentation.mode, "normal"); assert.equal(r.state.viewport.mode, "pair");
    assert.equal(r.a[0].frameGeometry.width, 1252);
    const writes = r.writes(); old(true);
    assert.equal(r.writes(), writes, "old Wide ACK cannot resize transferred owner");
    check(r);
}
{
    const r = fixture();
    r.evaluate("workspaceMoveController").changeMembership = (window, desktop) => r.move(window, [desktop.id]);
    key(r, "Next");
    assert.deepEqual(r.ids(), ["b0", "b1", "a0"], "synchronous membership notification reconciles only once");
    r.a[0].desktopsChanged.emit(); // A delayed duplicate must also be harmless.
    assert.equal(r.state.columns.filter(c => c.window === r.a[0]).length, 1);
    assert.equal(r.workspace.activeWindow, r.a[0]);
    check(r);
}
{
    const r = fixture(); const window = r.a[0];
    r.shortcuts.get("CCScrollToggleColumnFull")(); r.motionAcks.at(-1)(true);
    window.fullScreen = true; window.fullScreenChanged.emit();
    key(r, "Next");
    assert.equal(r.workspace.activeWindow, window);
    assert.equal(window.fullScreen, true, "moving an existing fullscreen Column does not change native fullscreen");
    assert.equal(column(r, window).widthMode, "full");
    window.fullScreen = false; window.fullScreenChanged.emit();
    assert.equal(window.frameGeometry.width, 2512, "fullscreen exit restores transferred Full preference");
    check(r);
}
{
    const r = fixture();
    r.evaluate("workspaceMoveController").changeMembership = () => { throw new Error("membership setter unavailable"); };
    key(r, "Next");
    assert.equal(r.state.enabled, false, "unexpected membership failure uses existing global recovery");
    assert.equal(r.evaluate("workspaceMoveController.pending"), null);
    assert.equal(r.evaluate("workspaceSwitchController.phase"), "IDLE");
    assert.equal(r.requests.length, 0);
    assert.equal(r.logs.some(line => /move failed.*membership setter unavailable/.test(line)), true);
    assert.equal(r.workspace.windowList().every(window => !window.minimized && window.opacity === 1), true);
}
{
    const r = fixture(); r.shortcuts.get("CCScrollCycleColumnWidth")();
    key(r, "Next");
    assert.equal(column(r, r.a[0]).widthMode, "full");
    assert.equal(r.a[1].minimized, false, "moving an expanding Full retires its old neighbor parking command");
    check(r);
}
for (const hold of ["HoldScrollAck", "HoldNativeAck"]) {
    const r = fixture({ [hold]: true, HoldCancelAck: true });
    r.shortcuts.get("CCScrollFocusNextColumn")(); r.shortcuts.get("CCScrollFocusNextColumn")();
    assert.equal(r.workspace.activeWindow, r.a[1]);
    const count = r.published.length;
    assert.equal(key(r, "Next"), true);
    assert.equal(r.evaluate("workspaceSwitchController.phase"), "PREPARING");
    assert.equal(r.a[1].desktops[0].id, "A", "membership waits for native scroll disarm ACK");
    assert.equal(r.requests.length, 0); assert.equal(r.published.length, count);
    assert.equal(key(r, "Next"), false); assert.equal(key(r, "Previous"), false);
    r.cancelAcks.slice().forEach(callback => callback());
    assert.equal(r.a[1].desktops[0].id, "B");
    assert.equal(r.workspace.activeWindow, r.a[1], "move actual active owner, not pending H/L target");
    const writes = r.writes();
    r.motionAcks.forEach(callback => callback(true)); r.nativeAcks.forEach(callback => callback(true));
    r.cancelAcks.forEach(callback => callback());
    assert.equal(r.writes(), writes, "stale motion ACKs cannot overwrite final geometry");
    check(r);
}
for (const cancel of ["close", "missing-target", "focus", "native-switch", "timeout", "stop"]) {
    const r = fixture({ HoldCancelAck: true });
    r.shortcuts.get("CCScrollFocusNextColumn")(); r.shortcuts.get("CCScrollFocusNextColumn")();
    const window = r.workspace.activeWindow;
    key(r, "Next");
    const requests = r.requests.length;
    if (cancel === "close") {
        r.close(window);
        Object.defineProperty(window, "internalId", { get() { throw new Error("closed QObject read"); } });
    }
    if (cancel === "missing-target") { r.desktops.splice(1, 1); r.workspace.desktopsChanged.emit(); }
    if (cancel === "focus") r.workspace.activeWindow = r.a[0];
    if (cancel === "native-switch") r.nativeSwitch(2, r.b[0], false);
    if (cancel === "timeout") r.evaluate("workspaceSwitchController.timer.timer").timeout.emit();
    if (cancel === "stop") r.evaluate("emergencyRestoreAllWindows('move-stop')");
    const after = r.writes();
    r.cancelAcks.slice().forEach(callback => callback());
    assert.equal(r.requests.length, requests, `${cancel} cannot perform a stale move`);
    if (!["close", "missing-target", "focus", "native-switch"].includes(cancel)) assert.equal(r.writes(), after);
    assert.equal(r.evaluate("workspaceMoveController.pending"), null);
    if (cancel !== "stop") check(r);
}
for (const request of ["async", "no-signal", "rejected"]) {
    const r = fixture();
    r.workspace.setCurrentDesktopForScreen = () => { if (request === "rejected") throw new Error("request rejected"); };
    key(r, "Next");
    assert.equal(r.a[0].desktops[0].id, "B");
    if (request === "async") {
        assert.equal(r.state.workspaceSwitching, true);
        assert.equal(key(r, "Next"), false);
        r.nativeSwitch(1, r.b[0]); assert.equal(r.workspace.activeWindow, r.a[0]);
    } else if (request === "no-signal") {
        r.evaluate("workspaceSwitchController.timer.timer").timeout.emit();
        assert.equal(r.state.activeWorkspaceId, "A", "timeout hydrates KDE authority, never fabricates a successful follow");
        assert.equal(snapshot(r, "B").columns.at(-1).uuid, "a0");
        assert.equal(snapshot(r, "A").focusedUuid, "a1");
    }
    check(r);
}
{
    const r = fixture(); const transfer = r.evaluate("workspaceTransferController");
    const release = transfer.releaseWindow;
    transfer.releaseWindow = (window, reason) => { release(window, reason); r.close(window); };
    key(r, "Next"); assert.equal(r.requests.length, 0);
    assert.equal(r.published.at(-1).workspaces.some(w => w.columns.some(c => c.uuid === "a0")), false);
    check(r);
}
{
    const r = fixture({ DynamicTrailingWorkspace: true, AutoRecycleWorkspaces: true });
    const flush = () => r.timers.filter(timer => timer.running).forEach(timer => { timer.running = false; timer.timeout.emit(); });
    r.a.slice(1).forEach(window => r.close(window));
    key(r, "Next"); key(r, "Next");
    for (let i = 0; i < 6; ++i) flush();
    assert.equal(r.state.activeWorkspaceId, "C");
    assert.equal(r.workspace.activeWindow, r.a[0]);
    assert.deepEqual(r.desktopCreates, [{ position: 3, name: "" }]);
    assert.deepEqual(r.desktops.map(desktop => desktop.id), ["B", "C", "D1"]);
    assert.deepEqual(r.desktopRemoves, ["A"], "recycle only the now empty unprotected source");
    assert.equal(r.published.at(-1).workspaces.some(w => w.id === "A"), false);
    assert.equal(snapshot(r, "C").columns[0].uuid, "a0");
    check(r);
}
console.log("PASS P4 managed Column move-and-follow: width/preferences, primary output, source focus, ACK barriers, lifecycle, native failures, dynamic creation and recycling");
