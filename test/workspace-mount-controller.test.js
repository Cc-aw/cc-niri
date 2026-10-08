"use strict";
const assert = require("node:assert/strict");
const { WorkspaceMountController } = require("../src/kwin/workspace/WorkspaceMountController");
const { WorkspaceSnapshotStore } = require("../src/kwin/workspace/WorkspaceSnapshotStore");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
const { VirtualDesktopTopology } = require("../src/kwin/workspace/VirtualDesktopTopology");
const { ColumnStore } = require("../src/kwin/model/ColumnStore");
const { WindowStateStore } = require("../src/kwin/model/WindowStateStore");
const { WindowPolicy } = require("../src/kwin/policy/WindowPolicy");
const { deriveColumnLayout, computeStripWidth, boundScrollOffset, scrollOffsetToRevealColumn } = require("../src/kwin/layout/ColumnLayout");
const { Recovery } = require("../src/kwin/stability/Recovery");
const { ParkingManager } = require("../src/kwin/stability/ParkingManager");

function fixture() {
    const desktops = [{ id: "A" }, { id: "B" }, { id: "C" }];
    const output = { name: "eDP-1" };
    let current = desktops[0];
    let activeWindow = null;
    let windows = [];
    const state = { enabled: true, targetOutput: output, safeRect: { x: 0, y: 0, width: 1000, height: 800 },
        innerGap: 8, nextColumnId: 1, columns: [], focusedColumnIndex: -1, scrollOffsetX: 0,
        activeWorkspaceId: null, workspaceSwitching: false,
        viewport: { mode: "pair", wideColumnId: null }, presentation: { mode: "normal", windowUuid: null } };
    const states = new WindowStateStore(() => ({ managedByScrollLayout: false, columnId: null,
        workspaceOwnerId: null, floating: false, layoutMode: "normal", adoptionPhase: "untracked" }));
    const snapshots = new WorkspaceSnapshotStore();
    const columns = new ColumnStore(state);
    const topology = new VirtualDesktopTopology({ getDesktops: () => desktops, getCurrentDesktop: () => current });
    const membership = new WorkspaceMembership({ getCurrentDesktop: () => current });
    const events = [];
    const preparations = [];
    let prepare = () => true;
    const controller = new WorkspaceMountController({
        appState: state, columnStore: columns, snapshots, topology, membership, windowPolicy: new WindowPolicy(),
        stateFor: window => states.ensure(window), getWindows: () => windows, getActiveWindow: () => activeWindow,
        normalizeUuid: value => String(value || "").toLowerCase().replace(/[{}]/g, ""),
        refreshState: () => {}, prepareWindow: window => { preparations.push(window.internalId); return prepare(window); },
        transitionAdoption: (window, windowState, phase) => { windowState.adoptionPhase = phase; },
        phases: { managed: "managed", waitingWorkspace: "waiting-workspace" },
        cancelPending: () => events.push("cancel"),
        resetPresentation: () => {
            state.viewport = { mode: "pair", wideColumnId: null };
            state.presentation = { mode: "normal", windowUuid: null };
        },
        restoreViewport: viewport => { state.viewport = {...viewport}; },
        recomputeLayout: () => {
            events.push("logical");
            deriveColumnLayout(state.columns, state.safeRect.width, state.innerGap).forEach((layout, index) => Object.assign(state.columns[index], layout));
        },
        boundOffset: offset => boundScrollOffset(offset, computeStripWidth(state.columns), state.safeRect.width),
        ensureVisible: column => {
            state.scrollOffsetX = scrollOffsetToRevealColumn(state.scrollOffsetX, column,
                computeStripWidth(state.columns), state.safeRect.width);
        },
        relayout: () => {
            assert.equal(controller.canUseActiveWorkspace(), false, "adoption blocked until relayout completes");
            assert.ok(["pair", "wide-focus"].includes(state.viewport.mode)); assert.equal(state.presentation.mode, "normal");
            events.push("relayout");
        },
        commitDock: () => events.push("dock"),
        releaseWindow: (window, reason) => events.push(`release:${window.internalId}:${reason}`),
        onFailure: error => { throw error; }, debug: () => {},
    });
    function window(uuid, desktop = desktops[0], overrides = {}) {
        const w = { internalId: uuid, output, desktops: [desktop], onAllDesktops: false,
            managed: true, normalWindow: true, moveable: true, resizeable: true,
            fullScreen: false, opacity: 1, minimized: false, ...overrides };
        windows.push(w); states.ensure(w); return w;
    }
    function switchTo(index) {
        const previous = current; current = desktops[index];
        return controller.onDesktopChanged(previous, current, output);
    }
    return { controller, state, states, snapshots, columns, desktops, output, events, preparations, window, switchTo,
        setCurrent: index => { current = desktops[index]; }, setActive: window => { activeWindow = window; },
        setPrepare: callback => { prepare = callback; }, removeWindow: window => { windows = windows.filter(w => w !== window); } };
}

