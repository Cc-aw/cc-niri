"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { WorkspaceMembership } = require("../src/kwin/workspace/WorkspaceMembership");
const { WindowPolicy } = require("../src/kwin/policy/WindowPolicy");
const { LayoutEligibility } = require("../src/kwin/policy/LayoutEligibility");
const { OutputTopology } = require("../src/kwin/runtime/OutputTopology");
const { loadRuntimeConfig } = require("../src/kwin/runtime/RuntimeConfig");
const { FullscreenController } = require("../src/kwin/lifecycle/FullscreenController");
const { computeSafeRect } = require("../src/kwin/layout/SafeArea");
const { copyRect, formatRect, quickTileRect, rectsEqual, sizesNearlyEqual } =
    require("../src/kwin/layout/Geometry");

const source = fs.readFileSync(path.join(__dirname,
    "../package/contents/code/main.js"), "utf8");
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `production function ${name} exists`);
    const end = source.indexOf("\n}\n", start);
    assert.ok(end > start);
    return source.slice(start, end + 3);
}
function signal() {
    const listeners = [];
    return {
        connect: handler => listeners.push(handler),
        emit: (...args) => listeners.forEach(handler => handler(...args)),
    };
}

function fixture() {
    const a = { id: "primary-A" };
    const b = { id: "secondary-B" };
    const c = { id: "secondary-C" };
    const primary = { name: "DP-1", desktop: a,
        geometry: { x: 0, y: 0, width: 2560, height: 1440 } };
    const secondary = { name: "HDMI-A-1", desktop: b,
        geometry: { x: 2560, y: 0, width: 2560, height: 1440 } };
    const appState = { enabled: true, targetOutput: primary,
        columns: [], viewport: { mode: "pair", wideColumnId: null } };
    const calls = [];
    let primaryReady = true;
    let stopped = false;
    const policy = new WindowPolicy();
    const membership = new WorkspaceMembership({ getCurrentDesktop: output => output.desktop });
    const eligibility = new LayoutEligibility({
        windowPolicy: policy, membership,
        isEnabled: () => appState.enabled && !stopped,
        getPrimaryOutput: () => primary,
        isPrimaryReady: () => primaryReady,
    });
    const topology = new OutputTopology({
        getScreens: () => [primary, secondary],
        config: loadRuntimeConfig((_key, fallback) => fallback),
        computeSafeRect, warn: message => { throw new Error(message); },
    });
    const states = new Map();
    const stateFor = window => {
        if (!states.has(window)) states.set(window, {
            layoutMode: "normal", layoutModeBeforeFullscreen: "normal",
            restoreGeometry: null, restoreOutput: null, pendingAction: null,
            internalChange: false, interactiveMoveResize: false,
            managedByScrollLayout: false, adoptionPhase: "waiting-primary",
        });
        return states.get(window);
    };
    const context = vm.createContext({
        mainScreenState: appState, layoutEligibility: eligibility,
        windowPolicy: policy, states, stateFor,
        NORMAL_MODE: "normal", MAXIMIZE_MODE: "maximize", FULL_MAXIMIZE_MODE: 3,
        PRESENTATION_MAXIMIZED: "maximized",
        ADOPTION_UNTRACKED: "untracked", ADOPTION_MANAGED: "managed",
        ADOPTION_FLOATING: "floating", ADOPTION_POLICY_FLOATING: "policy-floating",
        ADOPTION_IGNORED: "ignored",
        rectCopy: copyRect, rectText: formatRect, sameRect: rectsEqual,
        sameSizeNear: sizesNearlyEqual, rectForLayout: quickTileRect,
        profileForOutput: output => topology.profile(output),
        safeRectFor: output => topology.safeRect(output),
        columnIndexForWindow: window => appState.columns.findIndex(column => column.window === window),
        advanceWindowAdoption: (_window, reason) => calls.push(["adoption", reason]),
        setPresentationMode: (...args) => calls.push(["presentation", ...args]),
        normalizeWindowUuid: value => value,
        presentationController: { restoreFromMaximize: (...args) => calls.push(["restore-presentation", ...args]) },
        contextualWideCoordinator: { onTargetGeometryChanged: () => false },
        adoptionController: { onGeometryChanged: () => {
            throw new Error("secondary geometry must not enter primary Column adoption");
        } },
        workspaceRecycleController: { onDesktopChanged: () => {}, request: () => {} },
        workspaceSwitchController: { onDesktopChanged: () => {} },
        dynamicWorkspaceController: { request: () => {} },
        debug: () => {},
    });
    vm.runInContext([
        "eligible", "onManagedOutput", "isTileMode", "isLayoutMode", "detectQuickTileMode",
        "setLayoutMode", "clearLayoutState", "rememberRestore", "applyLayoutGeometry",
        "leavePseudoMaximize", "onMaximizedAboutToChange", "onMaximizedChanged",
        "onFrameGeometryChanged", "onFullScreenChanged", "setupWindow", "reapplyManagedLayouts",
    ].map(functionSource).join("\n"), context);
    const desktopHandler = source.match(
        /onCurrentDesktopChanged: \(previous, current, output\) => \{([\s\S]*?)\n        \},/u);
    assert.ok(desktopHandler, "production desktop callback exists");
    vm.runInContext(`function desktopChanged(previous, current, output) {${desktopHandler[1]}\n}`, context);
    context.fullscreenController = new FullscreenController({
        stateFor, getAppState: () => appState,
        viewport: { cancelReveal: () => {}, restore: () => {
            throw new Error("secondary fullscreen must not restore the primary viewport");
        } },
        indexOfWindow: context.columnIndexForWindow,
        relayout: () => { throw new Error("secondary fullscreen must not relayout primary Columns"); },
        onManagedOutput: context.onManagedOutput, isLayoutMode: context.isLayoutMode,
        applyLayoutGeometry: context.applyLayoutGeometry,
        advanceAdoption: () => {}, normalMode: "normal", debug: () => {},
    });
    function windowFor(overrides = {}) {
        const normalRect = { x: 2900, y: 200, width: 1100, height: 800 };
        const window = {
            caption: "Secondary", internalId: "secondary-window", output: secondary,
            desktops: [b], managed: true, normalWindow: true, moveable: true,
            resizeable: true, maximizable: true, fullScreen: false,
            maximizeMode: 0, active: true, tile: null,
            frameGeometry: copyRect(normalRect), ...overrides,
        };
        for (const name of ["frameGeometryChanged", "tileChanged", "quickTileModeChanged",
            "maximizedAboutToChange", "maximizedChanged", "outputChanged",
            "fullScreenChanged", "activeChanged", "readyForPaintingChanged",
            "interactiveMoveResizeStarted", "interactiveMoveResizeFinished", "closed"]) {
            window[name] = signal();
        }
        let nativeRestore = copyRect(normalRect);
        window.setMaximize = (horizontal, vertical) => {
            const mode = horizontal && vertical ? 3 : 0;
            if (mode === window.maximizeMode) return;
            window.maximizedAboutToChange.emit(mode);
            if (mode === 3) nativeRestore = copyRect(window.frameGeometry);
            window.maximizeMode = mode;
            window.frameGeometry = copyRect(mode === 3 ? window.output.geometry : nativeRestore);
            window.maximizedChanged.emit();
        };
        context.setupWindow(window);
        return window;
    }
    return { a, b, c, primary, secondary, appState, calls, states, stateFor,
        context, windowFor, safe: topology.safeRect(secondary),
        setPrimaryReady: value => { primaryReady = value; },
        setStopped: value => { stopped = value; } };
}

