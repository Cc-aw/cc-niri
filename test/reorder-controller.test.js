const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ReorderController } =
    require("../src/kwin/navigation/ReorderController");

function fixture() {
    const calls = [];
    const columns = ["a", "b", "c"].map((id, index) => ({
        id: index + 1,
        window: { internalId: id },
    }));
    const appState = {
        columns,
        focusedColumnIndex: 1,
        scrollOffsetX: 10,
        enabled: true,
        presentation: { windowUuid: "b", mode: "wide" },
    };
    let activeWindow = columns[1].window;
    const controller = new ReorderController({
        getAppState: () => appState,
        normalizeUuid: value => String(value || "").toLowerCase(),
        rejectDockCommand: reason => calls.push(["reject", reason]),
        cancelDockScroll: reason => calls.push(["cancel", reason]),
        getFocusedColumn: () =>
            appState.columns[appState.focusedColumnIndex] || null,
        reorderColumns: reordered => {
            const focused = appState.columns[appState.focusedColumnIndex];
            appState.columns = reordered.slice();
            appState.focusedColumnIndex = appState.columns.indexOf(focused);
            calls.push(["reorder", reordered]);
            return true;
        },
        recomputeLogicalLayout: () => calls.push(["recompute"]),
        ensureColumnVisible: column => {
            appState.scrollOffsetX = 20;
            calls.push(["ensure", column]);
        },
        relayout: (...args) => calls.push(["relayout", ...args]),
        getGeneration: () => 7,
        commitDockState: reason => calls.push(["commit", reason]),
        getActiveWindow: () => activeWindow,
        indexOfWindow: window => appState.columns.findIndex(
            column => column.window === window
        ),
        focusIndex: index => {
            appState.focusedColumnIndex = index;
            calls.push(["focus", index]);
        },
        focusedIndex: () => appState.focusedColumnIndex,
        moveFocusedColumn: delta => {
            const oldIndex = appState.focusedColumnIndex;
            const nextIndex = Math.max(0, Math.min(
                appState.columns.length - 1,
                oldIndex + delta
            ));
            if (nextIndex === oldIndex) return null;
            const column = appState.columns[oldIndex];
            appState.columns[oldIndex] = appState.columns[nextIndex];
            appState.columns[nextIndex] = column;
            appState.focusedColumnIndex = nextIndex;
            calls.push(["move", delta]);
            return { column, oldIndex, nextIndex };
        },
        debug: message => calls.push(["debug", message]),
    });
    return {
        controller,
        appState,
        columns,
        calls,
        setActiveWindow: window => { activeWindow = window; },
    };
}

{
    const { controller, appState, columns, calls } = fixture();
    const command = {
        commandId: "reorder-1",
        order: ["c", "a", "b"],
    };
    assert.equal(controller.applyDockCommand(command), true);
    assert.deepEqual(appState.columns, [columns[2], columns[0], columns[1]]);
    assert.equal(appState.focusedColumnIndex, 2,
        "Dock reorder preserves the focused Column object");
    assert.deepEqual(appState.presentation, { windowUuid: "b", mode: "wide" },
        "reorder preserves presentation state");
    assert.deepEqual(calls.find(call => call[0] === "relayout"), [
        "relayout", "dock-reorder",
        { oldScrollOffsetX: 10, newScrollOffsetX: 20 },
    ]);
    assert.deepEqual(calls.find(call => call[0] === "commit"),
        ["commit", "dock-reorder"]);
    assert.ok(calls.find(call => call[0] === "debug")[1]
        .includes("generation=7 columns=3"));
}

for (const [order, reason] of [
    [null, "invalid-column-order"],
    [["a", "a", "c"], "invalid-column-set"],
    [["a", "b"], "invalid-column-set"],
    [["a", "b", "missing"], "invalid-column-set"],
]) {
    const { controller, calls } = fixture();
    assert.equal(controller.applyDockCommand({ commandId: "bad", order }), false);
    assert.deepEqual(calls, [["reject", reason]]);
}

{
    const { controller, appState, columns, calls } = fixture();
    const [a, b, c] = columns.slice();
    assert.equal(controller.moveFocused(-1), true);
    assert.deepEqual(appState.columns, [b, a, c]);
    assert.equal(appState.focusedColumnIndex, 0);
    assert.deepEqual(calls[0], ["cancel", "move-column-left"]);
    assert.ok(calls.some(call => call[0] === "relayout" &&
        call[1] === "move-column-left"));
    assert.deepEqual(calls.find(call => call[0] === "commit"),
        ["commit", "move-column-left"]);
}

{
    const { controller, appState, columns, calls, setActiveWindow } = fixture();
    const [a, b, c] = columns.slice();
    setActiveWindow(c.window);
    assert.equal(controller.moveFocused(-1), true,
        "active window realigns focus before keyboard reorder");
    assert.deepEqual(appState.columns, [a, c, b]);
    assert.equal(appState.focusedColumnIndex, 1);
    assert.ok(calls.some(call => call[0] === "focus" && call[1] === 2));
}

{
    const { controller, appState, columns, calls, setActiveWindow } = fixture();
    appState.focusedColumnIndex = 0;
    setActiveWindow(columns[0].window);
    assert.equal(controller.moveFocused(-1), false);
    assert.deepEqual(calls[0], ["cancel", "move-column-left"],
        "a boundary move still cancels an in-flight Dock scroll");
    assert.equal(calls.some(call => call[0] === "move" ||
        call[0] === "commit"), false);
}

{
    const { controller, appState, calls } = fixture();
    appState.enabled = false;
    assert.equal(controller.moveFocused(1), false);
    assert.deepEqual(calls, []);
}

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);
const dockWrapper = mainSource.slice(
    mainSource.indexOf("function handleDockReorderCommand"),
    mainSource.indexOf("function applyPendingDockCommand")
);
assert.ok(dockWrapper.includes("reorderController.applyDockCommand(command)"));
const keyboardWrapper = mainSource.slice(
    mainSource.indexOf("function moveFocusedColumn"),
    mainSource.indexOf("function detachColumnToFloating")
);
assert.ok(keyboardWrapper.includes("reorderController.moveFocused(delta)"));

const source = fs.readFileSync(
    path.join(__dirname, "../src/kwin/navigation/ReorderController.js"), "utf8"
);
assert.equal(source.includes("clearPresentation"), false,
    "reorder never clears persistent presentation");

console.log("PASS ReorderController unifies Dock and keyboard reorder semantics");
