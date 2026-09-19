const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const safeRect = { x: 24, y: 50, width: 2512, height: 1320 };
const innerGap = 8;
const parkingMargin = 4096;
const virtualScreen = { x: 0, y: 0, width: 5120, height: 1440 };
const outputs = [
    { x: 0, y: 0, width: 2560, height: 1440 },
    { x: 2560, y: 0, width: 2560, height: 1440 },
];

function widthForMode(mode) {
    if (mode === "third") return Math.floor((safeRect.width - 2 * innerGap) / 3);
    if (mode === "twoThirds") {
        return safeRect.width - innerGap - widthForMode("third");
    }
    return Math.floor((safeRect.width - innerGap) / 2);
}

function recompute(columns) {
    let x = 0;
    columns.forEach(column => {
        column.pixelWidth = widthForMode(column.widthMode);
        column.logicalX = x;
        x += column.pixelWidth + innerGap;
    });
}

function stripWidth(columns) {
    if (!columns.length) return 0;
    const last = columns[columns.length - 1];
    return last.logicalX + last.pixelWidth;
}

function clamp(offset, columns) {
    return Math.max(0, Math.min(offset, Math.max(0, stripWidth(columns) - safeRect.width)));
}

function ensureVisible(offset, column, columns) {
    const viewportRight = offset + safeRect.width;
    if (column.logicalX < offset) offset = column.logicalX;
    else if (column.logicalX + column.pixelWidth > viewportRight) {
        offset = column.logicalX + column.pixelWidth - safeRect.width;
    }
    return clamp(offset, columns);
}

function physicalRect(column, offset) {
    return {
        x: safeRect.x + column.logicalX - offset,
        y: safeRect.y,
        width: column.pixelWidth,
        height: safeRect.height,
    };
}

function fullyVisible(rect) {
    return rect.x >= safeRect.x && rect.y >= safeRect.y &&
        rect.x + rect.width <= safeRect.x + safeRect.width &&
        rect.y + rect.height <= safeRect.y + safeRect.height;
}

function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

function parkingRect(column, parkingIndex, columns) {
    const maxWidth = Math.max(...columns.map(item => item.pixelWidth));
    return {
        x: virtualScreen.x - parkingMargin - maxWidth -
            parkingIndex * (column.pixelWidth + innerGap),
        y: safeRect.y,
        width: column.pixelWidth,
        height: safeRect.height,
    };
}

function placement(column, offset, parkingIndex, columns) {
    const projected = physicalRect(column, offset);
    return fullyVisible(projected)
        ? { kind: "visible", rect: projected }
        : { kind: "parked", rect: parkingRect(column, parkingIndex, columns) };
}

function transitionRank(item) {
    if (item.oldPlacement === "visible" && item.newPlacement === "visible") return 0;
    if (item.oldPlacement === "parked" && item.newPlacement === "visible") return 1;
    if (item.oldPlacement === "visible" && item.newPlacement === "parked") return 2;
    return 3;
}

function applyOrder(items) {
    return items.slice().sort((a, b) => transitionRank(a) - transitionRank(b));
}

function moveFocused(columns, focusedIndex, delta) {
    const nextIndex = Math.max(0, Math.min(
        columns.length - 1,
        focusedIndex + delta
    ));
    if (nextIndex === focusedIndex) return focusedIndex;
    const focused = columns[focusedIndex];
    columns[focusedIndex] = columns[nextIndex];
    columns[nextIndex] = focused;
    return nextIndex;
}

function removeColumnAt(columns, focusedIndex, removalIndex) {
    const focusedColumn = columns[focusedIndex];
    const removedFocusedColumn = focusedIndex === removalIndex;
    columns.splice(removalIndex, 1);
    if (!columns.length) return -1;
    if (removedFocusedColumn) return Math.min(removalIndex, columns.length - 1);
    const preservedIndex = columns.indexOf(focusedColumn);
    return preservedIndex >= 0
        ? preservedIndex
        : Math.min(removalIndex, columns.length - 1);
}

assert.equal(widthForMode("third"), 832);
assert.equal(widthForMode("half"), 1252);
assert.equal(widthForMode("twoThirds"), 1672);

const columns = Array.from({ length: 4 }, () => ({ widthMode: "half" }));
recompute(columns);
assert.deepEqual(columns.map(column => column.logicalX), [0, 1260, 2520, 3780]);
assert.equal(stripWidth(columns), 5032);

let offset = 0;
offset = ensureVisible(offset, columns[0], columns);
assert.equal(offset, 0, "fully visible first column does not scroll");
offset = ensureVisible(offset, columns[1], columns);
assert.equal(offset, 0, "the first two gap-aware half columns fit without scrolling");
offset = ensureVisible(offset, columns[2], columns);
assert.equal(offset, 1260, "the strip scrolls by one complete column plus its gap");
offset = ensureVisible(offset, columns[1], columns);
assert.equal(offset, 1260, "a fully visible focused column causes no extra scrolling");
offset = ensureVisible(offset, columns[0], columns);
assert.equal(offset, 0, "revealing the previous hidden column scrolls one step left");

assert.deepEqual(physicalRect(columns[1], 1260),
    { x: 24, y: 50, width: 1252, height: 1320 });
assert.deepEqual(physicalRect(columns[2], 1260),
    { x: 1284, y: 50, width: 1252, height: 1320 });
assert.equal(clamp(99999, columns), 2520);
assert.equal(clamp(-100, columns), 0);
assert.deepEqual(applyOrder([
    { id: "outgoing", oldPlacement: "visible", newPlacement: "parked" },
    { id: "incoming", oldPlacement: "parked", newPlacement: "visible" },
    { id: "continuing", oldPlacement: "visible", newPlacement: "visible" },
    { id: "parked", oldPlacement: "parked", newPlacement: "parked" },
]).map(item => item.id), ["continuing", "incoming", "outgoing", "parked"],
"scroll transaction publishes its projected delta before parking changes");