test("secondary eligibility uses its own desktop and survives primary switching", () => {
    const f = fixture();
    const secondary = f.windowFor();
    const primary = f.windowFor({ output: f.primary, desktops: [f.a] });
    f.setPrimaryReady(false);
    assert.equal(f.context.eligible(secondary), true);
    assert.equal(f.context.eligible(primary), false, "primary still waits for its workspace mount");
    for (const overrides of [{ desktops: [f.a] }, { desktops: [], onAllDesktops: true },
        { desktops: [f.b, f.c] }, { fullScreen: true }, { dialog: true }]) {
        assert.equal(f.context.eligible({ ...secondary, ...overrides }), false);
    }
    f.appState.enabled = false;
    assert.equal(f.context.eligible(secondary), false, "global recovery disables secondary layout");
    f.appState.enabled = true;
    f.setStopped(true);
    assert.equal(f.context.eligible(secondary), false, "stopped runtime does not intercept layout");
});

test("secondary maximize signals apply 24px gaps and toggle back to the original geometry", () => {
    const f = fixture();
    const window = f.windowFor();
    const original = copyRect(window.frameGeometry);
    f.setPrimaryReady(false);
    window.setMaximize(true, true);
    assert.deepEqual(window.frameGeometry, { x: 2584, y: 24, width: 2512, height: 1392 });
    assert.equal(window.maximizeMode, 0, "safe maximize cancels native maximize");
    assert.equal(f.stateFor(window).layoutMode, "maximize");
    assert.deepEqual(f.stateFor(window).restoreGeometry, original);
    window.setMaximize(true, true);
    assert.deepEqual(window.frameGeometry, original);
    assert.equal(f.stateFor(window).layoutMode, "normal");
    assert.equal(f.stateFor(window).restoreGeometry, null);
    assert.equal(f.stateFor(window).internalChange, false);
    assert.deepEqual(f.appState.columns, []);
    assert.equal(f.calls.some(call => call[0].includes("presentation")), false);
});