const f = fixture();
const a = f.window("a"); const b = f.window("b"); const c = f.window("c"); const d = f.window("d");
const x = f.window("x", f.desktops[1]); const y = f.window("y", f.desktops[1]);
f.window("sticky", f.desktops[0], { desktops: [], onAllDesktops: true });
f.window("multi", f.desktops[0], { desktops: f.desktops.slice(0, 2) });
f.window("dialog", f.desktops[0], { dialog: true });
f.window("other-output", f.desktops[0], { output: { name: "other" } });
const floating = f.window("floating"); f.states.get(floating).floating = true;
f.setActive(c);
assert.equal(f.controller.initialize(""), true);
assert.deepEqual(f.preparations, ["a", "b", "c", "d"], "startup cannot prepare foreign, sticky, floating or dialog windows");
assert.deepEqual(f.state.columns.map(column => column.window.internalId), ["a", "b", "c", "d"]);
assert.equal(f.columns.focusedColumn().window, c);
assert.equal(f.state.activeWorkspaceId, "A");
assert.equal(f.controller.canUseActiveWorkspace(), true);
const ids = f.state.columns.map(column => column.id);
f.columns.reorder([f.state.columns[1], f.state.columns[0], f.state.columns[2], f.state.columns[3]]);
f.state.columns[2].persistentWide = true;
f.state.scrollOffsetX = f.state.columns[2].logicalX + 12;
// Mark old parked state: unmount must leave all parking fields intact.
Object.assign(f.states.get(d), { scrollParkedByScript: true, scrollVisuallyHidden: true,
    scrollParkingMinimized: true, scrollOriginalOpacity: 1, scrollLastVisibleGeometry: { x: 0, y: 0, width: 300, height: 300 } });
d.opacity = 0; d.minimized = true; d.frameGeometry = { x: -4096, y: 0, width: 300, height: 300 };
f.setActive(x); f.events.length = 0;
assert.equal(f.switchTo(1), true);
assert.deepEqual(f.events, ["cancel", "logical", "relayout", "dock"]);
assert.deepEqual(f.state.columns.map(column => column.window.internalId), ["x", "y"]);
assert.equal(f.states.get(d).managedByScrollLayout, false);
assert.equal(f.states.get(d).columnId, null);
assert.equal(f.states.get(d).workspaceOwnerId, "A");
assert.equal(f.states.get(d).adoptionPhase, "waiting-workspace");
assert.equal(d.opacity, 0); assert.equal(d.minimized, true); assert.equal(d.frameGeometry.x, -4096);
assert.equal(f.snapshots.get("A").viewportAnchor.uuid, "c");
assert.equal(f.snapshots.get("A").viewportAnchor.delta, 12);
f.removeWindow(a); f.snapshots.removeWindow("a");
const e = f.window("e");
f.setActive(null); f.events.length = 0;
assert.equal(f.switchTo(0), true);
assert.deepEqual(f.state.columns.map(column => column.window.internalId), ["b", "c", "d", "e"]);
assert.equal(f.columns.focusedColumn().window, c, "snapshot focus used when KDE active window is not a Column");
assert.equal(f.state.scrollOffsetX, f.state.columns[1].logicalX + 12);
assert.equal(f.state.columns[1].persistentWide, true);
assert.ok(f.state.columns.every(column => column.id > Math.max(...ids)), "Column IDs remain session-monotonic");
assert.equal(f.events.filter(event => event === "relayout").length, 1);
assert.equal(f.controller.onDesktopChanged(f.desktops[0], f.desktops[1], { name: "secondary" }), false);
assert.equal(f.state.activeWorkspaceId, "A");
f.events.length = 0; f.switchTo(2);
assert.equal(f.state.columns.length, 0); assert.equal(f.state.focusedColumnIndex, -1); assert.equal(f.state.scrollOffsetX, 0);
assert.equal(f.events.filter(event => event === "relayout").length, 1, "empty mount still completes one layout transaction");
f.setActive(b); f.switchTo(0);
assert.equal(f.columns.focusedColumn().window, b, "KDE current focus has priority over saved focus");

