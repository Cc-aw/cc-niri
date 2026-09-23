const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WindowDisposition, WindowPolicy } =
    require("../src/kwin/policy/WindowPolicy");
const { AdoptionController } =
    require("../src/kwin/lifecycle/AdoptionController");
const { FloatingController } =
    require("../src/kwin/lifecycle/FloatingController");

const policy = new WindowPolicy();
const primary = { name: "DP-1" };
const phases = {
    untracked: "untracked", waitingEligible: "waiting-eligible",
    waitingActivation: "waiting-activation", waitingPrimary: "waiting-primary",
    waitingNormal: "waiting-normal", adopting: "adopting",
    settling: "settling", managed: "managed", floating: "floating",
    policyFloating: "policy-floating", ignored: "ignored",
};
const states = new Map();
const columns = [];
let adoptions = 0;
let removals = 0;
function windowFor(overrides = {}) {
    const window = {
        caption: "Window", output: primary, active: true, managed: true,
        normalWindow: true, moveable: true, resizeable: true,
        maximizable: true, fullScreen: false, maximizeMode: 0,
        ...overrides,
    };
    states.set(window, {
        floating: false, adoptionPhase: phases.untracked,
        adoptionAttempts: 0, layoutMode: "normal",
        managedByScrollLayout: false,
    });
    return window;
}
const adoption = new AdoptionController({
    phases,
    stateFor: window => states.get(window),
    hasState: window => states.has(window),
    indexOfWindow: window => columns.indexOf(window),
    getAppState: () => ({ enabled: true, targetOutput: primary }),
    refreshAppState: () => {},
    windowPolicy: policy,
    dispositions: WindowDisposition,
    removeManagedWindow: window => {
        removals += 1;
        columns.splice(columns.indexOf(window), 1);
        states.get(window).managedByScrollLayout = false;
    },
    isLayoutMode: mode => mode !== "normal",
    isTileMode: mode => mode === "tile",
    detectQuickTileMode: () => "normal",
    fullMaximizeMode: 3,
    adoptWindow: window => {
        adoptions += 1;
        columns.push(window);
        states.get(window).managedByScrollLayout = true;
        return true;
    },
    settleLayout: () => ({ settled: true, column: { id: 1 } }),
    rectText: () => "rect",
    debug: () => {},
});

const dialog = windowFor({ dialog: true, skipTaskbar: true });
assert.equal(adoption.onWindowAdded(dialog), false);
assert.equal(states.get(dialog).adoptionPhase, phases.policyFloating);
adoption.onActivated(dialog);
assert.equal(adoptions, 0, "a runtime dialog never reaches adoption");
assert.equal(columns.length, 0);

const popup = windowFor({ popupWindow: true, transient: true });
adoption.onWindowAdded(popup);
assert.equal(states.get(popup).adoptionPhase, phases.ignored);

const normal = windowFor();
assert.equal(adoption.onWindowAdded(normal), true);
assert.equal(columns.includes(normal), true);
normal.transient = true;
adoption.onPolicyChanged(normal, "transient-changed");
assert.equal(columns.includes(normal), false);
assert.equal(removals, 1);
assert.equal(states.get(normal).adoptionPhase, phases.policyFloating);
normal.transient = false;
adoption.onPolicyChanged(normal, "transient-changed");
assert.equal(columns.includes(normal), true);
assert.equal(adoptions, 2);

const userFloating = windowFor();
states.get(userFloating).floating = true;
adoption.onWindowAdded(userFloating);
assert.equal(states.get(userFloating).adoptionPhase, phases.floating);
userFloating.modal = true;
adoption.onPolicyChanged(userFloating, "modal-changed");
assert.equal(states.get(userFloating).adoptionPhase, phases.policyFloating);
assert.equal(states.get(userFloating).floating, true);
userFloating.modal = false;
adoption.onPolicyChanged(userFloating, "modal-changed");
assert.equal(states.get(userFloating).adoptionPhase, phases.floating);

let attached = 0;
const floating = new FloatingController({
    windowPolicy: policy,
    dispositions: WindowDisposition,
    stateFor: window => states.get(window),
    hasState: window => states.has(window),
    indexOfWindow: window => columns.indexOf(window),
    getAppState: () => ({ enabled: true, targetOutput: primary }),
    refreshAppState: () => {},
    prepareWindow: () => true,
    adoptWindow: () => { attached += 1; return true; },
    removeColumn: () => {},
    transitionAdoption: () => {},
    getActiveWindow: () => dialog,
    setActiveWindow: () => {},
    rectText: () => "rect",
    debug: () => {},
    warn: () => {},
    now: () => 1,
    focusGuardMs: 1200,
});
floating.remember(userFloating, false);
assert.equal(floating.toggle(dialog), false,
    "a dialog shortcut cannot attach a remembered user-floating window");
assert.equal(floating.rememberedWindow, userFloating);
assert.equal(attached, 0);
assert.equal(floating.attach(dialog, "direct"), false);
assert.equal(attached, 0);
userFloating.transient = true;
assert.equal(floating.hasRememberedFloating(), false,
    "a remembered window becomes invalid while policy-floating");
assert.equal(floating.rememberedWindow, null);

const mainSource = fs.readFileSync(path.join(__dirname,
    "../package/contents/code/main.js"), "utf8");
assert.ok(mainSource.includes("onWindowPolicyChanged(window, \"transient-changed\")"));
assert.ok(mainSource.includes("onWindowPolicyChanged(window, \"modal-changed\")"));
assert.ok(mainSource.includes("onWindowPolicyChanged(window, \"skip-taskbar-changed\")"));
assert.ok(mainSource.includes("windowPolicy.managedLayoutEligible(window)"));
assert.equal(mainSource.includes("includeDialogs"), false);

console.log("PASS policy-floating lifecycle, dynamic transitions, and floating isolation");
