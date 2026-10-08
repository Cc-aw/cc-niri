"use strict";
const assert = require("node:assert/strict");
const { WorkspaceSwitchController } = require("../src/kwin/workspace/WorkspaceSwitchController");
const { VirtualDesktopTopology } = require("../src/kwin/workspace/VirtualDesktopTopology");
function fixture() {
    const desktops = [{ id: "A" }, { id: "B" }, { id: "C" }];
    const output = {}; let current = desktops[0];
    const state = { enabled: true, targetOutput: output, activeWorkspaceId: "A", workspaceSwitching: false };
    const events = []; const timers = []; const requests = [];
    const mount = { stopped: false, refreshState() {},
        cancelPending() { events.push("cancel"); }, capture() { events.push(`capture:${state.activeWorkspaceId}`); },
        mountPrepared(desktop) { assert.equal(state.workspaceSwitching, true); events.push(`mount:${desktop.id}`); state.activeWorkspaceId = desktop.id; return true; },
        commitState() { events.push("dock"); }, pruneSnapshots() { events.push("prune"); } };
    const topology = new VirtualDesktopTopology({ getDesktops: () => desktops, getCurrentDesktop: () => current });
    const controller = new WorkspaceSwitchController({ appState: state, mount, topology,
        requestDesktop(desktop, screen) { assert.equal(screen, output); requests.push(desktop); },
        setTimer(callback, delay) { assert.equal(delay, 400); const timer = { callback }; timers.push(timer); return timer; },
        clearTimer(timer) { timer.cleared = true; }, debug() {}, onFailure(error) { throw error; } });
    return { controller, mount, state, events, timers, requests, desktops, output,
        setCurrent(index) { current = desktops[index]; },
        signal(index, screen = output) { const previous = current; current = desktops[index]; return controller.onDesktopChanged(previous, current, screen); } };
}
{
    const f = fixture(); assert.equal(f.controller.previous(), false);
    assert.equal(f.controller.next(), true);
    assert.deepEqual(f.events, ["cancel", "capture:A"]);
    assert.equal(f.controller.phase, "AWAITING_KWIN"); assert.equal(f.state.workspaceSwitching, true);
    assert.equal(f.controller.next(), false); assert.equal(f.controller.previous(), false);
    assert.equal(f.requests.length, 1);
    f.signal(1); assert.deepEqual(f.events.slice(2), ["mount:B", "dock"]);
    assert.equal(f.controller.phase, "IDLE"); assert.equal(f.state.workspaceSwitching, false);
    assert.equal(f.timers[0].cleared, true);
    f.controller.next(); const epoch = f.controller.switchEpoch;
    f.timers[0].callback(); assert.equal(f.controller.switchEpoch, epoch); assert.equal(f.controller.phase, "AWAITING_KWIN");
    f.signal(2); assert.equal(f.controller.next(), false);
}
for (const actual of [0, 1, 2]) {
    const f = fixture(); f.controller.next(); f.setCurrent(actual); f.timers[0].callback();
    assert.equal(f.state.activeWorkspaceId, f.desktops[actual].id);
    assert.equal(f.controller.phase, "IDLE"); assert.equal(f.events.filter(e => e === "dock").length, 1);
}
{
    const f = fixture(); f.controller.requestDesktop = desktop => { f.signal(f.desktops.indexOf(desktop)); };
    f.controller.next(); assert.equal(f.controller.phase, "IDLE"); assert.equal(f.state.activeWorkspaceId, "B");
}
{
    const f = fixture(); f.controller.requestDesktop = () => { throw new Error("rejected"); };
    f.controller.next(); assert.equal(f.state.activeWorkspaceId, "A"); assert.equal(f.controller.phase, "IDLE");
}
{
    const f = fixture(); f.controller.next(); f.controller.onDesktopChanged(null, f.desktops[1], {});
    assert.equal(f.controller.phase, "AWAITING_KWIN");
    f.controller.stop(); const count = f.events.length; f.timers[0].callback(); f.signal(1);
    assert.equal(f.events.length, count); assert.equal(f.controller.next(), false);
}
{
    const f = fixture(); f.signal(2); assert.equal(f.state.activeWorkspaceId, "C");
    assert.deepEqual(f.events, ["cancel", "capture:A", "mount:C", "dock"]);
    f.controller.onDesktopChanged(null, f.desktops[0], f.output);
    assert.equal(f.events.length, 4, "stale payload must not change actual KDE desktop");
}
{
    const f = fixture(); let first = true;
    const hydrate = f.mount.mountPrepared;
    f.mount.mountPrepared = desktop => { const result = hydrate(desktop); if (first) { first = false; f.signal(2); } return result; };
    f.signal(1); assert.equal(f.state.activeWorkspaceId, "C");
    assert.deepEqual(f.events.slice(2), ["mount:B", "mount:C", "dock"]);
}
{
    const f = fixture(); f.controller.next(); f.setCurrent(2); f.controller.onTopologyChanged();
    assert.equal(f.state.activeWorkspaceId, "C"); assert.equal(f.controller.phase, "IDLE");
}
{
    const f = fixture(); f.controller.setTimer = () => { throw new Error("timer unavailable"); };
    f.controller.next(); assert.equal(f.controller.phase, "IDLE"); assert.equal(f.state.activeWorkspaceId, "A");
}
{
    const f = fixture(); f.controller.next(); f.state.targetOutput = null;
    f.controller.topology.getCurrentDesktop = () => null;
    let failed = false; f.controller.onFailure = () => { failed = true; };
    f.timers[0].callback(); assert.equal(failed, true); assert.equal(f.controller.stopped, true);
    assert.equal(f.state.workspaceSwitching, false);
}
for (const operation of ["capture", "mountPrepared"]) {
    const f = fixture(); let failed = false;
    f.mount[operation] = () => { throw new Error("failed"); };
    f.controller.onFailure = () => { failed = true; };
    f.controller.next(); if (operation === "mountPrepared") f.signal(1);
    assert.equal(failed, true); assert.equal(f.controller.stopped, true);
    assert.equal(f.state.workspaceSwitching, false);
}
console.log("PASS workspace switch transactions, timeout authority, epoch fencing and stop");
