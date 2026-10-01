"use strict";
const assert = require("node:assert/strict");
const { DynamicWorkspaceController } = require("../src/kwin/workspace/DynamicWorkspaceController");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
function fixture(options = {}) {
    const output = { name: "eDP-1" };
    let desktops = [{ id: "A" }, { id: "B" }];
    let windows = [];
    const timers = new Set(), calls = [], warnings = [];
    let ready = true;
    const controller = new DynamicWorkspaceController({
        enabled: true, isReady: () => ready, getTargetOutput: () => output,
        getDesktops: () => desktops, getWindows: () => windows,
        membership: new WorkspaceMembership(),
        createDesktop: (position, name) => {
            calls.push({ position, name });
            desktops.push({ id: `new-${calls.length}` });
            controller.request(); // Synchronous native topology signal.
        },
        setTimer: (callback, delay) => { const timer = { callback, delay }; timers.add(timer); return timer; },
        clearTimer: timer => timers.delete(timer), warn: message => warnings.push(message),
        ...options,
    });
    return { controller, output, calls, warnings, timers,
        window: (desktop = "B", values = {}) => ({ managed: true, normalWindow: true, output,
            desktops: [{ id: desktop }], ...values }),
        setWindows: value => { windows = value; }, setDesktops: value => { desktops = value; },
        setReady: value => { ready = value; },
        flush() { const pending = [...timers]; pending.forEach(timer => { timers.delete(timer); timer.callback(); }); },
    };
}
{
    const f = fixture({ enabled: false }); f.setWindows([f.window()]); f.controller.request(); f.flush();
    assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
}
{
    const f = fixture(); f.setWindows([f.window("A")]); f.controller.request(); f.flush();
    assert.equal(f.calls.length, 0, "existing trailing empty desktop suffices");
    f.setWindows([f.window()]); for (let i = 0; i < 10; ++i) f.controller.request();
    assert.equal(f.timers.size, 1); f.flush(); f.flush();
    assert.deepEqual(f.calls, [{ position: 2, name: "" }], "append exactly once, including synchronous signals");
    f.setWindows([]); f.controller.request(); f.flush();
    assert.equal(f.calls.length, 1, "closing windows never deletes or adds desktops");
    f.setWindows([f.window("new-1")]); f.controller.request(); f.flush(); f.flush();
    assert.equal(f.calls.length, 2, "occupying the new last desktop appends another empty one");
}
for (const properties of [
    { floating: true }, { fullScreen: true }, { minimized: true },
    { normalWindow: false, dialog: true }, { resizeable: false }, { skipTaskbar: true },
    { desktops: { 0: { id: "A" }, 1: { id: "B" }, length: 2 } },
]) {
    const f = fixture(); f.setWindows([f.window("B", properties)]); f.controller.request(); f.flush();
    assert.equal(f.calls.length, 1, "occupancy includes native/Floating/minimized and Qt sequence memberships");
}
for (const properties of [
    { output: { name: "other" } }, { desktops: [], onAllDesktops: true },
    { desktopWindow: true }, { dock: true }, { popupWindow: true }, { splash: true },
    { resourceClass: "plasmashell" }, { managed: false },
]) {
    const f = fixture(); f.setWindows([f.window("B", properties)]); f.controller.request(); f.flush();
    assert.equal(f.calls.length, 0, "native shell/sticky/other-output windows do not occupy a workspace");
}
{
    const f = fixture(); f.setWindows([f.window()]); f.controller.request(); f.setReady(false); f.flush();
    assert.equal(f.calls.length, 0); f.setReady(true); f.controller.request(); f.flush();
    assert.equal(f.calls.length, 1, "startup/switch barriers require a fresh settled event");
}
{
    const f = fixture(); f.setWindows([f.window()]); f.controller.request(); f.setWindows([]); f.flush();
    assert.equal(f.calls.length, 0, "close before deferred check cannot retain a dead QObject or create a desktop");
    f.setWindows([f.window()]); f.controller.request(); f.controller.stop(); f.flush();
    assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
    f.controller.request(); assert.equal(f.timers.size, 0);
}
for (const failure of [() => {}, () => { throw new Error("native failure"); }, null]) {
    const f = fixture({ createDesktop: failure }); f.setWindows([f.window()]);
    f.controller.request(); f.flush(); f.flush();
    for (let i = 0; i < 10; ++i) { f.controller.request(); f.flush(); }
    assert.equal(f.warnings.length, 1, "API absence/failure/limit cannot cause a create loop");
    assert.equal(f.timers.size, 0);
}
{
    let calls = 0;
    const f = fixture({ createDesktop: () => { ++calls; } }); f.setWindows([f.window()]);
    f.controller.request(); f.flush();
    f.controller.request(); assert.equal(calls, 1, "pending request waits for topology confirmation");
    assert.equal(f.timers.size, 1);
    f.setDesktops([{ id: "A" }, { id: "B" }, { id: "C" }]); f.controller.request(); f.flush();
    assert.equal(f.warnings.length, 0, "late topology signal confirms creation without duplicate append");
    f.setWindows([f.window("C")]); f.controller.request(); f.flush(); assert.equal(calls, 2);
}
console.log("PASS dynamic trailing desktop: opt-in, primary occupancy, barriers, native reentry, lifetime and create failures");
