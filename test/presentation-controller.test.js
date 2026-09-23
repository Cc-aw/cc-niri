const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PresentationController } =
    require("../src/kwin/presentation/PresentationController");

const modes = { normal: "normal", wide: "wide", maximized: "maximized" };
const primary = { name: "DP-1" };
const secondary = { name: "HDMI-A-1" };

function makeWindow(id, output = primary) {
    return {
        internalId: id,
        output,
        maximizeArgs: null,
        setMaximize(horizontal, vertical) {
            this.maximizeArgs = [horizontal, vertical];
        },
    };
}

function fixture(overrides = {}) {
    const calls = [];
    const suppliedWindow = overrides.window || makeWindow("{ABC}");
    const column = overrides.column || {
        id: 1,
        window: suppliedWindow,
        persistentWide: false,
    };
    const window = column.window;
    const appState = {
        columns: [column],
        targetOutput: primary,
        safeRect: { x: 24, y: 50, width: 2512, height: 1320 },
        scrollOffsetX: 10,
        presentation: { windowUuid: null, mode: modes.normal },
        viewport: { mode: "pair", wideColumnId: null },
        ...overrides.appState,
    };
    const states = new Map([[window, {
        internalChange: false,
        layoutMode: "normal",
        pendingAction: "pending",
        ...overrides.windowState,
    }]]);
    let activeWindow = overrides.activeWindow || null;
    const options = {
        getAppState: () => appState,
        normalizeUuid: value => String(value || "").toLowerCase()
            .replace(/^\{/, "").replace(/\}$/, ""),
        stateFor: target => states.get(target),
        setLayoutMode: (state, mode) => {
            calls.push(["set-layout", state, mode]);
            state.layoutMode = mode;
        },
        modes,
        normalLayoutMode: "normal",
        maximizeLayoutMode: "maximize",
        wideRatio: 0.72,
        rectCopy: rect => ({ ...rect }),
        cancelPendingDockScroll: reason => calls.push(["cancel-dock", reason]),
        focusColumn: target => calls.push(["focus", target]),
        recomputeLogicalLayout: () => calls.push(["recompute"]),
        ensureColumnVisible: target => {
            calls.push(["ensure-visible", target]);
            appState.scrollOffsetX = 20;
        },
        relayout: (...args) => calls.push(["relayout", ...args]),
        getActiveWindow: () => activeWindow,
        setActiveWindow: target => {
            activeWindow = target;
            calls.push(["activate", target]);
        },
        commitDockState: reason => calls.push(["commit", reason]),
        debug: message => calls.push(["debug", message]),
        ...overrides.options,
    };
    return {
        controller: new PresentationController(options),
        appState,
        states,
        window,
        column,
        calls,
        activeWindow: () => activeWindow,
    };
}

{
    const { controller, appState, column } = fixture();
    assert.equal(controller.isMode("normal"), true);
    assert.equal(controller.isMode("wide"), true);
    assert.equal(controller.isMode("maximized"), true);
    assert.equal(controller.isMode("other"), false);
    assert.equal(controller.column(), null);
    appState.presentation = { windowUuid: "abc", mode: "wide" };
    column.persistentWide = true;
    appState.viewport = { mode: "wide-focus", wideColumnId: column.id };
    assert.equal(controller.column(), appState.columns[0]);
    assert.deepEqual(controller.wideRect(), {
        x: 375, y: 50, width: 1809, height: 1320,
    });
    assert.deepEqual(controller.rect(), {
        x: 375, y: 50, width: 1809, height: 1320,
    });
    appState.presentation.mode = "maximized";
    const rect = controller.rect();
    assert.deepEqual(rect, appState.safeRect);
    assert.notEqual(rect, appState.safeRect, "safe-area geometry is copied");
}

{
    const { controller, appState, window, states, calls } = fixture({
        appState: { presentation: { windowUuid: "abc", mode: "maximized" } },
        windowState: { layoutMode: "maximize" },
    });
    controller.clear();
    assert.deepEqual(appState.presentation, { windowUuid: null, mode: "normal" });
    assert.equal(states.get(window).layoutMode, "normal");
    assert.equal(states.get(window).pendingAction, null);
    assert.equal(calls.filter(call => call[0] === "set-layout").length, 1);
}

