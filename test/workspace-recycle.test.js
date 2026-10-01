"use strict";
const assert = require("node:assert/strict");
const { WorkspaceRecycleController } = require("../src/kwin/workspace/WorkspaceRecycleController");
const { WorkspaceOccupancy } = require("../src/kwin/workspace/WorkspaceOccupancy");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
function fixture(options = {}) {
    let ids = ["A", "B", "C", "D"], windows = [], protectedIds = ["A"], ready = true;
    const timers = new Set(), removed = [], confirmed = [], warnings = [];
    const controller = new WorkspaceRecycleController({
        enabled: true, isReady: () => ready, getDesktopIds: () => ids.slice(),
        getProtectedIds: () => protectedIds, getWindows: () => windows,
        occupancy: new WorkspaceOccupancy({ membership: new WorkspaceMembership() }),
        removeDesktop: id => { removed.push(id); ids = ids.filter(value => value !== id); controller.request(); },
        onRemoved: id => confirmed.push(id), ensureVerticalLayout: () => {},
        setTimer: (callback, delay) => { const handle = { callback, delay }; timers.add(handle); return handle; },
        clearTimer: handle => timers.delete(handle), warn: message => warnings.push(message), ...options,
    });
    return { controller, removed, confirmed, warnings, timers, ids: () => ids,
        window: (desktop, values = {}) => ({ managed: true, normalWindow: true, desktops: [{ id: desktop }], ...values }),
        setWindows: value => { windows = value; }, setIds: value => { ids = value; },
        protect: value => { protectedIds = value; }, setReady: value => { ready = value; },
        flush() { [...timers].forEach(timer => { timers.delete(timer); timer.callback(); }); },
        drain() { for (let pass = 0; timers.size && pass < 20; ++pass) this.flush(); assert.equal(timers.size, 0); },
    };
}
{
    const f = fixture({ enabled: false }); f.controller.request(); f.drain(); assert.deepEqual(f.removed, []);
}
{
    const f = fixture(); f.controller.request(); f.drain();
    assert.deepEqual(f.ids(), ["A", "D"], "keep current empty desktop and final empty desktop");
    assert.deepEqual(f.removed, ["B", "C"]); assert.deepEqual(f.confirmed, ["B", "C"]);
    f.protect(["D"]); f.controller.request(); f.drain(); assert.deepEqual(f.ids(), ["D"], "leaving an empty desktop makes it reclaimable");
}
for (const properties of [
    { minimized: true }, { fullScreen: true }, { floating: true }, { normalWindow: false, dialog: true },
    { output: { name: "secondary" } }, { activities: ["other-activity"] }, { skipTaskbar: true },
    { managed: false, popupWindow: true },
]) {
    const f = fixture(); f.setWindows([f.window("B", properties)]); f.controller.request(); f.drain();
    assert.ok(f.ids().includes("B"), "all live non-shell memberships block recycling, across output/activity/native policies");
}
{
    const f = fixture(); f.setWindows([f.window("B", { desktops: { length: 2, 0: { id: "B" }, 1: { id: "C" } } })]);
    f.controller.request(); f.drain(); assert.deepEqual(f.ids(), ["A", "B", "C", "D"]);
}
{
    const f = fixture(); f.setWindows([f.window("B", { desktops: undefined })]);
    f.controller.request(); f.drain(); assert.deepEqual(f.removed, [], "unknown application membership fails closed");
}
{
    const f = fixture(); f.setWindows([f.window("B", { desktops: [], onAllDesktops: true }),
        f.window("C", { resourceClass: "plasmashell" }), f.window("C", { dock: true })]);
    f.controller.request(); f.drain(); assert.deepEqual(f.ids(), ["A", "D"], "sticky and shell do not own recyclable desktops");
}
{
    const f = fixture(); f.protect(["A", "B"]); f.controller.request(); f.drain();
    assert.deepEqual(f.ids(), ["A", "B", "D"], "protect current desktops on every output");
}
{
    const f = fixture(); f.controller.request(); f.setWindows([f.window("B"), f.window("C")]); f.drain();
    assert.deepEqual(f.removed, [], "recheck live occupancy after debounce");
    f.setWindows([]); f.controller.request(); f.setReady(false); f.drain(); assert.deepEqual(f.removed, []);
    f.setReady(true); f.controller.request(); f.controller.stop(); f.drain();
    assert.deepEqual(f.removed, []); f.controller.request(); assert.equal(f.timers.size, 0);
}
for (const removeDesktop of [null, () => {}, () => { throw new Error("native error"); }]) {
    const f = fixture({ removeDesktop }); f.controller.request(); f.drain();
    for (let pass = 0; pass < 5; ++pass) { f.controller.request(); f.drain(); }
    assert.equal(f.warnings.length, 1, "missing API, no-op and native error cannot produce a deletion loop");
}
{
    const f = fixture(); let calls = 0;
    f.controller.removeDesktop = id => { ++calls; f.removed.push(id); };
    f.controller.request(); f.flush(); f.controller.request(); assert.equal(calls, 1);
    f.setIds(["A", "C", "D"]); f.controller.stop(); f.flush();
    assert.deepEqual(f.confirmed, [], "late confirmation after stop cannot publish or request another removal");
}
{
    const f = fixture(); f.controller.removeDesktop = id => { f.removed.push(id); f.setIds(["A", "C", "D"]); f.protect(["A", "C"]); f.controller.request(); };
    f.controller.request(); f.drain(); assert.deepEqual(f.removed, ["B"], "synchronous native signal makes next current desktop protected");
}
{
    const f = fixture();
    f.controller.removeDesktop = id => f.removed.push(id);
    f.controller.request(); f.flush(); f.controller.request();
    assert.deepEqual(f.removed, ["B"], "a pending asynchronous removal cannot duplicate requests");
    f.setIds(["A", "C", "D"]); f.protect(["A", "C"]); f.drain();
    assert.deepEqual(f.confirmed, ["B"], "late successful topology confirms cleanup exactly once");
    assert.equal(f.warnings.length, 0);
}
{
    const f = fixture();
    f.controller.removeDesktop = id => { f.removed.push(id); f.setIds(["A", "C", "D"]); throw new Error("after native removal"); };
    f.controller.request(); f.flush(); f.protect(["A", "C"]); f.drain();
    assert.deepEqual(f.confirmed, ["B"], "partial native success still performs snapshot cleanup");
    assert.equal(f.warnings.length, 0);
}
{
    let recovered = false;
    const f = fixture({ onRemoved: () => { throw new Error("save failed"); }, onFailure: () => { recovered = true; } });
    f.controller.request(); f.drain(); assert.equal(recovered, true); assert.equal(f.controller.stopped, true);
    assert.deepEqual(f.removed, ["B"], "cleanup failure stops further removal");
}
console.log("PASS workspace recycling: opt-in, empty/current/tail policy, all windows, Qt membership, live recheck and removal confirmation");
