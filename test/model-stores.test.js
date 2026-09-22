const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ColumnStore } = require("../src/kwin/model/ColumnStore");
const { WindowStateStore } = require("../src/kwin/model/WindowStateStore");

function createColumnStore() {
    const state = {
        columns: [],
        focusedColumnIndex: -1,
        nextColumnId: 1,
    };
    return { state, store: new ColumnStore(state) };
}

const { state, store } = createColumnStore();
const windows = ["A", "B", "C", "D"].map(id => ({ id }));
const [a, b, c, d] = windows.map(window =>
    store.insertWindow(window, state.columns.length, "half")
);

assert.deepEqual(state.columns.map(column => column.window.id), ["A", "B", "C", "D"]);
assert.deepEqual(state.columns.map(column => column.id), [1, 2, 3, 4]);
assert.equal(store.focusWindow(windows[2]), c);
assert.equal(store.focusedIndex(), 2);

const moved = store.moveFocused(-1);
assert.deepEqual(
    { id: moved.column.window.id, from: moved.oldIndex, to: moved.nextIndex },
    { id: "C", from: 2, to: 1 }
);
assert.deepEqual(state.columns.map(column => column.window.id), ["A", "C", "B", "D"]);
assert.equal(store.focusedColumn(), c, "moving preserves focused identity");

const removedUnfocused = store.removeWindow(windows[0]);
assert.equal(removedUnfocused.wasFocused, false);
assert.equal(store.focusedColumn(), c, "removing left of focus preserves focused identity");
assert.equal(store.focusedIndex(), 0);

assert.equal(store.reorder([d, b, c]), true);
assert.deepEqual(state.columns.map(column => column.window.id), ["D", "B", "C"]);
assert.equal(store.focusedColumn(), c, "reorder preserves focused identity");
assert.equal(store.reorder([d, d, c]), false, "duplicate reorder is rejected");

const removedFocused = store.removeWindow(windows[2]);
assert.equal(removedFocused.wasFocused, true);
assert.equal(store.focusedColumn(), b, "removing last focused column falls back left");
store.removeWindow(windows[1]);
store.removeWindow(windows[3]);
assert.equal(store.focusedIndex(), -1);
assert.equal(store.focusedColumn(), null);

let creates = 0;
const windowStates = new WindowStateStore(window => ({ window, sequence: ++creates }));
const firstState = windowStates.ensure(windows[0]);
assert.equal(windowStates.ensure(windows[0]), firstState, "ensure is identity-stable");
assert.equal(creates, 1);
assert.equal(windowStates.has(windows[0]), true);
assert.equal(windowStates.delete(windows[0]), true);
assert.equal(windowStates.has(windows[0]), false);

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);
const applicationSource = mainSource.slice(
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.equal(
    /mainScreenState\.focusedColumnIndex\s*=/.test(applicationSource),
    false,
    "application code must change focus through ColumnStore"
);
assert.equal(
    /mainScreenState\.columns(?:\.splice|\s*=)/.test(applicationSource),
    false,
    "application code must change column membership through ColumnStore"
);

console.log("PASS ColumnStore and WindowStateStore ownership invariants");
