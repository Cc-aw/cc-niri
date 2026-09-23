const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    boundScrollOffset,
    computeColumnWidth,
    computeStripWidth,
    deriveColumnLayout,
    scrollOffsetToRevealColumn,
} = require("../src/kwin/layout/ColumnLayout");
const { rectanglesIntersect } = require("../src/kwin/layout/Geometry");
const { projectColumnRect, isRectFullyVisible } =
    require("../src/kwin/layout/Projection");
const { computeParkingBaseX, computeParkingRect } =
    require("../src/kwin/layout/Parking");

const safeRect = { x: 24, y: 50, width: 2512, height: 1320 };
const innerGap = 8;
const parkingMargin = 4096;
const virtualScreen = { x: 0, y: 0, width: 5120, height: 1440 };
const outputs = [
    { x: 0, y: 0, width: 2560, height: 1440 },
    { x: 2560, y: 0, width: 2560, height: 1440 },
];

function widthForMode(mode) {
    return computeColumnWidth(mode, safeRect.width, innerGap);
}

function recompute(columns) {
    const layout = deriveColumnLayout(columns, safeRect.width, innerGap);
    columns.forEach((column, index) => {
        Object.assign(column, layout[index]);
    });
}

function stripWidth(columns) {
    return computeStripWidth(columns);
}

function clamp(offset, columns) {
    return boundScrollOffset(offset, stripWidth(columns), safeRect.width);
}

function ensureVisible(offset, column, columns) {
    return scrollOffsetToRevealColumn(
        offset, column, stripWidth(columns), safeRect.width
    );
}

function physicalRect(column, offset) {
    return projectColumnRect(column, safeRect, offset);
}

function fullyVisible(rect) {
    return isRectFullyVisible(rect, safeRect);
}

function intersects(a, b) {
    return rectanglesIntersect(a, b);
}

function parkingRect(column, parkingIndex, columns) {
    return computeParkingRect(column, parkingIndex, {
        baseX: computeParkingBaseX(columns, virtualScreen.x, parkingMargin),
        innerGap,
        safeRect,
    });
}

