const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { AdoptionController } =
    require("../src/kwin/lifecycle/AdoptionController");

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

assert.ok(mainSource.includes("class AdoptionController"));
const controllerSource = mainSource.slice(
    mainSource.indexOf("class AdoptionController"),
    mainSource.indexOf(
        "// Generated from src/kwin/lifecycle/FloatingController.js"
    )
);
assert.ok(controllerSource.includes("adoptionAttempts += 1"));
assert.ok(controllerSource.includes("this.adoptWindow(window, reason, true)"),
    "a runtime window is inserted beside the focused column exactly once");
assert.equal(controllerSource.includes("commitDockState"), false,
    "AdoptionController does not publish Dock state directly");
assert.equal(controllerSource.includes("setPresentationMode"), false,
    "AdoptionController does not own Presentation state");
assert.ok(mainSource.includes("managedPhases: [ADOPTION_MANAGED, ADOPTION_SETTLING]"),
    "invariant auditing accepts a Column while its committed geometry settles");

const runtimeWiringSource = mainSource.slice(
    mainSource.indexOf("const app = new CCNiri"),
    mainSource.indexOf("app.start()")
);
assert.ok(runtimeWiringSource.includes("adoptionController.onWindowAdded(window)"));
const lifecycleSource = mainSource.slice(
    mainSource.indexOf("class RuntimeLifecycle"),
    mainSource.indexOf("// Generated from src/kwin/runtime/ShortcutCatalog.js")
);
assert.ok(lifecycleSource.indexOf("this.workspace.windowList().forEach") <
    lifecycleSource.indexOf("this.initializeScrollLayout();"),
"the startup snapshot is adopted synchronously without runtime heuristics");

const outputSource = mainSource.slice(
    mainSource.indexOf("function onOutputChanged"),
    mainSource.indexOf("function onFullScreenChanged")
);
assert.ok(outputSource.includes("outputController.onOutputChanged(window)"));
const outputControllerSource = mainSource.slice(
    mainSource.indexOf("class OutputController"),
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.ok(outputControllerSource.includes("this.phases.waitingPrimary"));
assert.ok(outputControllerSource.includes(
    'this.advanceAdoption(window, "output-entered-primary")'
));

const phases = {
    untracked: "untracked", waitingActivation: "waiting-activation",
    waitingPrimary: "waiting-primary", waitingEligible: "waiting-eligible",
    waitingNormal: "waiting-normal", adopting: "adopting",
    settling: "settling", managed: "managed", floating: "floating",
    ignored: "ignored",
};
const primary = { name: "DP-1" };
const secondary = { name: "HDMI-A-1" };
const appState = { enabled: true, targetOutput: primary };
const stateMap = new Map();
const columns = [];
let adoptions = 0;
function createState() {
    return {
        adoptionPhase: phases.untracked,
        adoptionAttempts: 0,
        adoptionOrigin: "",
        adoptionLastEvent: "",
        managedByScrollLayout: false,
        floating: false,
        layoutMode: "normal",
    };
}
const controller = new AdoptionController({
    phases,
    stateFor: window => stateMap.get(window),
    hasState: window => stateMap.has(window),
    indexOfWindow: window => columns.indexOf(window),
    getAppState: () => appState,
    refreshAppState: () => {},
    isPlasmaShellWindow: window => Boolean(window.plasma),
    isLayoutMode: mode => mode !== "normal",
    isTileMode: mode => mode === "tile",
    detectQuickTileMode: window => window.tiled ? "tile" : "normal",
    fullMaximizeMode: 3,
    scrollEligible: window => window.eligible,
    adoptWindow: window => {
        adoptions += 1;
        columns.push(window);
        stateMap.get(window).managedByScrollLayout = true;
        return true;
    },
    settleLayout: window => ({
        settled: true,
        column: { id: columns.indexOf(window) + 1 },
        expected: window.frameGeometry,
    }),
    rectText: () => "rect",
    debug: () => {},
});
function addWindow(overrides = {}) {
    const window = {
        caption: "test", output: primary, active: false, fullScreen: false,
        maximizeMode: 0, eligible: true, tiled: false,
        frameGeometry: { x: 0, y: 0, width: 100, height: 100 },
        ...overrides,
    };
    stateMap.set(window, createState());
    return window;
}

const normalLaunch = addWindow();
controller.onWindowAdded(normalLaunch);
controller.onReady(normalLaunch);
controller.onReady(normalLaunch, "window-shown");
assert.equal(stateMap.get(normalLaunch).adoptionPhase, phases.waitingActivation);
normalLaunch.active = true;
controller.onActivated(normalLaunch, "active");
controller.onActivated(normalLaunch, "duplicate-active");
assert.equal(stateMap.get(normalLaunch).adoptionPhase, phases.managed);
assert.equal(adoptions, 1,
    "ready/shown cannot pre-adopt and duplicate activation cannot insert twice");

const secondaryLaunch = addWindow({ output: secondary, active: true });
controller.onWindowAdded(secondaryLaunch);
assert.equal(stateMap.get(secondaryLaunch).adoptionPhase, phases.waitingPrimary);
secondaryLaunch.output = primary;
controller.onOutputChanged(secondaryLaunch);
assert.equal(stateMap.get(secondaryLaunch).adoptionPhase, phases.managed);

const fullscreenLaunch = addWindow({ active: true, fullScreen: true });
controller.onWindowAdded(fullscreenLaunch);
assert.equal(stateMap.get(fullscreenLaunch).adoptionPhase, phases.waitingNormal);
fullscreenLaunch.fullScreen = false;
controller.onFullscreenChanged(fullscreenLaunch);
assert.equal(stateMap.get(fullscreenLaunch).adoptionPhase, phases.managed);

const plasmaWindow = addWindow({ active: true, plasma: true });
controller.onWindowAdded(plasmaWindow);
assert.equal(stateMap.get(plasmaWindow).adoptionPhase, phases.ignored);

const floatingWindow = addWindow({ active: true });
stateMap.get(floatingWindow).floating = true;
controller.onWindowAdded(floatingWindow);
assert.equal(stateMap.get(floatingWindow).adoptionPhase, phases.floating);

const applicationSource = mainSource.slice(
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.equal(/\.adoptionPhase\s*=(?!=)/.test(applicationSource), false,
    "application code must transition adoption state through AdoptionController");

console.log("PASS deterministic new-window adoption state machine");