// Emergency recovery traverses sleeping parked windows, not only active columns.
f.switchTo(1);
const parking = new ParkingManager({ stateFor: w => f.states.ensure(w), getState: w => f.states.get(w),
    refreshSafeArea: () => {}, getSafeRect: () => f.state.safeRect, debug: () => {} });
const recovery = new Recovery({ appState: f.state, windowStates: f.states, parking,
    indexOfWindow: w => f.columns.indexOfWindow(w), beforeRestore: () => f.controller.stop(), warn: () => {} });
assert.equal(recovery.restoreAll("test"), 1);
assert.equal(d.opacity, 1); assert.equal(d.minimized, false); assert.ok(d.frameGeometry.x >= 0);
assert.equal(f.controller.canUseActiveWorkspace(), false);

const legacy = fixture(); const oldA = legacy.window("a"); const oldB = legacy.window("b"); legacy.window("c");
legacy.controller.initialize(JSON.stringify({ protocol: 1, targetOutput: "eDP-1",
    columns: [{ uuid: "b", widthMode: "third" }, { uuid: "a" }], focusedUuid: "b",
    viewportAnchor: { uuid: "b", delta: 0 } }));
assert.deepEqual(legacy.state.columns.map(column => column.window), [oldB, oldA, legacy.state.columns[2].window]);
assert.equal(legacy.state.columns[0].widthMode, "half", "legacy fractional width migrates at mount");
assert.equal(legacy.columns.focusedColumn().window, oldB);

const fullscreen = fixture(); const fs = fullscreen.window("fs", fullscreen.desktops[0], { fullScreen: true });
fullscreen.controller.initialize("");
assert.equal(fullscreen.state.columns.length, 0, "new native fullscreen is not adopted");
fullscreen.switchTo(1);
fullscreen.snapshots.set("A", { columns: [{ uuid: "fs", persistentWide: true }] });
fullscreen.setActive(fs); fullscreen.switchTo(0);
assert.equal(fullscreen.state.columns[0].window, fs, "saved managed fullscreen retains ownership without exiting fullscreen");
assert.equal(fs.fullScreen, true);

const added = fixture(); const first = added.window("first"); let late;
added.setPrepare(window => {
    assert.equal(added.controller.canUseActiveWorkspace(), false);
    if (window === first && !late) late = added.window("late");
    return true;
});
added.controller.initialize("");
assert.deepEqual(added.state.columns.map(column => column.window.internalId), ["first", "late"],
    "new windows added during preparation are reconciled in the same batch");
assert.equal(added.events.filter(event => event === "relayout").length, 1);
added.setCurrent(1);
assert.equal(added.controller.canUseActiveWorkspace(), false, "actual KDE desktop change gates adoption even before its signal");
added.controller.onDesktopChanged(added.desktops[0], added.desktops[0], added.output);
assert.equal(added.state.activeWorkspaceId, "B", "actual current desktop wins over stale payload");
late.desktops = []; late.onAllDesktops = true;
added.controller.onWindowMembershipChanged(late);
assert.equal(added.snapshots.workspaceForWindow("late"), null);
assert.ok(added.events.includes("release:late:workspace-membership-changed"), "sleeping sticky window is released immediately");
added.controller.onWindowClosed(first);
assert.equal(added.snapshots.workspaceForWindow("first"), null);

