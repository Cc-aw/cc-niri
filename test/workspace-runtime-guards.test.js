"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
const { WindowPolicy, WindowDisposition } = require("../src/kwin/policy/WindowPolicy");
const { FloatingController } = require("../src/kwin/lifecycle/FloatingController");
const { InvariantChecker } = require("../src/kwin/stability/InvariantChecker");
const { StabilitySupervisor } = require("../src/kwin/stability/StabilitySupervisor");
const { ParkingManager } = require("../src/kwin/stability/ParkingManager");
const source = fs.readFileSync(path.join(__dirname, "../package/contents/code/main.js"), "utf8");
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    return source.slice(start, source.indexOf("\n}\n", start) + 3);
}
const a = { id: "A" };
const b = { id: "B" };
const primary = { name: "eDP-1" };
const membership = new WorkspaceMembership({ getCurrentDesktop: () => a });
const policy = new WindowPolicy();
const normal = { managed: true, normalWindow: true, moveable: true, resizeable: true,
    maximizable: true, output: primary, desktops: [a], onAllDesktops: false };
const foreign = { ...normal, desktops: [b] };
const sticky = { ...normal, desktops: [], onAllDesktops: true };
let inserted = 0;
let prepared = 0;
let startupMounted = 0;
const appState = { enabled: true, targetOutput: primary, columns: [], focusedColumnIndex: -1,
    innerGap: 8, safeRect: { width: 100 }, scrollOffsetX: 0,
    presentation: { mode: "normal", windowUuid: null } };
const states = new Map();
const stateFor = window => {
    if (!states.has(window)) states.set(window, { floating: true, managedByScrollLayout: false });
    return states.get(window);
};
const context = vm.createContext({
    windowPolicy: policy, workspaceMembership: membership, mainScreenState: appState,
    workspaceMountController: { canUseActiveWorkspace: () => true, initialize: () => { startupMounted += 1; return true; } },
    workspaceTransferController: { onWindowAdded: () => {} },
    workspaceSnapshots: { removeWindow: () => false },
    stateFor, columnIndexForWindow: () => -1, COLUMN_WIDTH_HALF: "half", debug: () => {},
    columnStore: { insertWindow: window => { inserted += 1; return { id: inserted, window }; }, indexOf: () => 0 },
    refreshMainScreenState: () => {}, startupLayout: { load: () => false, orderWindows: windows => windows },
    workspace: { windowList: () => [foreign, sticky, normal] },
    prepareInitialColumn: () => { prepared += 1; return true; },
    addInitialColumn: () => {},
});
vm.runInContext(["scrollEligible", "eligible", "addColumnAt", "initializeScrollLayout"].map(functionSource).join("\n"), context);
assert.equal(context.addColumnAt(foreign, 0, "test"), null);
assert.equal(context.addColumnAt(sticky, 0, "test"), null);
assert.equal(inserted, 0, "direct insertion cannot bypass membership");
assert.equal(context.eligible(sticky), false, "native sticky maximize/tile must not be intercepted");
context.initializeScrollLayout("");
assert.equal(startupMounted, 1, "startup delegates its batch to WorkspaceMountController");
assert.equal(prepared, 0, "application startup cannot adopt windows individually");
context.addColumnAt(normal, 0, "test");
assert.equal(states.get(normal).workspaceOwnerId, "A");

let focusWrites = 0;
const floating = new FloatingController({
    workspaceMembership: membership, windowPolicy: policy, dispositions: WindowDisposition,
    stateFor, hasState: window => states.has(window), indexOfWindow: () => -1,
    getAppState: () => appState, refreshAppState: () => {},
    prepareWindow: () => { prepared += 1; return true; },
    adoptWindow: () => { inserted += 1; return true; },
    setActiveWindow: () => { focusWrites += 1; }, now: () => 1,
    debug: () => {}, focusGuardMs: 1000,
});
stateFor(foreign);
floating.remember(foreign, true);
assert.equal(floating.hasRememberedFloating(), false);
assert.equal(floating.redirectActivation(normal), false);
assert.equal(floating.attach(foreign, "test"), false);
assert.equal(floating.attach(sticky, "test"), false);
assert.equal(focusWrites, 0, "remembered floating cannot pull focus from another workspace");
assert.equal(prepared, 0, "rejected floating attach does not change native maximize/tile state");

appState.columns = [{ id: 1, window: sticky, logicalX: 0, pixelWidth: 100 }];
appState.focusedColumnIndex = 0;
states.set(sticky, { managedByScrollLayout: true, columnId: 1, floating: false, adoptionPhase: "managed" });
const checker = new InvariantChecker({ appState, windowStates: states,
    workspaceMembership: membership, normalizeUuid: () => "sticky-uuid",
    stripWidth: () => 100, managedPhases: ["managed"], normalPresentationMode: "normal" });
assert.deepEqual(checker.errors(), ["sticky-managed:sticky-uuid"]);
assert.equal(new StabilitySupervisor({}).isCritical("sticky-managed:sticky-uuid"), true);

// Exercise the real removal + parking-release path for a parked window becoming
// sticky. Restoring opacity alone would leave its geometry off-screen.
Object.assign(sticky, { frameGeometry: { x: -4096, y: 0, width: 100, height: 100 }, opacity: 0, minimized: true });
Object.assign(states.get(sticky), { scrollParkedByScript: true, scrollVisuallyHidden: true,
    scrollParkingMinimized: true, scrollOriginalOpacity: 1,
    scrollLastVisibleGeometry: { x: 0, y: 0, width: 100, height: 100 } });
Object.assign(appState.safeRect, { x: 0, y: 0, height: 200 });
appState.viewport = { mode: "pair", wideColumnId: null };
const parking = new ParkingManager({ stateFor, getState: window => states.get(window),
    refreshSafeArea: () => {}, getSafeRect: () => appState.safeRect, debug: () => {} });
Object.assign(context, {
    focusRingController: { publish: () => {} },
    contextualWideCoordinator: { cancelForWindow: () => {} },
    columnIndexForWindow: () => 0, cancelPendingDockScroll: () => {},
    releaseParkingOwnership: (window, reason, accessible, index) => parking.release(window, reason, accessible, index),
    isFullyVisibleInSafeRect: () => false, normalizeWindowUuid: () => "sticky-uuid",
    states, ADOPTION_UNTRACKED: "untracked", ADOPTION_FLOATING: "floating",
    adoptionController: { transition: (window, state, phase) => { state.adoptionPhase = phase; } },
    commitRuntimeState: () => {},
    columnStore: { focusedColumn: () => appState.columns[0], removeWindow: () => {
        appState.columns = []; appState.focusedColumnIndex = -1;
    } },
});
vm.runInContext(functionSource("removeColumn"), context);
context.removeColumn(sticky, "window-desktops-changed", false);
assert.equal(sticky.frameGeometry.x, 0);
assert.equal(sticky.opacity, 1);
assert.equal(sticky.minimized, false);
assert.equal(parking.owns(sticky), false);
assert.equal(states.get(sticky).managedByScrollLayout, false);
assert.equal(states.get(sticky).columnId, null);
console.log("PASS runtime membership gates protect startup, direct insertion, floating focus and native sticky layout");