function placement(column, offset, parkingIndex, columns) {
    const projected = physicalRect(column, offset);
    return fullyVisible(projected)
        ? { kind: "visible", rect: projected }
        : { kind: "parked", rect: parkingRect(column, parkingIndex, columns) };
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

function offsetAfterClosingVisibleLeft(oldOffset, removedWidth, gap, removalIndex) {
    if (removalIndex <= 0) return 0;
    return Math.max(0, oldOffset - removedWidth - gap);
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
assert.equal(offsetAfterClosingVisibleLeft(1260, 1252, 8, 1), 0,
    "closing a visible left column reveals its predecessor without moving the right slot");
assert.equal(offsetAfterClosingVisibleLeft(0, 1252, 8, 0), 0,
    "closing the logical first column cannot scroll into negative space");

console.log("PASS V3 column model, derived positions, clamp, and minimal scrolling");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);
assert.ok(mainSource.includes("function isPlasmaShellWindow(window)"),
    "Plasma Shell windows have an explicit eligibility guard");
for (const identity of ["plasmashell", "org.kde.plasmashell", "org.kde.plasma.desktop"]) {
    assert.ok(mainSource.includes(`\"${identity}\"`),
        `Plasma edit-mode identity ${identity} is excluded`);
}
const scrollEligibilitySource = mainSource.slice(
    mainSource.indexOf("function scrollEligible"),
    mainSource.indexOf("function refreshMainScreenState")
);
assert.ok(scrollEligibilitySource.includes("!isPlasmaShellWindow(window)"),
    "Plasma edit-mode windows cannot enter the scrolling Column model");
assert.ok(scrollEligibilitySource.includes("!window.skipTaskbar"),
    "taskbar-hidden helper windows cannot enter the scrolling Column model");
const layoutEligibilitySource = mainSource.slice(
    mainSource.indexOf("function eligible(window)"),
    mainSource.indexOf("function layoutForMode")
);
assert.ok(layoutEligibilitySource.includes("window.skipTaskbar"),
    "taskbar-hidden helper windows cannot enter managed maximize/tile layouts");
const setupWindowSource = mainSource.slice(
    mainSource.indexOf("function setupWindow(window)"),
    mainSource.indexOf("function reapplyManagedLayouts")
);
assert.ok(setupWindowSource.includes("window.skipTaskbarChanged.connect"),
    "a managed column is removed when it becomes taskbar-hidden");
const dockFocusSource = mainSource.slice(
    mainSource.indexOf("function handleDockFocusCommand"),
    mainSource.indexOf("function handleDockReorderCommand")
);
assert.ok(dockFocusSource.includes('beginDockScroll(column, "dock-focus-right")'),
    "Dock clicks enter the guarded stepwise scroll planner");
const dockScrollControllerSource = mainSource.slice(
    mainSource.indexOf("class DockScrollController"),
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
const finishDockSource = dockScrollControllerSource.slice(
    dockScrollControllerSource.indexOf("    finish(pending, column)"),
    dockScrollControllerSource.indexOf("    advance(command)")
);
assert.ok(finishDockSource.indexOf("this.transitionFocused(") <
    finishDockSource.indexOf("this.setActiveWindow(column.window)"),
    "Dock scrolling commits the final geometry before activating its target");
const removalSource = mainSource.slice(
    mainSource.indexOf("function removeColumn"),
    mainSource.indexOf("function initializeScrollLayout")
);
assert.ok(removalSource.includes("removedWasVisibleLeft && index > 0"),
    "closing the left slot uses a stable-viewport removal path");
assert.ok(removalSource.includes(
    "oldScrollOffsetX -\n            removedColumn.pixelWidth - mainScreenState.innerGap"
), "the viewport retreats exactly one removed column plus its gap");
const focusFunction = mainSource.slice(
    mainSource.indexOf("function focusRelativeColumn"),
    mainSource.indexOf("function moveFocusedColumn")
);
assert.ok(focusFunction.indexOf("relayoutFocusedColumnTransition(") <
    focusFunction.indexOf("activateColumnWhenReady(column.window)"),
"H/L must request geometry before activating a parked target window");
assert.ok(mainSource.includes("motionPlanCommitGate.deferActivation(window)"),
"Wide activation waits for the motion-plan handoff and geometry commit");
console.log("PASS V3 H/L activates only after the target geometry is visible");

const setupSource = mainSource.slice(
    mainSource.indexOf("function setupWindow"),
    mainSource.indexOf("function reapplyManagedLayouts")
);
assert.ok(setupSource.includes(
    "adoptionController.onReady(window)"),
"new windows re-evaluate eligibility when ready for painting");
assert.ok(setupSource.includes(
    'adoptionController.onReady(window, "window-shown")'),
"new windows re-evaluate eligibility when shown");
assert.ok(mainSource.includes("ADOPTION_WAITING_ACTIVATION"),
    "runtime windows wait for activation instead of being parked as restores");
assert.ok(!mainSource.includes("STARTUP_RESTORE_GRACE_MS"),
    "window adoption does not depend on a startup timing heuristic");
const outputSource = mainSource.slice(
    mainSource.indexOf("function onOutputChanged"),
    mainSource.indexOf("function onFullScreenChanged")
);
assert.ok(outputSource.includes("outputController.onOutputChanged(window)"),
"output changes are delegated to the lifecycle controller");
const outputControllerSource = mainSource.slice(
    mainSource.indexOf("class OutputController"),
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.ok(outputControllerSource.includes(
    'this.removeColumn(window, "output-left-primary", false)'
), "a window leaving the primary output must leave the primary Column model");
assert.ok(mainSource.includes("class GeometryCommitter"),
    "managed geometry and visibility have an explicit committer");
const visibilitySource = mainSource.slice(
    mainSource.indexOf("class ParkingManager"),
    mainSource.indexOf("class Recovery")
);
assert.ok(visibilitySource.includes("window.minimized = true"),
    "parked windows have no invisible input surface behind the left slot");
assert.ok(visibilitySource.includes("state.scrollParkingMinimized"),
    "only minimization owned by the layout is reversed");
assert.ok(mainSource.includes(
    'this.isWindowHidden(column.window)'
), "a returning window is positioned before it is shown");
console.log("PASS V3 deterministic runtime adoption and primary-output departures");
