"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const shortcut = (r, name) => r.shortcuts.get("CCScroll" + name)();
function check(r) {
    assert.equal(r.state.enabled, true, r.logs.join("\n"));
    assert.equal(r.evaluate("dockScrollController"), null, "Dock planner is not constructed");
    assert.equal(r.evaluate("controllerComposition.names().includes('dockScroll')"), false);
    assert.deepEqual(Array.from(r.evaluate("invariantChecker.errors()")), []);
    assert.equal(r.logs.some(line => /FAIL_SAFE|INVARIANT.*errors=/.test(line)), false);
    assert.equal(r.deferred.some(c => c.type === "advance-dock-scroll"), false);
    for (const value of r.published) {
        const owners = value.workspaces.flatMap(w => w.columns.map(c => c.uuid));
        assert.equal(new Set(owners).size, owners.length);
    }
}
function fixture(config = {}) {
    const r = createRuntime(config);
    r.workspace.setCurrentDesktopForScreen = (desktop, output) => {
        assert.equal(output, r.output);
        r.nativeSwitch(r.desktops.indexOf(desktop), r.workspace.windowList().find(w => w.desktops[0] === desktop));
    };
    return r;
}
for (const config of [{}, { EnableDockIntegration: false }]) {
    const r = fixture(config);
    shortcut(r, "FocusNextColumn"); assert.equal(r.workspace.activeWindow, r.a[1]);
    shortcut(r, "FocusNextColumn"); assert.equal(r.workspace.activeWindow, r.a[2]);
    shortcut(r, "FocusPreviousColumn"); assert.equal(r.workspace.activeWindow, r.a[1]);
    shortcut(r, "FocusPreviousColumn"); assert.equal(r.workspace.activeWindow, r.a[0]);
    shortcut(r, "MoveColumnRight"); assert.deepEqual(r.ids(), ["a1", "a0", "a2", "a3", "a4"]);
    shortcut(r, "MoveColumnLeft"); assert.deepEqual(r.ids(), ["a0", "a1", "a2", "a3", "a4"]);
    shortcut(r, "CycleColumnWidth"); assert.equal(r.state.columns[0].widthMode, "full");
    shortcut(r, "ToggleColumnFull"); assert.equal(r.state.columns[0].widthMode, "half");
    shortcut(r, "ToggleFocusWide"); assert.equal(r.state.viewport.mode, "wide-focus");
    r.motionAcks.at(-1)(true);
    assert.equal(r.state.columns[0].persistentWide, true);
    shortcut(r, "WorkspaceNext"); assert.equal(r.state.activeWorkspaceId, "B");
    shortcut(r, "WorkspacePrevious"); assert.equal(r.state.activeWorkspaceId, "A");
    r.workspace.activeWindow = r.a[0];
    shortcut(r, "ToggleFocusWide"); assert.equal(r.state.viewport.mode, "pair");
    shortcut(r, "ToggleFloating"); assert.equal(r.evaluate("stateFor(workspace.activeWindow).floating"), true);
    shortcut(r, "ToggleFloating"); assert.equal(r.evaluate("stateFor(workspace.activeWindow).floating"), false);
    shortcut(r, "MoveColumnNextWorkspace");
    assert.equal(r.state.activeWorkspaceId, "B"); assert.equal(r.workspace.activeWindow, r.a[0]);
    shortcut(r, "MoveColumnWorkspace1");
    assert.equal(r.state.activeWorkspaceId, "A"); assert.equal(r.workspace.activeWindow, r.a[0]);
    shortcut(r, "Workspace3"); assert.equal(r.state.activeWorkspaceId, "C");
    shortcut(r, "Workspace1"); assert.equal(r.state.activeWorkspaceId, "A");
    r.workspace.activeWindow = r.a[2]; shortcut(r, "ToggleColumnFull");
    const saved = r.published.at(-1);
    const reloaded = fixture({ ...config, PreviousState: saved });
    assert.deepEqual(reloaded.ids(), r.ids());
    const before = saved.workspaces.find(w => w.id === "A").columns;
    const after = reloaded.published.at(-1).workspaces.find(w => w.id === "A").columns;
    assert.deepEqual(after, before, "Bridge persistence restores order, widths and preferences without a Dock");
    assert.ok(r.traffic.some(c => c.path === "/ccNiriFocusRing" && c.method === "PublishEligibility"));
    assert.ok(r.traffic.some(c => c.method === "GetState"));
    assert.ok(r.traffic.some(c => c.method === "PublishState"));
    assert.ok(r.traffic.some(c => c.method === "PublishMotionPlan"));
    assert.ok(r.nativeArms.length > 0);
    check(r); check(reloaded);
    const gateway = reloaded.evaluate("dockGateway");
    reloaded.queueCommand(gateway.commandEnvelope({ type: "emergency-restore", commandId: "dockless-stop" }));
    shortcut(reloaded, "ApplyDockCommand"); // Retained generic transport entry, including CLI stop.
    assert.equal(reloaded.state.enabled, false);
    assert.equal(reloaded.workspace.windowList().every(w => !w.minimized && w.opacity === 1), true);
    assert.equal(reloaded.evaluate("workspaceMoveController.pending"), null);
}
{
    const r = fixture(), gateway = r.evaluate("dockGateway");
    for (const command of [
        { type: "focus-column-right", windowUuid: "a4" },
        { type: "set-column-order", order: ["a4", "a3", "a2", "a1", "a0"] },
        { type: "set-presentation-mode", windowUuid: "a0", mode: "wide" },
        { type: "advance-dock-scroll", windowUuid: "a0", transitionToken: "1" },
    ]) {
        const writes = r.writes(), value = JSON.stringify(r.published.at(-1));
        assert.equal(gateway.dispatch(gateway.commandEnvelope({ ...command, commandId: command.type })), false);
        assert.equal(r.writes(), writes); assert.equal(JSON.stringify(r.published.at(-1)), value,
            "disabled Dock commands can only resend the canonical snapshot");
    }
    assert.equal(r.evaluate("beginDockScroll(mainScreenState.columns[4], 'disabled')"), false);
    check(r);
}
{
    const r = fixture(); shortcut(r, "ToggleFocusWide"); r.motionAcks.at(-1)(true);
    const pending = r.evaluate("contextualWideCoordinator.pendingPark");
    const gateway = r.evaluate("dockGateway"), neighbor = pending.neighbor.window;
    r.queueCommand(gateway.commandEnvelope({ type: "finalize-contextual-wide",
        commandId: pending.commandId, transitionToken: pending.token, motionCompleted: true }));
    shortcut(r, "PublishDockState"); // Same generic state-resend entry for Bridge reconnect.
    shortcut(r, "ApplyDockCommand");
    assert.equal(r.evaluate("contextualWideCoordinator.pendingPark"), null);
    assert.equal(neighbor.minimized, true, "core Wide completion still parks the neighbor without Dock integration");
    assert.ok(r.traffic.some(c => c.method === "ReportMotionParked"));
    check(r);
}
{
    const r = fixture({ EnableDockIntegration: true }), gateway = r.evaluate("dockGateway");
    assert.ok(r.evaluate("dockScrollController"));
    assert.equal(r.evaluate("controllerComposition.names().includes('dockScroll')"), true);
    assert.equal(gateway.dispatch(gateway.commandEnvelope({ type: "set-column-order", commandId: "opt-in-order",
        order: ["a1", "a0", "a2", "a3", "a4"] })), true);
    assert.deepEqual(r.ids(), ["a1", "a0", "a2", "a3", "a4"]);
    assert.equal(gateway.dispatch(gateway.commandEnvelope({ type: "focus-column-right", commandId: "opt-in-focus", windowUuid: "a4" })), true);
    assert.equal(r.evaluate("dockScrollController.hasPending()"), true);
    for (let i = 0; r.evaluate("dockScrollController.hasPending()"); ++i) {
        assert.ok(i < 10); r.queueCommand(r.deferred.at(-1)); shortcut(r, "ApplyDockCommand");
    }
    assert.equal(r.workspace.activeWindow, r.a[4]);
    assert.equal(gateway.dispatch(gateway.commandEnvelope({ type: "set-presentation-mode", commandId: "opt-in-wide", windowUuid: "a4", mode: "wide" })), true);
    assert.equal(r.state.viewport.mode, "wide-focus");
    assert.deepEqual(Array.from(r.evaluate("invariantChecker.errors()")), []);
}
console.log("PASS P7 Dockless core: default absent planner, disabled UI commands, keyboard workflow, persistence, generic Wide completion/recovery/Ring transport and explicit Dock compatibility");
