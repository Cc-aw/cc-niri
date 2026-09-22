const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WideTransition } =
    require("../src/kwin/presentation/WideTransition");

const phases = {
    scrolling: "scrolling-to-normal-pair",
    awaitingStep: "awaiting-wide-step",
    settled: "settled-normal-pair",
    expanding: "expanding-wide",
    animating: "animating-wide",
};
const targetRect = { x: 375, y: 50, width: 1809, height: 1320 };
const primary = { name: "DP-1" };

function fixture() {
    const calls = [];
    const deferred = [];
    const window = {
        internalId: "{WIDE}",
        output: primary,
        frameGeometry: { x: 1284, y: 50, width: 1252, height: 1320 },
    };
    const neighborWindow = {
        internalId: "neighbor",
        output: primary,
        frameGeometry: { x: 24, y: 50, width: 1252, height: 1320 },
    };
    const column = { window, persistentWide: true, logicalX: 1260, pixelWidth: 1252 };
    const neighbor = {
        window: neighborWindow,
        persistentWide: false,
        logicalX: 0,
        pixelWidth: 1252,
    };
    const appState = {
        columns: [neighbor, column],
        focusedColumnIndex: 1,
        targetOutput: primary,
        scrollOffsetX: 0,
        presentation: { windowUuid: null, mode: "normal" },
    };
    let generation = 7;
    const controller = new WideTransition({
        getAppState: () => appState,
        normalizeUuid: value => String(value || "").toLowerCase()
            .replace(/^\{/, "").replace(/\}$/, ""),
        phases,
        normalPresentationMode: "normal",
        widePresentationMode: "wide",
        timings: { scroll: 220, pairHold: 180, expansion: 240, geometryRetry: 50 },
        maxGeometryAttempts: 20,
        getDockGeneration: () => generation,
        getDockSessionId: () => "session",
        requestDeferred: (command, delay, callback) => {
            deferred.push({ command, delay, callback });
            calls.push(["defer", command.type, delay]);
        },
        relayout: (reason, offsets) => calls.push(["relayout", reason, offsets]),
        commitDockState: reason => calls.push(["commit", reason]),
        presentationRect: () => ({ ...targetRect }),
        sameRectNear: (left, right) =>
            Math.abs(left.x - right.x) <= 1 &&
            Math.abs(left.y - right.y) <= 1 &&
            Math.abs(left.width - right.width) <= 1 &&
            Math.abs(left.height - right.height) <= 1,
        clearPresentation: () => {
            calls.push(["clear-presentation"]);
            appState.presentation = { windowUuid: null, mode: "normal" };
        },
        selectPersistentPresentation: selected => {
            calls.push(["select-persistent", selected]);
            appState.presentation = selected && selected.persistentWide
                ? { windowUuid: "wide", mode: "wide" }
                : { windowUuid: null, mode: "normal" };
        },
        setColumnVisibility: (selected, visible) =>
            calls.push(["visibility", selected, visible]),
        applyColumnGeometry: (selected, rect, reason) =>
            calls.push(["geometry", selected, rect, reason]),
        isFullyVisible: () => true,
        projectedRectForColumn: selected => selected.window.frameGeometry,
        rectText: rect => `${rect.x},${rect.y} ${rect.width}x${rect.height}`,
        debug: message => calls.push(["debug", message]),
        warn: message => calls.push(["warn", message]),
    });
    return {
        controller,
        appState,
        column,
        window,
        calls,
        deferred,
        setGeneration: value => { generation = value; },
    };
}

{
    const { controller, appState, column, calls } = fixture();
    const changed = controller.transitionFocused(column, "focus-next", 0, 1260, 1);
    assert.equal(changed, false);
    assert.equal(controller.pending().phase, phases.awaitingStep);
    assert.equal(controller.pending().entryDirection, 1);
    assert.equal(calls.findIndex(call => call[0] === "relayout"), 1,
        "the normal pair is revealed immediately after clearing presentation");
    assert.equal(controller.beginStepIfPending(
        column, -1, "focus-previous-wide-step"
    ), false, "the opposite direction cannot consume the discrete Wide step");
    assert.equal(controller.beginStepIfPending(
        column, 1, "focus-next-wide-step"
    ), true);
    assert.equal(appState.presentation.mode, "wide");
    assert.equal(controller.pending().phase, phases.expanding);
    assert.ok(calls.some(call => call[0] === "geometry" &&
        call[3] === "focus-next-wide-step-request-wide"));
}

{
    const { controller, appState, column, window, calls, deferred } = fixture();
    controller.transitionFocused(column, "window-activated", 0, 1260);
    assert.equal(controller.pending().phase, phases.scrolling);
    assert.deepEqual(deferred[0].command.type, "settle-wide-transition");
    assert.equal(deferred[0].delay, 220);

    const settleCommand = deferred[0].command;
    assert.equal(controller.settle(settleCommand), true);
    assert.equal(controller.pending().phase, phases.settled);
    assert.equal(deferred[1].command.type, "complete-wide-transition");
    assert.equal(deferred[1].delay, 180);

    assert.equal(controller.complete(deferred[1].command), true);
    assert.equal(appState.presentation.mode, "wide");
    assert.equal(controller.pending().phase, phases.expanding);
    assert.equal(deferred[2].command.type, "check-wide-transition");
    assert.equal(deferred[2].delay, 50);
    assert.equal(calls.some(call => call[0] === "relayout" &&
        call[1].endsWith("park-wide-neighbors")), false,
    "the neighbor remains visible until geometry acknowledgement");

    window.frameGeometry = { ...targetRect };
    assert.equal(controller.onGeometryChanged(window), true);
    assert.equal(controller.pending().phase, phases.animating);
    const parkIndex = calls.findIndex(call => call[0] === "relayout" &&
        call[1].endsWith("park-wide-neighbors"));
    const finalizeRequestIndex = calls.findIndex(call =>
        call[0] === "defer" && call[1] === "finalize-wide-transition");
    assert.ok(parkIndex >= 0 && parkIndex < finalizeRequestIndex,
        "neighbors park before the remaining paint-animation timer starts");
    assert.equal(deferred[3].delay, 240);

    assert.equal(controller.finalizeCommand(deferred[3].command), true);
    assert.equal(controller.pending(), null);
    assert.ok(calls.some(call => call[0] === "commit" &&
        call[1].endsWith("finalize-wide")));
    assert.equal(controller.finalizeCommand(deferred[3].command), false,
        "a completed token cannot run twice");
}

{
    const { controller, column, deferred } = fixture();
    controller.schedule(column, "focus-next", 7);
    const stale = { ...deferred[0].command, transitionToken: "stale" };
    assert.equal(controller.settle(stale), false);
    assert.equal(controller.pending().phase, phases.scrolling);
    assert.equal(controller.matchesWindow("{WIDE}"), true);
    assert.equal(controller.cancel("test"), true);
    assert.equal(controller.pending(), null);
    assert.equal(controller.cancel("test-again"), false);
}

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);
const applicationSource = mainSource.slice(
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.equal(applicationSource.includes("pendingWideTransition"), false,
    "application code does not own Wide pending state");
assert.equal(applicationSource.includes("nextWideTransitionToken"), false,
    "Wide token allocation is encapsulated");
assert.ok(applicationSource.includes("wideTransition.onGeometryChanged(window)"));
assert.ok(applicationSource.includes("wideTransition.beginStepIfPending("));

console.log("PASS WideTransition owns tokens, ACK timing, and discrete navigation");
