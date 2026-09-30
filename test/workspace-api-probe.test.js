"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../poc/kwin-workspace-api-probe.js"), "utf8");

function signal() {
    const callbacks = [];
    return { connect: callback => callbacks.push(callback), emit: (...args) => callbacks.forEach(callback => callback(...args)) };
}

const a = Object.freeze({ id: "A", name: "First", x11DesktopNumber: 1 });
const b = Object.freeze({ id: "B", name: "Second", x11DesktopNumber: 2 });
const primary = Object.freeze({ name: "DP-1", geometry: { x: 0, y: 0 } });
const secondary = Object.freeze({ name: "HDMI-A-1", geometry: { x: 2560, y: 0 } });
const window = { internalId: "uuid-a", caption: "test", output: primary, desktops: [a], onAllDesktops: false, desktopsChanged: signal() };
for (const key of ["frameGeometry", "opacity", "minimized"]) {
    Object.defineProperty(window, key, { set() { throw new Error(`probe must not write ${key}`); } });
}
const workspace = {
    screens: [secondary, primary], desktops: [a, b], currentDesktop: a,
    currentDesktopForScreen: output => output === primary ? a : b,
    currentDesktopChanged: signal(), desktopsChanged: signal(),
    screensChanged: signal(), windowAdded: signal(), windowRemoved: signal(),
    windowList: () => [window],
};
Object.freeze(workspace);
const logs = [];
vm.runInNewContext(source, { workspace, console: { info: line => logs.push(line) } });
const records = () => logs.map(line => JSON.parse(line.slice(line.indexOf("{") )));
assert.deepEqual(records().find(record => record.event === "desktops").desktops.map(desktop => desktop.id), ["A", "B"]);
assert.equal(records().find(record => record.event === "current" && record.output === "DP-1").desktop.id, "A");
assert.equal(records().find(record => record.event === "current" && record.output === "HDMI-A-1").desktop.id, "B");
workspace.currentDesktopChanged.emit(a, b, secondary);
const change = records().find(record => record.event === "currentDesktopChanged");
assert.equal(change.argumentCount, 3);
assert.equal(change.previous.id, "A");
assert.equal(change.current.id, "B");
assert.equal(change.output, "HDMI-A-1");
assert.equal(change.isTargetOutput, false);
window.desktops = [b];
window.desktopsChanged.emit();
assert.equal(records().find(record => record.event === "window.desktopsChanged").desktops[0].id, "B");
const late = { ...window, internalId: "late", desktopsChanged: signal() };
workspace.windowAdded.emit(late);
workspace.windowAdded.emit(late); // must not attach the same listener twice
late.onAllDesktops = true;
late.desktops = [];
late.desktopsChanged.emit();
assert.equal(records().filter(record => record.event === "window.desktopsChanged" && record.uuid === "late").length, 1);
assert.equal(records().at(-1).onAllDesktops, true);
workspace.desktopsChanged.emit();
assert.equal(records().filter(record => record.event === "desktops").length, 2);

const fallbackLogs = [];
vm.runInNewContext(source, {
    workspace: { screens: [], desktops: [a], currentDesktop: a, windowList: () => [] },
    console: { info: line => fallbackLogs.push(line) },
});
assert.ok(fallbackLogs.some(line => line.includes('"event":"missing-signal"')));
assert.ok(fallbackLogs.some(line => line.includes('"source":"currentDesktop (global fallback)"')));
console.log("PASS read-only workspace API probe records topology, output signals, transfers and late windows");