const failed = fixture(); failed.window("fail");
failed.setPrepare(() => { throw new Error("prepare failed"); });
assert.throws(() => failed.controller.initialize(""), /prepare failed/);
assert.equal(failed.state.workspaceSwitching, false, "exceptions close the barrier");
assert.equal(failed.controller.canUseActiveWorkspace(), false, "failure stops further geometry ownership");

const changing = fixture(); const changingWindow = changing.window("changes-during-prepare");
changing.setPrepare(window => { window.desktops = []; window.onAllDesktops = true; return true; });
changing.controller.initialize("");
assert.equal(changing.state.columns.length, 0, "membership is rechecked after preparation signals");
assert.equal(changingWindow.onAllDesktops, true);

const reentrant = fixture(); const original = reentrant.window("original");
const destination = reentrant.window("destination", reentrant.desktops[1]);
let changedDuringPrepare = false;
reentrant.setPrepare(window => {
    if (window === original && !changedDuringPrepare) {
        changedDuringPrepare = true;
        reentrant.setCurrent(1);
        assert.equal(reentrant.controller.onDesktopChanged(reentrant.desktops[0], reentrant.desktops[1], reentrant.output), false);
    }
    return true;
});
reentrant.controller.initialize("");
assert.equal(reentrant.state.activeWorkspaceId, "B", "a native change during the batch is reconciled after the barrier");
assert.equal(reentrant.state.columns[0].window, destination);
assert.equal(reentrant.controller.canUseActiveWorkspace(), true);
console.log("PASS batch workspace mount preserves order, focus, anchor, sleeping parking and recovery");

const wide = fixture(); const wideOwner = wide.window("wide"); wide.window("neighbor");
const otherWide = wide.window("other", wide.desktops[1]);
wide.setActive(wideOwner); wide.controller.initialize("");
wide.state.columns[0].persistentWide = true;
wide.state.viewport = {mode: "wide-focus", wideColumnId: wide.state.columns[0].id};
const oldWideId = wide.state.viewport.wideColumnId;
wide.setActive(otherWide); wide.switchTo(1);
assert.equal(wide.state.viewport.mode, "pair", "Wide never leaks to another desktop");
assert.equal(wide.snapshots.get("A").viewport.wideUuid, "wide");
wide.setActive(wideOwner); wide.switchTo(0);
assert.equal(wide.state.viewport.mode, "wide-focus", "saved Wide survives workspace return");
assert.notEqual(wide.state.viewport.wideColumnId, oldWideId, "restored Wide maps UUID to fresh Column ID");
assert.equal(wide.columns.focusedColumn().id, wide.state.viewport.wideColumnId);
wide.setActive(otherWide); wide.switchTo(1);
wide.setActive(wide.state.columns[0].window); // then explicitly select A's neighbor on return
const neighbor = wide.controller.getWindows().find(w => w.internalId === "neighbor");
wide.setActive(neighbor); wide.switchTo(0);
assert.equal(wide.state.viewport.mode, "pair", "KDE focus on another Column must not force old Wide");
// Persistent preference without an active Wide viewport is not an expansion request.
wide.setActive(wideOwner); wide.columns.focusIndex(wide.columns.indexOfWindow(wideOwner));
wide.state.viewport = {mode: "pair", wideColumnId: null};
wide.setActive(otherWide); wide.switchTo(1); wide.setActive(wideOwner); wide.switchTo(0);
assert.equal(wide.state.viewport.mode, "pair", "Pair with a Wide preference remains Pair");
console.log("PASS workspace Wide viewport restores only its surviving focused UUID with fresh Column ID");
