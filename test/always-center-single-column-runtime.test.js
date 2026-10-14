"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
const key = (r, action) => r.shortcuts.get(`CCScroll${action}`)();
const fixture = extra => createRuntime({ AlwaysCenterSingleColumn: true,
    PrimaryWindowCount: 1, OtherWorkspaceWindowCount: 0, ...extra });
function check(r) {
    assert.equal(r.evaluate("invariantChecker.errors().length"), 0, r.logs.join("\n"));
    assert.equal(r.logs.some(line => /INVARIANT_FAIL|FAIL_SAFE/.test(line)), false, r.logs.join("\n"));
}
function single(r, mode = "half") {
    assert.equal(r.state.columns.length, 1);
    const column = r.state.columns[0];
    assert.equal(column.logicalX, 630);
    assert.equal(column.widthMode, mode);
    assert.equal(column.pixelWidth, mode === "full" ? 2512 : 1252);
    assert.equal(r.state.scrollOffsetX, mode === "full" ? 630 : 0);
    assert.equal(column.window.frameGeometry.x, mode === "full" ? 24 : 654);
    assert.equal(column.window.opacity, 1);
    assert.equal(column.window.minimized, false);
    check(r);
}
{
    const r = fixture(); single(r);
    assert.equal(r.published.at(-1).viewportAnchor, null, "centered single half needs no anchor");
    key(r, "ToggleColumnFull"); single(r, "full");
    key(r, "ToggleColumnFull"); single(r);
    key(r, "ToggleFocusWide");
    assert.equal(r.state.viewport.mode, "wide-focus");
    assert.equal(r.a[0].frameGeometry.width, Math.round(2512 * 0.72));
    key(r, "ToggleFocusWide"); single(r);
    const saved = JSON.parse(JSON.stringify(r.published.at(-1)));
    const restored = fixture({ PreviousState: saved }); single(restored);
    const disabled = fixture({ AlwaysCenterSingleColumn: false, PreviousState: saved });
    assert.equal(disabled.state.columns[0].logicalX, 0);
    assert.equal(disabled.a[0].frameGeometry.x, 24); check(disabled);
    assert.deepEqual(saved.columns.map(c => c.uuid), restored.published.at(-1).columns.map(c => c.uuid));
}
{
    const r = fixture({ PrimaryWindowCount: 2 });
    assert.equal(r.state.scrollOffsetX, 630);
    assert.deepEqual(r.a.map(w => w.frameGeometry.x), [24, 1284]); check(r);
    const saved = JSON.parse(JSON.stringify(r.published.at(-1)));
    const restored = fixture({ PrimaryWindowCount: 2, PreviousState: saved });
    assert.equal(restored.state.scrollOffsetX, 630);
    assert.deepEqual(restored.a.map(w => w.frameGeometry.x), [24, 1284]); check(restored);
    const disabled = fixture({ PrimaryWindowCount: 2, AlwaysCenterSingleColumn: false, PreviousState: saved });
    assert.deepEqual(disabled.a.map(w => w.frameGeometry.x), [24, 1284]); check(disabled);
}
{
    const r = fixture({ PrimaryWindowCount: 0 });
    assert.equal(r.state.scrollOffsetX, 0);
    const a = r.add("first", 0); r.workspace.activeWindow = a;
    single(r);
    assert.equal(r.nativeArms.length, 0, "empty to single is a static initial placement");
    r.close(a);
    assert.equal(r.state.columns.length, 0);
    assert.equal(r.state.scrollOffsetX, 0); check(r);
}
{
    const r = fixture();
    r.nativeSwitch(1, null);
    assert.equal(r.state.columns.length, 0);
    const b = r.add("new-B", 1); r.workspace.activeWindow = b; single(r);
    r.nativeSwitch(0, r.a[0]); single(r);
    assert.equal(r.state.columns[0].window, r.a[0]);
}
{
    const r = fixture(); key(r, "ToggleColumnFull");
    const restored = fixture({ PreviousState: r.published.at(-1) }); single(restored, "full");
}
for (const count of [3, 5]) {
    const r = fixture({ PrimaryWindowCount: count });
    assert.equal(r.state.scrollOffsetX, 630);
    for (let i = 1; i < count; i += 1) { key(r, "FocusNextColumn"); check(r); }
    const focused = r.state.columns[r.state.focusedColumnIndex];
    assert.equal(focused.window.minimized, false);
    assert.ok(focused.window.frameGeometry.x >= r.state.safeRect.x);
    assert.ok(focused.window.frameGeometry.x + focused.pixelWidth <= r.state.safeRect.x + r.state.safeRect.width);
    r.a.slice(0, -1).forEach(window => r.close(window)); single(r);
}
{
    const r = fixture();
    key(r, "ToggleFloating"); assert.equal(r.state.columns.length, 0);
    key(r, "ToggleFloating"); single(r);
    const secondary = { name: "HDMI-A-1", geometry: {x:2560,y:0,width:2560,height:1440} };
    r.workspace.screens.push(secondary);
    const auxiliary = r.add("secondary-window", 0, { output: secondary });
    const before = { ...auxiliary.frameGeometry };
    r.add("dialog", 0, { dialog: true }); r.add("transient", 0, { transient: true });
    single(r);
    assert.deepEqual({ ...auxiliary.frameGeometry }, before, "secondary geometry is not centered");
    r.a[0].fullScreen = true; r.a[0].fullScreenChanged.emit();
    assert.equal(r.state.columns[0].window.fullScreen, true);
    r.a[0].fullScreen = false; r.a[0].fullScreenChanged.emit(); single(r);
}
{
    const r = fixture({ PrimaryWindowCount: 2 });
    r.workspace.setCurrentDesktopForScreen = (desktop, output) => {
        assert.equal(output, r.output);
        const active = r.workspace.windowList().find(w => w.desktops[0] === desktop);
        r.nativeSwitch(r.desktops.indexOf(desktop), active);
    };
    key(r, "MoveColumnNextWorkspace");
    assert.equal(r.state.activeWorkspaceId, "B"); single(r);
    r.nativeSwitch(0, r.a[1]); single(r);
    assert.equal(r.state.columns[0].window, r.a[1]);
}
console.log("PASS runtime single center, Full/Wide, empty/startup, workspace isolation and snapshot rollback");