test("startup adopts a secondary native-maximized window on an independent desktop", () => {
    const f = fixture();
    f.setPrimaryReady(false);
    const window = f.windowFor({ maximizeMode: 3, frameGeometry: copyRect(f.secondary.geometry) });
    assert.deepEqual(window.frameGeometry, f.safe);
    assert.equal(window.maximizeMode, 0);
    assert.equal(f.stateFor(window).layoutMode, "maximize");
    assert.deepEqual(f.appState.columns, []);
});

test("secondary desktop activation adopts native maximize skipped at startup", () => {
    const f = fixture();
    f.setPrimaryReady(false);
    const window = f.windowFor({ desktops: [f.c], maximizeMode: 3,
        frameGeometry: copyRect(f.secondary.geometry) });
    assert.deepEqual(window.frameGeometry, f.secondary.geometry, "inactive desktop stays untouched");
    f.secondary.desktop = f.c;
    f.context.desktopChanged(f.b, f.c, f.secondary);
    assert.deepEqual(window.frameGeometry, f.safe);
    assert.equal(window.maximizeMode, 0);
    assert.equal(f.stateFor(window).layoutMode, "maximize");
    assert.deepEqual(f.appState.columns, []);
});

test("secondary fullscreen exits back to safe maximize and preserves normal restore geometry", () => {
    const f = fixture();
    const window = f.windowFor();
    const original = copyRect(window.frameGeometry);
    window.setMaximize(true, true);
    window.fullScreen = true;
    window.frameGeometry = copyRect(f.secondary.geometry);
    window.fullScreenChanged.emit();
    f.context.reapplyManagedLayouts("fullscreen-output-change");
    assert.deepEqual(window.frameGeometry, f.secondary.geometry, "native fullscreen retains screen bounds");
    f.setPrimaryReady(false);
    window.fullScreen = false;
    window.fullScreenChanged.emit();
    assert.deepEqual(window.frameGeometry, f.safe);
    window.setMaximize(true, true);
    assert.deepEqual(window.frameGeometry, original);
    assert.deepEqual(f.appState.viewport, { mode: "pair", wideColumnId: null });
});

test("secondary native tile geometry reset restores gaps without primary adoption", () => {
    const f = fixture();
    const window = f.windowFor();
    const state = f.stateFor(window);
    state.layoutMode = "left";
    window.tile = {
        relativeGeometry: { x: 0, y: 0, width: 0.5, height: 1 },
        absoluteGeometryInScreen: { x: 2560, y: 0, width: 1280, height: 1440 },
    };
    const old = copyRect(window.frameGeometry);
    window.frameGeometry = copyRect(window.tile.absoluteGeometryInScreen);
    f.setPrimaryReady(false);
    window.frameGeometryChanged.emit(old);
    assert.deepEqual(window.frameGeometry, { x: 2584, y: 24, width: 1252, height: 1392 });
    assert.equal(state.adoptionPhase, "waiting-primary");
    assert.deepEqual(f.appState.columns, []);
});

test("primary Column maximize keeps its presentation authority", () => {
    const f = fixture();
    const window = f.windowFor({ output: f.primary, desktops: [f.a] });
    f.appState.columns.push({ id: 1, window });
    window.setMaximize(true, true);
    assert.deepEqual(f.calls, [["presentation", "secondary-window", "maximized", "native-maximize"]]);
    assert.equal(f.stateFor(window).layoutMode, "normal", "safe layout does not replace Column presentation");
});