{
    const { controller, appState, column } = fixture();
    column.persistentWide = true;
    assert.equal(controller.selectPersistent(column), false);
    assert.deepEqual(appState.presentation, { windowUuid: null, mode: "normal" });
    assert.deepEqual(appState.viewport, { mode: "pair", wideColumnId: null });
    assert.equal(controller.selectPersistent(column), false,
        "preference alone does not enter Wide");
    column.persistentWide = false;
    assert.equal(controller.selectPersistent(column), false);
    assert.deepEqual(appState.presentation, { windowUuid: null, mode: "normal" });
}

{
    const { controller, appState, window, column, states, calls, activeWindow } =
        fixture();
    assert.equal(controller.setMode("{ABC}", "wide", "dock-wide"), true);
    assert.equal(column.persistentWide, true);
    assert.deepEqual(appState.presentation, { windowUuid: null, mode: "normal" });
    assert.deepEqual(appState.viewport,
        { mode: "wide-focus", wideColumnId: column.id });
    assert.deepEqual(window.maximizeArgs, [false, false]);
    assert.equal(states.get(window).internalChange, false);
    assert.equal(activeWindow(), window);
    assert.deepEqual(calls.find(call => call[0] === "relayout"), [
        "relayout", "dock-wide", { oldScrollOffsetX: 10, newScrollOffsetX: 20 },
    ]);
    assert.deepEqual(calls.filter(call => call[0].startsWith("cancel")), [
        ["cancel-dock", "dock-wide"],
    ]);
    assert.deepEqual(calls.find(call => call[0] === "commit"),
        ["commit", "dock-wide"]);
}

{
    const { controller, appState, window, states } = fixture({
        column: { window: makeWindow("abc"), persistentWide: true },
    });
    const targetWindow = appState.columns[0].window;
    states.set(targetWindow, {
        internalChange: false,
        layoutMode: "normal",
        pendingAction: "enterMaximize",
    });
    assert.equal(controller.setMode("abc", "maximized", "native-maximize"), true);
    assert.deepEqual(appState.presentation,
        { windowUuid: "abc", mode: "maximized" });
    assert.equal(states.get(targetWindow).layoutMode, "maximize");
    assert.equal(states.get(targetWindow).pendingAction, null);
    assert.equal(states.get(targetWindow).internalChange, false);
    assert.equal(appState.columns[0].persistentWide, true,
        "maximizing does not erase the per-Column Wide preference");
    assert.equal(window, targetWindow);
}

{
    const { controller, appState, column } = fixture({
        column: { window: makeWindow("abc"), persistentWide: true },
    });
    assert.equal(controller.setMode("abc", "normal", "restore"), true);
    assert.equal(column.persistentWide, false);
    assert.deepEqual(appState.presentation, { windowUuid: null, mode: "normal" });
}

for (const [uuid, mode, output] of [
    ["abc", "invalid", primary],
    ["missing", "wide", primary],
    ["abc", "wide", secondary],
]) {
    const window = makeWindow("abc", output);
    const { controller, calls } = fixture({ window });
    assert.equal(controller.setMode(uuid, mode, "rejected"), false);
    assert.deepEqual(calls, []);
}

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);
for (const [name, delegation] of [
    ["isPresentationMode", "presentationController.isMode(mode)"],
    ["presentationColumn", "presentationController.column()"],
    ["wideRect", "presentationController.wideRect()"],
    ["presentationRect", "presentationController.rect()"],
    ["clearPresentationState", "presentationController.clear()"],
    ["selectPersistentPresentation", "presentationController.selectPersistent(column)"],
    ["setPresentationMode", "presentationController.setMode(windowUuid, mode, reason)"],
]) {
    const start = mainSource.indexOf(`function ${name}`);
    const end = mainSource.indexOf("\n}", start);
    assert.ok(mainSource.slice(start, end).includes(delegation),
        `${name} delegates to PresentationController`);
}
const applicationSource = mainSource.slice(
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.equal(
    /mainScreenState\.presentation\.(?:windowUuid|mode)\s*=(?!=)/u
        .test(applicationSource),
    false,
    "PresentationController is the only direct presentation-state writer"
);

console.log("PASS PresentationController owns presentation state and commits");
