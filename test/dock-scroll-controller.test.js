const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DockScrollController } =
    require("../src/kwin/navigation/DockScrollController");

function fixture() {
    const calls = [];
    const deferred = [];
    const primary = { name: "DP-1" };
    const columns = Array.from({ length: 5 }, (_, index) => ({
        window: {
            internalId: `window-${index}`,
            output: primary,
            caption: `Window ${index}`,
            minimized: index === 4,
        },
        pixelWidth: 50,
        logicalX: index * 50,
    }));
    const appState = {
        columns,
        focusedColumnIndex: 0,
        targetOutput: primary,
        safeRect: { x: 0, y: 0, width: 100, height: 100 },
        scrollOffsetX: 0,
        presentation: { windowUuid: null, mode: "normal" },
    };
    let activeWindow = columns[0].window;
    const controller = new DockScrollController({
        getAppState: () => appState,
        normalizeUuid: value => String(value || "").toLowerCase(),
        recomputeLogicalLayout: () => {
            columns.forEach((column, index) => {
                column.pixelWidth = 50;
                column.logicalX = index * 50;
            });
        },
        clampScrollOffset: () => {
            appState.scrollOffsetX = Math.max(0, Math.min(
                appState.scrollOffsetX,
                columns.length * 50 - appState.safeRect.width
            ));
        },
        stripWidth: () => columns.length * 50,
        isFullyVisible: rect => rect.x >= 0 && rect.x + rect.width <= 100,
        projectedRectForColumn: column => ({
            x: column.logicalX - appState.scrollOffsetX,
            y: 0,
            width: column.pixelWidth,
            height: 100,
        }),
        requestDeferred: (command, delay, callback) => {
            deferred.push({ command, delay, callback });
            calls.push(["defer", command.transitionToken, delay]);
        },
        getSessionId: () => "session",
        stepMs: 140,
        clearPresentation: () => {
            calls.push(["clear-presentation"]);
            appState.presentation = { windowUuid: null, mode: "normal" };
        },
        normalPresentationMode: "normal",
        commitDockState: reason => calls.push(["commit", reason]),
        publishDockState: reason => calls.push(["publish", reason]),
        focusIndex: index => {
            appState.focusedColumnIndex = index;
            calls.push(["focus", index]);
        },
        transitionFocused: (column, reason, oldOffset, newOffset) => {
            calls.push(["transition", column, reason, oldOffset, newOffset]);
            return false;
        },
        setActiveWindow: window => {
            activeWindow = window;
            calls.push(["activate", window]);
        },
        relayout: (reason, offsets) => calls.push(["relayout", reason, offsets]),
        debug: message => calls.push(["debug", message]),
    });
    return {
        controller,
        appState,
        columns,
        calls,
        deferred,
        activeWindow: () => activeWindow,
    };
}

{
    const { controller, columns } = fixture();
    assert.deepEqual(controller.offsetsToTarget(columns[4]), [50, 100, 150]);
    assert.deepEqual(controller.offsetsToTarget(columns[1]), [],
        "a visible target needs no viewport movement");
}

{
    const { controller, appState, columns, calls, deferred, activeWindow } = fixture();
    assert.equal(controller.begin(columns[4], "dock-focus-right"), true);
    assert.equal(appState.scrollOffsetX, 50);
    assert.deepEqual(controller.pending().offsets, [100, 150]);
    assert.equal(deferred[0].delay, 140);
    assert.equal(activeWindow(), columns[0].window,
        "the parked target is not activated during an intermediate step");

    assert.equal(controller.advance(deferred[0].command), true);
    assert.equal(appState.scrollOffsetX, 100);
    assert.equal(activeWindow(), columns[0].window);
    assert.equal(controller.advance(deferred[1].command), true);
    assert.equal(appState.scrollOffsetX, 150);
    assert.equal(controller.pending(), null);
    assert.equal(appState.focusedColumnIndex, 4);
    assert.equal(columns[4].window.minimized, false);
    assert.equal(activeWindow(), columns[4].window);

    const transitionIndex = calls.findIndex(call => call[0] === "transition");
    const activationIndex = calls.findIndex(call => call[0] === "activate");
    assert.ok(transitionIndex >= 0 && transitionIndex < activationIndex,
        "final visible geometry is committed before activation");
    assert.deepEqual(calls.filter(call => call[0] === "relayout")
        .map(call => call[1]), [
        "dock-focus-right-step",
        "dock-focus-right-step",
        "dock-focus-right-step",
    ]);
    assert.ok(calls.some(call => call[0] === "publish" &&
        call[1] === "dock-focus-right"));
}

{
    const { controller, appState, columns, calls } = fixture();
    appState.presentation = { windowUuid: "window-0", mode: "wide" };
    controller.begin(columns[4], "dock-focus-right");
    const clearIndex = calls.findIndex(call => call[0] === "clear-presentation");
    const commitIndex = calls.findIndex(call => call[0] === "commit" &&
        call[1] === "dock-focus-right-clear-presentation");
    const firstStepIndex = calls.findIndex(call => call[0] === "relayout");
    assert.ok(clearIndex >= 0 && clearIndex < commitIndex &&
        commitIndex < firstStepIndex);
}

{
    const { controller, columns, calls, activeWindow } = fixture();
    assert.equal(controller.begin(columns[1], "dock-visible"), true);
    assert.equal(controller.pending(), null);
    assert.equal(activeWindow(), columns[1].window);
    assert.equal(calls.some(call => call[0] === "relayout" &&
        call[1].endsWith("-step")), false);
}

{
    const { controller, columns } = fixture();
    controller.begin(columns[4], "dock-focus-right");
    assert.equal(controller.advance({
        transitionToken: "stale",
        windowUuid: "window-4",
    }), false);
    assert.equal(controller.hasPending(), true);
    assert.equal(controller.cancel("test"), true);
    assert.equal(controller.hasPending(), false);
    assert.equal(controller.cancel("again"), false);
}

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);
const applicationSource = mainSource.slice(
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.equal(applicationSource.includes("pendingDockScroll"), false);
assert.equal(applicationSource.includes("nextDockScrollToken"), false);
assert.ok(applicationSource.includes("dockScrollController.hasPending()"));
assert.ok(applicationSource.includes(
    "return dockScrollController.advance(command)"
));

console.log("PASS DockScrollController owns stepwise scrolling and activation order");
