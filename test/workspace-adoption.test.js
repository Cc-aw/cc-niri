"use strict";

const assert = require("node:assert/strict");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
const { AdoptionController } = require("../src/kwin/lifecycle/AdoptionController");
const { WindowPolicy, WindowDisposition } = require("../src/kwin/policy/WindowPolicy");
const a = { id: "A" };
const b = { id: "B" };
const primary = { name: "eDP-1" };
const appState = { enabled: true, targetOutput: primary };
const membership = new WorkspaceMembership({ getCurrentDesktop: () => a });
const phases = Object.fromEntries(["untracked", "waitingActivation", "waitingWorkspace", "waitingPrimary",
    "waitingEligible", "waitingNormal", "adopting", "settling", "managed", "floating", "policyFloating", "ignored"]
    .map(phase => [phase, phase]));
const states = new Map();
const columns = [];
let adopts = 0;
let removed = 0;
let workspaceReady = true;
const adoption = new AdoptionController({
    phases, workspaceMembership: membership,
    workspaceReady: () => workspaceReady,
    stateFor: window => states.get(window), hasState: window => states.has(window),
    indexOfWindow: window => columns.indexOf(window), getAppState: () => appState,
    refreshAppState: () => {}, windowPolicy: new WindowPolicy(), dispositions: WindowDisposition,
    removeManagedWindow: window => {
        removed += 1;
        columns.splice(columns.indexOf(window), 1);
        Object.assign(states.get(window), { managedByScrollLayout: false, columnId: null });
    },
    isLayoutMode: mode => mode !== "normal", isTileMode: () => false,
    detectQuickTileMode: () => "normal", fullMaximizeMode: 3,
    adoptWindow: window => {
        adopts += 1; columns.push(window);
        Object.assign(states.get(window), { managedByScrollLayout: true, columnId: adopts });
        return true;
    },
    settleLayout: () => ({ settled: true, column: { id: adopts } }),
    rectText: () => "rect", debug: () => {},
});
function create(overrides = {}) {
    const window = { managed: true, normalWindow: true, moveable: true, resizeable: true,
        active: true, fullScreen: false, maximizeMode: 0, output: primary,
        desktops: [a], onAllDesktops: false, ...overrides };
    states.set(window, { adoptionPhase: phases.untracked, adoptionAttempts: 0,
        floating: false, layoutMode: "normal", managedByScrollLayout: false, columnId: null,
        workspaceOwnerId: null });
    return window;
}
const foreign = create({ desktops: [b], output: { name: "other" }, fullScreen: true });
assert.equal(adoption.onWindowAdded(foreign), false);
assert.equal(states.get(foreign).adoptionPhase, phases.waitingWorkspace,
    "workspace check precedes output/fullscreen/activation");
assert.equal(states.get(foreign).workspaceOwnerId, "B");
for (const event of ["onReady", "onActivated", "onGeometryChanged", "onOutputChanged"]) adoption[event](foreign);
assert.equal(adopts, 0, "inactive workspace signals cannot insert a Column");
foreign.desktops = [a]; foreign.output = primary; foreign.fullScreen = false;
assert.equal(adoption.onMembershipChanged(foreign), true);
assert.equal(states.get(foreign).workspaceOwnerId, "A");
assert.equal(adopts, 1);
foreign.onAllDesktops = true; foreign.desktops = [];
assert.equal(adoption.onMembershipChanged(foreign), false);
assert.equal(removed, 1);
assert.equal(states.get(foreign).workspaceOwnerId, null);
assert.equal(states.get(foreign).managedByScrollLayout, false);
assert.equal(states.get(foreign).columnId, null);
assert.equal(states.get(foreign).adoptionPhase, phases.ignored);
foreign.onAllDesktops = false; foreign.desktops = [a]; foreign.active = false;
adoption.onMembershipChanged(foreign);
assert.equal(states.get(foreign).adoptionPhase, phases.waitingActivation);
foreign.active = true;
assert.equal(adoption.onActivated(foreign), true);
foreign.desktops = [a, b];
adoption.onMembershipChanged(foreign);
assert.equal(removed, 2);
assert.equal(states.get(foreign).adoptionPhase, phases.ignored);

const dialog = create({ dialog: true, desktops: [b] });
adoption.onWindowAdded(dialog);
assert.equal(states.get(dialog).adoptionPhase, phases.policyFloating, "WindowPolicy retains priority");
assert.equal(states.get(dialog).workspaceOwnerId, "B");
const floating = create({ desktops: [b] }); states.get(floating).floating = true;
adoption.onWindowAdded(floating);
assert.equal(states.get(floating).adoptionPhase, phases.floating);
const sticky = create({ onAllDesktops: true, desktops: [] });
adoption.onWindowAdded(sticky);
assert.equal(states.get(sticky).adoptionPhase, phases.ignored);
const single = create();
assert.equal(adoption.onWindowAdded(single), true, "active single-desktop adoption remains unchanged");
assert.equal(states.get(single).workspaceOwnerId, "A");
workspaceReady = false;
const incoming = create();
const beforeBarrier = adopts;
adoption.onWindowAdded(incoming);
adoption.onActivated(incoming);
adoption.onReady(incoming);
adoption.onGeometryChanged(single);
assert.equal(states.get(incoming).adoptionPhase, phases.waitingWorkspace);
assert.equal(adopts, beforeBarrier, "KDE activation before desktop mount cannot insert into the old workspace");
assert.equal(states.get(single).adoptionPhase, phases.managed, "mount barrier does not disturb ownership of old Columns");
workspaceReady = true;
assert.equal(adoption.onActivated(incoming), true);
console.log("PASS workspace adoption ordering, native sticky detach and activation without focus stealing");
