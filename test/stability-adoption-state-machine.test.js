const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);

for (const phase of [
    "ADOPTION_UNTRACKED",
    "ADOPTION_WAITING_ACTIVATION",
    "ADOPTION_WAITING_PRIMARY",
    "ADOPTION_WAITING_ELIGIBLE",
    "ADOPTION_WAITING_NORMAL",
    "ADOPTION_ADOPTING",
    "ADOPTION_SETTLING",
    "ADOPTION_MANAGED",
    "ADOPTION_FLOATING",
    "ADOPTION_IGNORED",
]) {
    assert.ok(mainSource.includes(`const ${phase} =`), `missing ${phase}`);
}

assert.ok(!mainSource.includes("pendingNewWindows"),
    "adoption has one source of truth instead of a parallel pending Set");
assert.ok(!mainSource.includes("startupRestoreDeadline"));
assert.ok(!mainSource.includes("STARTUP_RESTORE_GRACE_MS"));

const waitSource = mainSource.slice(
    mainSource.indexOf("function adoptionWaitPhase"),
    mainSource.indexOf("function settleAdoptedWindow")
);
assert.ok(waitSource.indexOf("ADOPTION_WAITING_PRIMARY") <
    waitSource.indexOf("ADOPTION_WAITING_ACTIVATION"),
"output ownership is resolved before activation");
assert.ok(waitSource.indexOf("ADOPTION_WAITING_NORMAL") <
    waitSource.indexOf("ADOPTION_WAITING_ACTIVATION"),
"fullscreen, maximize, and Quick Tile settle before activation can adopt");
assert.ok(waitSource.includes("!window.active"));
assert.ok(waitSource.includes("isPlasmaShellWindow(window)"));

const advanceSource = mainSource.slice(
    mainSource.indexOf("function advanceWindowAdoption"),
    mainSource.indexOf("function beginWindowAdoption")
);
assert.ok(advanceSource.includes("ADOPTION_ADOPTING"));
assert.ok(advanceSource.includes("ADOPTION_SETTLING"));
assert.ok(advanceSource.includes("adoptionAttempts += 1"));
assert.ok(advanceSource.includes("adoptNewWindowAsColumn(window, reason, true)"),
    "a runtime window is inserted beside the focused column exactly once");
assert.ok(mainSource.includes("windowState.adoptionPhase === ADOPTION_SETTLING"),
    "invariant auditing accepts a Column while its committed geometry settles");

const addedSource = mainSource.slice(
    mainSource.indexOf("workspace.windowAdded.connect"),
    mainSource.indexOf("workspace.windowActivated.connect")
);
assert.ok(addedSource.includes('beginWindowAdoption(window, "window-added")'));
assert.ok(mainSource.indexOf("workspace.windowList().forEach(setupWindow)") <
    mainSource.lastIndexOf("initializeScrollLayout();"),
"the startup snapshot is adopted synchronously without runtime heuristics");

const outputSource = mainSource.slice(
    mainSource.indexOf("function onOutputChanged"),
    mainSource.indexOf("function onFullScreenChanged")
);
assert.ok(outputSource.includes("ADOPTION_WAITING_PRIMARY"));
assert.ok(outputSource.includes('advanceWindowAdoption(window, "output-entered-primary")'));

function advanceModel(model, event) {
    if (["managed", "floating", "ignored"].includes(model.phase)) return;
    if (model.plasma) {
        model.phase = "ignored";
    } else if (model.floating) {
        model.phase = "floating";
    } else if (!model.primary) {
        model.phase = "waiting-primary";
    } else if (model.fullScreen || model.layoutOverride) {
        model.phase = "waiting-normal";
    } else if (!model.eligible) {
        model.phase = "waiting-eligible";
    } else if (!model.active) {
        model.phase = "waiting-activation";
    } else {
        model.phase = "managed";
        model.adoptions += 1;
        model.adoptedBy = event;
    }
}

const normalLaunch = {
    phase: "waiting-eligible", primary: true, eligible: true,
    active: false, fullScreen: false, layoutOverride: false,
    floating: false, plasma: false, adoptions: 0,
};
advanceModel(normalLaunch, "ready");
advanceModel(normalLaunch, "shown");
assert.equal(normalLaunch.phase, "waiting-activation");
normalLaunch.active = true;
advanceModel(normalLaunch, "active");
advanceModel(normalLaunch, "duplicate-active");
assert.deepEqual(
    { phase: normalLaunch.phase, adoptions: normalLaunch.adoptions,
        adoptedBy: normalLaunch.adoptedBy },
    { phase: "managed", adoptions: 1, adoptedBy: "active" },
    "ready/shown cannot pre-adopt and duplicate activation cannot insert twice"
);

const secondaryLaunch = { ...normalLaunch, phase: "waiting-eligible",
    primary: false, active: true, adoptions: 0 };
advanceModel(secondaryLaunch, "active-secondary");
assert.equal(secondaryLaunch.phase, "waiting-primary");
secondaryLaunch.primary = true;
advanceModel(secondaryLaunch, "output-entered-primary");
assert.equal(secondaryLaunch.adoptions, 1);

const fullscreenLaunch = { ...normalLaunch, phase: "waiting-eligible",
    active: true, fullScreen: true, adoptions: 0 };
advanceModel(fullscreenLaunch, "active-fullscreen");
assert.equal(fullscreenLaunch.phase, "waiting-normal");
fullscreenLaunch.fullScreen = false;
advanceModel(fullscreenLaunch, "fullscreen-exit");
assert.equal(fullscreenLaunch.adoptions, 1);

console.log("PASS deterministic new-window adoption state machine");
