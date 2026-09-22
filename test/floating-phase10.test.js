const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FloatingController } =
    require("../src/kwin/lifecycle/FloatingController");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);
const installSource = fs.readFileSync(
    path.join(__dirname, "../install.sh"),
    "utf8"
);

assert.ok(mainSource.includes("class FloatingController"));
const controllerSource = mainSource.slice(
    mainSource.indexOf("class FloatingController"),
    mainSource.indexOf("const TAG")
);
assert.equal(controllerSource.includes("frameGeometry ="), false,
    "detaching never rewrites the floating window geometry");
assert.ok(controllerSource.includes("this.removeColumn(window, reason, false)"),
    "detaching does not activate a successor over the floating window");
assert.ok(controllerSource.includes("this.prepareWindow(window)"),
    "native maximize or Quick Tile is detached before Column adoption");
assert.ok(controllerSource.includes("this.adoptWindow(window, reason, true)"),
    "a returning floating window uses the normal focused-right insertion path");

const interactiveSource = mainSource.slice(
    mainSource.indexOf("function onInteractiveMoveResizeStarted"),
    mainSource.indexOf("function setupWindow")
);
assert.ok(interactiveSource.includes(
    "floatingController.onInteractiveMoveResize(window)"
), "interactive move/resize detaches a managed Column");
assert.equal(controllerSource.includes("FLOATING_REATTACH_GRACE_MS"), false,
    "mouse-detached windows do not expire before the user can return them");
const activationSource = mainSource.slice(
    mainSource.indexOf("function onWindowActivatedForScrollLayout"),
    mainSource.indexOf("function focusRelativeColumn")
);
assert.ok(activationSource.includes("floatingController.redirectActivation(window)"),
    "KWin focus churn is redirected to the just-detached floating window");

const primary = { name: "DP-1" };
const secondary = { name: "HDMI-A-1" };
const geometry = { x: 24, y: 50, width: 1252, height: 1320 };
const managed = {
    caption: "managed", output: primary, fullScreen: false, minimized: true,
    frameGeometry: geometry,
};
const unrelated = {
    caption: "unrelated", output: primary, fullScreen: false, minimized: false,
    frameGeometry: geometry,
};
const states = new Map([
    [managed, { floating: false, adoptionPhase: "managed", interactiveMoveResize: false }],
    [unrelated, { floating: false, adoptionPhase: "managed", interactiveMoveResize: false }],
]);
const columns = [managed, unrelated];
let activeWindow = unrelated;
let now = 1000;
let prepareCalls = 0;
let adoptCalls = 0;
const controller = new FloatingController({
    stateFor: window => states.get(window),
    hasState: window => states.has(window),
    indexOfWindow: window => columns.indexOf(window),
    getAppState: () => ({ enabled: true, targetOutput: primary }),
    refreshAppState: () => {},
    scrollEligible: () => true,
    prepareWindow: () => { prepareCalls += 1; return true; },
    adoptWindow: window => { adoptCalls += 1; columns.push(window); return true; },
    removeColumn: window => columns.splice(columns.indexOf(window), 1),
    transitionAdoption: (_window, state, phase) => { state.adoptionPhase = phase; },
    floatingPhase: "floating",
    settlingPhase: "settling",
    managedPhase: "managed",
    getActiveWindow: () => activeWindow,
    setActiveWindow: window => { activeWindow = window; },
    rectText: () => "rect",
    debug: () => {},
    warn: () => {},
    now: () => now,
    focusGuardMs: 1200,
});

assert.equal(controller.detach(managed, "test-detach"), true);
assert.equal(states.get(managed).floating, true);
assert.equal(states.get(managed).adoptionPhase, "floating");
assert.equal(columns.includes(managed), false);
assert.equal(managed.frameGeometry, geometry);
assert.equal(managed.minimized, false);
assert.equal(activeWindow, managed);

controller.remember(managed, true);
assert.equal(controller.redirectActivation(unrelated), true);
assert.equal(activeWindow, managed);
now = 3000;
assert.equal(controller.redirectActivation(unrelated), false,
    "focus redirection expires without forgetting the reattach target");

assert.equal(controller.toggle(unrelated), true,
    "remembered floating target wins over unrelated active window");
assert.equal(states.get(managed).floating, false);
assert.equal(states.get(managed).adoptionPhase, "managed");
assert.equal(columns.includes(managed), true);
assert.equal(prepareCalls, 1);
assert.equal(adoptCalls, 1);
assert.equal(controller.hasRememberedFloating(), false);

assert.equal(controller.onInteractiveMoveResize(managed), true);
assert.equal(states.get(managed).interactiveMoveResize, true);
assert.equal(states.get(managed).floating, true);
now = 100000;
assert.equal(controller.hasRememberedFloating(), true,
    "mouse-detached targets remain remembered without an expiry timeout");
controller.onWindowClosed(managed);
assert.equal(controller.hasRememberedFloating(), false);

const secondaryWindow = {
    caption: "secondary", output: secondary, fullScreen: false,
    frameGeometry: geometry,
};
states.set(secondaryWindow, {
    floating: true, adoptionPhase: "floating", interactiveMoveResize: false,
});
assert.equal(controller.attach(secondaryWindow, "secondary-test"), false,
    "secondary-output windows remain native");

const applicationSource = mainSource.slice(
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.equal(/\.floating\s*=(?!=)/.test(applicationSource), false,
    "application code must change floating ownership through FloatingController");

assert.ok(mainSource.includes('"CCScrollToggleFloating"'));
assert.ok(mainSource.includes('"Meta+Shift+Return"'),
    "the main keyboard Return key is registered");
assert.ok(mainSource.includes('"CCScrollToggleFloatingKeypad"'));
assert.ok(mainSource.includes('"Meta+Shift+Enter"'));
assert.ok(installSource.includes('"[318767108]" 4'),
    "installation repairs the live main Return key code");
assert.ok(installSource.includes('"[318767109]" 4'),
    "installation preserves keypad Enter as a separate action");

console.log("PASS Phase 10 managed/floating toggle and interactive detach");
