const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { OutputController } =
    require("../src/kwin/lifecycle/OutputController");

const phases = {
    untracked: "untracked",
    waitingPrimary: "waiting-primary",
    floating: "floating",
    ignored: "ignored",
};
const primary = { name: "DP-1" };
const secondary = { name: "HDMI-A-1" };

function fixture(overrides = {}) {
    const calls = [];
    const state = {
        internalChange: false,
        interactiveMoveResize: false,
        adoptionPhase: phases.untracked,
        layoutMode: "normal",
        ...overrides.state,
    };
    const options = {
        stateFor: () => state,
        indexOfWindow: () => -1,
        resolvePrimaryOutput: () => primary,
        clearPresentationForWindow: () => calls.push(["clear-presentation"]),
        removeColumn: (...args) => calls.push(["remove", ...args]),
        transitionAdoption: (...args) => calls.push(["transition", ...args]),
        phases,
        profileForOutput: () => null,
        translateRestoreGeometry: (...args) => calls.push(["translate", ...args]),
        fullMaximizeMode: 3,
        maximizeMode: "maximize",
        applyLayoutGeometry: (...args) => calls.push(["layout", ...args]),
        detectQuickTileMode: () => "normal",
        isTileMode: mode => mode !== "normal",
        applyDetectedTile: (...args) => calls.push(["tile", ...args]),
        beginAdoption: (...args) => calls.push(["begin", ...args]),
        advanceAdoption: (...args) => calls.push(["advance", ...args]),
        setLayoutMode: (...args) => calls.push(["set-layout-mode", ...args]),
        rectText: () => "0,0 100x100",
        debug: message => calls.push(["debug", message]),
        ...overrides.options,
    };
    return { controller: new OutputController(options), state, calls };
}

function makeWindow(output = primary) {
    return {
        caption: "Terminal",
        output,
        fullScreen: false,
        maximizeMode: 0,
        frameGeometry: { x: 0, y: 0, width: 100, height: 100 },
        setMaximize(horizontal, vertical) {
            this.maximizeArgs = [horizontal, vertical];
        },
    };
}

{
    const window = makeWindow(secondary);
    const { controller, state, calls } = fixture({
        state: { adoptionPhase: "managed" },
        options: { indexOfWindow: () => 1 },
    });
    assert.equal(controller.onOutputChanged(window), true);
    assert.deepEqual(calls[0], ["clear-presentation"]);
    assert.deepEqual(calls[1], ["remove", window, "output-left-primary", false]);
    assert.deepEqual(calls[2], [
        "transition", window, state, phases.waitingPrimary, "output-left-primary",
    ]);
    assert.equal(calls.some(call => call[0] === "translate"), false,
        "a departing Column is removed before restore geometry is translated");
}

{
    const window = makeWindow(secondary);
    const { controller, state, calls } = fixture({
        state: { adoptionPhase: "waiting-eligible" },
    });
    controller.onOutputChanged(window);
    assert.deepEqual(calls[0], [
        "transition", window, state, phases.waitingPrimary, "output-wait-primary",
    ]);
    assert.deepEqual(calls[1], ["translate", state, secondary]);
}

for (const [phase, expectedCall] of [
    [phases.untracked, "begin"],
    [phases.waitingPrimary, "advance"],
]) {
    const window = makeWindow(primary);
    const { controller, calls } = fixture({
        state: { adoptionPhase: phase },
        options: { profileForOutput: () => ({ inner: 8 }) },
    });
    controller.onOutputChanged(window);
    assert.deepEqual(
        calls.find(call => call[0] === expectedCall),
        [expectedCall, window, "output-entered-primary"]
    );
}

{
    const window = makeWindow(primary);
    const { controller, state, calls } = fixture({
        state: { adoptionPhase: "managed", layoutMode: "maximize" },
        options: { profileForOutput: () => ({ inner: 8 }) },
    });
    controller.onOutputChanged(window);
    assert.deepEqual(calls.find(call => call[0] === "layout"), [
        "layout", window, state, "maximize", "output-adopt-maximize",
    ]);
}

{
    const window = makeWindow(primary);
    const { controller, calls } = fixture({
        options: {
            profileForOutput: () => ({ inner: 8 }),
            detectQuickTileMode: () => "left",
        },
    });
    controller.onOutputChanged(window);
    assert.deepEqual(calls.find(call => call[0] === "tile"), [
        "tile", window, "output-adopt-tile",
    ]);
}

{
    const window = makeWindow(secondary);
    const { controller, state } = fixture({
        state: { adoptionPhase: phases.untracked, layoutMode: "maximize" },
    });
    controller.onOutputChanged(window);
    assert.deepEqual(window.maximizeArgs, [true, true]);
    assert.equal(state.internalChange, false,
        "the native maximize guard is always released");
}

{
    const window = makeWindow(secondary);
    const { controller, state, calls } = fixture({
        options: { detectQuickTileMode: () => "right" },
    });
    controller.onOutputChanged(window);
    assert.deepEqual(calls.find(call => call[0] === "set-layout-mode"), [
        "set-layout-mode", state, "right",
    ]);
}

for (const stateFlags of [
    { internalChange: true },
    { interactiveMoveResize: true },
]) {
    const window = makeWindow(secondary);
    const { controller, calls } = fixture({ state: stateFlags });
    assert.equal(controller.onOutputChanged(window), false);
    assert.deepEqual(calls, []);
}
{
    const window = makeWindow(secondary);
    window.fullScreen = true;
    const { controller, calls } = fixture();
    assert.equal(controller.onOutputChanged(window), false);
    assert.deepEqual(calls, []);
}

const source = fs.readFileSync(
    path.join(__dirname, "../src/kwin/lifecycle/OutputController.js"),
    "utf8"
);
assert.equal(source.includes("commitDockState"), false);
assert.equal(source.includes("setPresentationMode"), false);
assert.equal(/adoptionPhase\s*=(?!=)/u.test(source), false,
    "OutputController delegates adoption transitions to its owner");

console.log("PASS OutputController preserves cross-output lifecycle semantics");
