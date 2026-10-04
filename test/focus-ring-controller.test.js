"use strict";
const assert = require("node:assert/strict");
const { FocusRingController } = require("../src/kwin/visual/FocusRingController");
const { ColumnStore } = require("../src/kwin/model/ColumnStore");
const { WindowPolicy } = require("../src/kwin/policy/WindowPolicy");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
const { LayoutTransaction } = require("../src/kwin/stability/LayoutTransaction");
function signal() {
    const handlers = new Set();
    return { connect: fn => handlers.add(fn), disconnect: fn => handlers.delete(fn),
        emit: (...args) => [...handlers].forEach(fn => fn(...args)), size: () => handlers.size };
}
const output = { name: "eDP-1" }, otherOutput = { name: "DP-1" };
const desktop = { id: "A" }, otherDesktop = { id: "B" };
let current = desktop;
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function windowFor(id) {
    const window = { internalId: `{${id.toUpperCase()}}`, output, desktops: {0: desktop, length: 1},
        managed: true, normalWindow: true, moveable: true, resizeable: true,
        maximizable: true, fullScreen: false, minimized: false, frameGeometry: {x:24,y:50,width:932,height:960} };
    ["closed", "outputChanged", "desktopsChanged", "skipTaskbarChanged", "transientChanged",
        "modalChanged", "fullScreenChanged", "minimizedChanged", "activitiesChanged"].forEach(name => window[name] = signal());
    return window;
}
const first = windowFor(a), second = windowFor(b);
const windows = [first, second];
const workspace = { windowList: () => windows };
["windowAdded", "windowActivated", "currentDesktopChanged", "desktopsChanged", "screensChanged", "screenOrderChanged"]
    .forEach(name => workspace[name] = signal());
const state = { enabled: true, activeWorkspaceId: "A", targetOutput: output,
    columns: [], focusedColumnIndex: -1, nextColumnId: 1 };
const windowStates = new Map(windows.map(window => [window, {floating: false}]));
const sent = [], callbacks = [];
const controller = new FocusRingController({workspace, sessionId: "independent", getState: () => state,
    getCurrentDesktop: () => current, getWindowState: window => windowStates.get(window),
    windowPolicy: new WindowPolicy(), membership: new WorkspaceMembership(),
    invoke: (service, path, iface, method, json, callback) => {
        assert.deepEqual([service, path, iface, method], ["org.kde.KWin", "/ccNiriFocusRing", "org.cc.NiriFocusRing1", "PublishEligibility"]);
        sent.push(JSON.parse(json)); callbacks.push(callback);
    }});
const columns = new ColumnStore(state, () => controller.membershipChanged());
columns.insertWindow(first, 0, "half"); columns.insertWindow(second, 1, "half");
assert.equal(sent.length, 0, "not started has no publication");
assert.equal(controller.start(), true); assert.equal(controller.start(), false);
assert.deepEqual(sent.at(-1).windows, [a,b]); assert.equal(sent.at(-1).generation, 1);
const layout = new LayoutTransaction({audit() {}, debug() {}});
columns.focusWindow(first);
const geometry = JSON.stringify(windows.map(window => window.frameGeometry));
layout.run("paint-pending", () => {
    workspace.activeWindow = second;
    workspace.windowActivated.emit(second);
    assert.equal(sent.at(-1).generation, 2, "activation published while transaction active");
    assert.equal(columns.focusedColumn().window, first, "no logical focus writes");
    workspace.activeWindow = null; workspace.windowActivated.emit(null);
    assert.equal(sent.at(-1).generation, 3, "null focus refresh is not suppressed");
});
assert.equal(JSON.stringify(windows.map(window => window.frameGeometry)), geometry, "no geometry writes");
const duplicate = sent.length; controller.publish(); assert.equal(sent.length, duplicate, "unchanged policy events coalesce");
controller.publish(true); assert.equal(sent.length, duplicate+1, "effect-on resends even after previous endpoint was absent");
callbacks[0](false); assert.equal(sent.length, duplicate+1, "late or failed acknowledgement cannot retry or change authority");
first.fullScreen = true; first.fullScreenChanged.emit();
assert.deepEqual(controller.snapshot().windows, [a,b], "native hides fullscreen and restores without losing membership");
first.fullScreen = false;
for (const key of ["dialog", "modal", "transient", "utility", "toolbar", "popupWindow", "skipTaskbar", "dock", "desktopWindow"]) {
    second[key] = true; controller.publish(); assert.deepEqual(sent.at(-1).windows, [a], key);
    second[key] = false; controller.publish(); assert.deepEqual(sent.at(-1).windows, [a,b]);
}
second.output = otherOutput; second.outputChanged.emit(); assert.deepEqual(sent.at(-1).windows, [a]);
second.output = output; second.outputChanged.emit();
second.desktops = {0: desktop, 1: otherDesktop, length: 2}; second.desktopsChanged.emit();
assert.deepEqual(sent.at(-1).windows, [a], "multi-workspace window excluded");
second.desktops = {0: desktop, length: 1}; second.desktopsChanged.emit();
windowStates.get(second).floating = true; columns.removeWindow(second);
assert.deepEqual(sent.at(-1).windows, [a], "floating detach immediate without Dock commit");
windowStates.get(second).floating = false; columns.insertWindow(second, 1, "half");
assert.deepEqual(sent.at(-1).windows, [a,b], "reattach adds eligibility");
current = otherDesktop; workspace.currentDesktopChanged.emit();
assert.equal(sent.at(-1).enabled, false); assert.deepEqual(sent.at(-1).windows, [], "native desktop switches before mount fail closed");
current = desktop; workspace.currentDesktopChanged.emit();
first.closed.emit(); assert.deepEqual(sent.at(-1).windows, [b]);
Object.defineProperty(first, "internalId", {get() {throw new Error("destroyed window read");}});
controller.publish(true); assert.deepEqual(sent.at(-1).windows, [b], "closed wrapper never dereferenced");
columns.removeWindow(first); assert.equal(controller.closed.size, 0, "closed wrapper released after model removal");
state.enabled = false; controller.publish(); assert.equal(sent.at(-1).enabled, false);
state.enabled = true; controller.publish();
assert.equal(controller.stop(), true); assert.equal(controller.stop(), false);
assert.equal(sent.at(-1).enabled, false); assert.deepEqual(sent.at(-1).windows, []);
assert.equal(workspace.windowActivated.size(), 0); assert.equal(second.closed.size(), 0);
const stoppedCount = sent.length; workspace.windowActivated.emit(second); second.outputChanged.emit();
assert.equal(sent.length, stoppedCount, "stopped callbacks disconnected");
windows.splice(0, 1); controller.start();
assert.deepEqual(sent.at(-1).windows, [b], "restart republishes fresh context"); controller.stop();
// Dormant/unmounted window closes never retain wrappers waiting for a model mutation.
const sleeping = windowFor("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
controller.start(); workspace.windowAdded.emit(sleeping); sleeping.closed.emit();
assert.equal(controller.closed.size, 0); assert.equal(controller.watched.has(sleeping), false);
const oldInvoke = controller.invoke;
controller.invoke = () => { throw new Error("endpoint unavailable"); };
assert.doesNotThrow(() => columns.clear(), "optional border transport cannot break layout mutations");
controller.invoke = oldInvoke; controller.publish(true); controller.stop();
console.log("PASS independent focus eligibility, transaction activation, lifecycle cleanup and effect-on resend");