const firstAtOffset1260 = placement(columns[0], 1260, 0, columns);
const secondAtOffset1260 = placement(columns[1], 1260, 1, columns);
const thirdAtOffset1260 = placement(columns[2], 1260, 2, columns);
assert.equal(firstAtOffset1260.kind, "parked", "a partial outgoing column is parked");
assert.equal(secondAtOffset1260.kind, "visible", "the left viewport column is visible");
assert.equal(thirdAtOffset1260.kind, "visible", "the right viewport column is visible");
assert.deepEqual(secondAtOffset1260.rect,
    { x: 24, y: 50, width: 1252, height: 1320 });
assert.deepEqual(thirdAtOffset1260.rect,
    { x: 1284, y: 50, width: 1252, height: 1320 });
[firstAtOffset1260].forEach(item => {
    assert.equal(outputs.some(output => intersects(item.rect, output)), false,
        "parking rect must not intersect a physical output");
    assert.ok(item.rect.x + item.rect.width < virtualScreen.x,
        "parking rect stays left of the virtual desktop");
});

columns.splice(1, 1);
recompute(columns);
assert.deepEqual(columns.map(column => column.logicalX), [0, 1260, 2520],
    "logical positions are derived again after removal");

const insertionColumns = ["A", "B", "C"].map(id => ({ id, widthMode: "half" }));
let focusedIndex = 1;
insertionColumns.splice(focusedIndex + 1, 0, { id: "D", widthMode: "half" });
focusedIndex += 1;
recompute(insertionColumns);
assert.deepEqual(insertionColumns.map(column => column.id), ["A", "B", "D", "C"],
    "a new managed window is inserted to the right of the focused column");
assert.equal(insertionColumns[focusedIndex].id, "D",
    "the newly inserted window becomes the focused column");
assert.equal(ensureVisible(0, insertionColumns[focusedIndex], insertionColumns), 1260,
    "the new focused column is minimally revealed");

const focusedId = insertionColumns[focusedIndex].id;
focusedIndex = moveFocused(insertionColumns, focusedIndex, -1);
recompute(insertionColumns);
assert.deepEqual(insertionColumns.map(column => column.id), ["A", "D", "B", "C"],
    "moving left swaps the focused column with its previous neighbor");
assert.equal(insertionColumns[focusedIndex].id, focusedId,
    "moving a column preserves the focused window");
assert.equal(focusedIndex, 1, "the focused index follows the moved column");
focusedIndex = moveFocused(insertionColumns, focusedIndex, 1);
assert.deepEqual(insertionColumns.map(column => column.id), ["A", "B", "D", "C"],
    "moving right swaps the focused column with its next neighbor");
assert.equal(insertionColumns[focusedIndex].id, focusedId,
    "the same window remains focused after moving right");
assert.equal(moveFocused(insertionColumns, 0, -1), 0,
    "moving left at the first column does not wrap");
assert.equal(moveFocused(insertionColumns, insertionColumns.length - 1, 1),
    insertionColumns.length - 1,
    "moving right at the last column does not wrap");

const closeMiddleColumns = ["A", "B", "C", "D"];
const closeMiddleFocusedIndex = removeColumnAt(closeMiddleColumns, 2, 2);
assert.deepEqual(closeMiddleColumns, ["A", "B", "D"]);
assert.equal(closeMiddleColumns[closeMiddleFocusedIndex], "D",
    "closing the focused column prefers its right neighbor");

const closeLastColumns = ["A", "B", "C"];
const closeLastFocusedIndex = removeColumnAt(closeLastColumns, 2, 2);
assert.deepEqual(closeLastColumns, ["A", "B"]);
assert.equal(closeLastColumns[closeLastFocusedIndex], "B",
    "closing the last focused column falls back to its left neighbor");

const closeUnfocusedColumns = ["A", "B", "C", "D"];
const closeUnfocusedIndex = removeColumnAt(closeUnfocusedColumns, 3, 1);
assert.deepEqual(closeUnfocusedColumns, ["A", "C", "D"]);
assert.equal(closeUnfocusedColumns[closeUnfocusedIndex], "D",
    "closing an unfocused column preserves the focused window identity");

console.log("PASS V3 column model, derived positions, clamp, and minimal scrolling");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);
const focusFunction = mainSource.slice(
    mainSource.indexOf("function focusRelativeColumn"),
    mainSource.indexOf("function moveFocusedColumn")
);
assert.ok(focusFunction.indexOf("relayout(") <
    focusFunction.indexOf("workspace.activeWindow = column.window"),
"H/L must commit visible geometry before activating a parked target window");
console.log("PASS V3 H/L activates only after the target geometry is visible");

const setupSource = mainSource.slice(
    mainSource.indexOf("function setupWindow"),
    mainSource.indexOf("function reapplyManagedLayouts")
);
assert.ok(setupSource.includes(
    'retryPendingWindowAdoption(window, "ready-for-painting")'),
"inactive restored windows must retry adoption when ready for painting");
assert.ok(setupSource.includes(
    'retryPendingWindowAdoption(window, "window-shown")'),
"inactive restored windows must retry adoption when shown");
const outputSource = mainSource.slice(
    mainSource.indexOf("function onOutputChanged"),
    mainSource.indexOf("function onFullScreenChanged")
);
assert.ok(outputSource.includes('removeColumn(window, "output-left-primary", false)'),
"a window leaving the primary output must leave the primary Column model");
console.log("PASS V3 session restore adopts inactive windows and removes primary departures");
