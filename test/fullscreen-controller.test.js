const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FullscreenController } =
    require("../src/kwin/lifecycle/FullscreenController");
const { ContextualViewport } =
    require("../src/kwin/presentation/ContextualViewport");

function fixture(overrides = {}) {
    const calls = [];
    const appState = overrides.appState || null;
    const state = {
        internalChange: false,
        layoutMode: "normal",
        layoutModeBeforeFullscreen: "normal",
        ...overrides.state,
    };
    const viewport = new ContextualViewport(appState || { columns: [] });
    const options = {
        stateFor: () => state,
        getAppState: () => appState,
        viewport,
        indexOfWindow: () => -1,
        relayout: reason => calls.push(["relayout", reason]),
        onManagedOutput: () => false,
        isLayoutMode: mode => mode !== "normal" && mode !== "unsupported",
        applyLayoutGeometry: (...args) => calls.push(["apply", ...args]),
        advanceAdoption: (...args) => calls.push(["adopt", ...args]),
        normalMode: "normal",
        debug: message => calls.push(["debug", message]),
        ...overrides.options,
    };
    return { controller: new FullscreenController(options), viewport, state, calls,
        appState };
}

{
    const wideColumn = { id: 7, persistentWide: true };
    const appState = {
        columns: [wideColumn],
        viewport: { mode: "wide-focus", wideColumnId: 7 },
    };
    const { controller, viewport, state, calls } = fixture({
        appState,
        options: { indexOfWindow: () => 0 },
    });
    controller.onFullscreenChanged(makeWindow(true));
    assert.deepEqual(state.viewportBeforeFullscreen,
        { mode: "wide-focus", wideColumnId: 7 });
    viewport.pair();
    controller.onFullscreenChanged(makeWindow(false));
    assert.deepEqual(appState.viewport,
        { mode: "wide-focus", wideColumnId: 7 });
    assert.equal(wideColumn.persistentWide, true);
    assert.deepEqual(calls.at(-1), ["relayout", "fullscreen-exit"]);
}

{
    const wideColumn = { id: 7, persistentWide: true };
    const appState = { columns: [wideColumn], scrollOffsetX: 0,
        viewport: { mode: "pair", wideColumnId: null } };
    const { controller, viewport } = fixture({ appState,
        options: { indexOfWindow: () => 0 } });
    viewport.select(wideColumn, { source: "directional", changedFocus: true,
        viewportMoved: true, direction: -1 });
    assert.ok(viewport.pendingReveal);
    controller.onFullscreenChanged(makeWindow(true));
    controller.onFullscreenChanged(makeWindow(false));
    assert.equal(viewport.pendingReveal, null);
    assert.equal(appState.viewport.mode, "pair");
}

{
    const wideColumn = { id: 7, persistentWide: true };
    const appState = {
        columns: [wideColumn],
        viewport: { mode: "wide-focus", wideColumnId: 7 },
    };
    const { controller } = fixture({
        appState,
        options: { indexOfWindow: () => 0 },
    });
    controller.onFullscreenChanged(makeWindow(true));
    wideColumn.persistentWide = false;
    controller.onFullscreenChanged(makeWindow(false));
    assert.deepEqual(appState.viewport,
        { mode: "pair", wideColumnId: null },
    "an obsolete Wide preference cannot restore an invalid viewport");
}

function makeWindow(fullScreen) {
    return { caption: "Browser", fullScreen };
}

{
    const window = makeWindow(true);
    const { controller, state, calls } = fixture({
        state: { layoutMode: "left" },
    });
    assert.equal(controller.onFullscreenChanged(window), true);
    assert.equal(state.layoutModeBeforeFullscreen, "left");
    assert.deepEqual(calls, [["debug", "FULLSCREEN enter Browser prior=left"]]);
}

{
    const window = makeWindow(true);
    const { controller, state, calls } = fixture({
        state: { internalChange: true, layoutMode: "maximize" },
    });
    assert.equal(controller.onFullscreenChanged(window), false);
    assert.equal(state.layoutModeBeforeFullscreen, "normal");
    assert.deepEqual(calls, []);
}

{
    const window = makeWindow(false);
    const { controller, state, calls } = fixture({
        state: { layoutModeBeforeFullscreen: "maximize" },
        options: { indexOfWindow: () => 0 },
    });
    assert.equal(controller.onFullscreenChanged(window), true);
    assert.equal(state.layoutModeBeforeFullscreen, "normal");
    assert.deepEqual(calls, [["relayout", "fullscreen-exit"]]);
}

{
    const window = makeWindow(false);
    const { controller, state, calls } = fixture({
        state: { layoutModeBeforeFullscreen: "right" },
        options: { onManagedOutput: () => true },
    });
    controller.onFullscreenChanged(window);
    assert.deepEqual(calls, [[
        "apply", window, state, "right", "fullscreen-exit",
    ]]);
    assert.equal(state.layoutModeBeforeFullscreen, "normal");
}

for (const options of [
    { onManagedOutput: () => false },
    { onManagedOutput: () => true, isLayoutMode: () => false },
]) {
    const window = makeWindow(false);
    const { controller, state, calls } = fixture({
        state: { layoutModeBeforeFullscreen: "normal" },
        options,
    });
    controller.onFullscreenChanged(window);
    assert.deepEqual(calls, [["adopt", window, "fullscreen-exit"]]);
    assert.equal(state.layoutModeBeforeFullscreen, "normal");
}

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);
const handlerSource = mainSource.slice(
    mainSource.indexOf("function onFullScreenChanged"),
    mainSource.indexOf("function onInteractiveMoveResizeStarted")
);
assert.ok(handlerSource.includes(
    "fullscreenController.onFullscreenChanged(window)"
), "the KWin signal handler delegates to FullscreenController");

const source = fs.readFileSync(
    path.join(__dirname, "../src/kwin/lifecycle/FullscreenController.js"),
    "utf8"
);
assert.equal(source.includes("commitDockState"), false);
assert.equal(source.includes("setPresentationMode"), false);
assert.equal(/adoptionPhase\s*=(?!=)/u.test(source), false,
    "FullscreenController delegates Adoption state changes");

console.log("PASS FullscreenController preserves fullscreen lifecycle semantics");
