const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deriveColumnLayout } = require("../src/kwin/layout/ColumnLayout");
const { GeometryCommitter } = require("../src/kwin/layout/GeometryCommitter");
const { computeLayoutPlan } = require("../src/kwin/layout/LayoutEngine");
const { ParkingManager } = require("../src/kwin/stability/ParkingManager");

const safeRect = { x: 24, y: 50, width: 2512, height: 1320 };
const columns = ["A", "B", "C", "D"].map((id, index) => ({
    id: index + 1,
    window: { id },
    widthMode: "half",
}));
deriveColumnLayout(columns, safeRect.width, 8).forEach((layout, index) => {
    Object.assign(columns[index], layout);
});
const columnSnapshot = JSON.stringify(columns.map(column => ({
    id: column.id,
    logicalX: column.logicalX,
    pixelWidth: column.pixelWidth,
})));

const scrollPlan = computeLayoutPlan({
    reason: "focus-next",
    epoch: 7,
    columns,
    safeRect,
    innerGap: 8,
    parkingBaseX: -5348,
    scrollOffsetX: 1260,
    scrollOffsets: { oldScrollOffsetX: 0, newScrollOffsetX: 1260 },
    presentedColumn: null,
    presentedRect: null,
});

assert.deepEqual(scrollPlan.scrollTransaction, {
    id: 7,
    epoch: 7,
    type: "SCROLL",
    direction: "left",
    oldScrollOffsetX: 0,
    newScrollOffsetX: 1260,
    deltaX: 1260,
    viewport: safeRect,
    continuing: ["B"],
    incoming: ["C"],
    outgoing: ["A"],
});
assert.deepEqual(
    scrollPlan.windows.map(item => [item.column.window.id, item.transitionRole]),
    [["A", "outgoing"], ["B", "continuing"], ["C", "incoming"], ["D", "static"]]
);
assert.deepEqual(
    scrollPlan.commitOrder.map(item => item.column.window.id),
    ["B", "C", "A", "D"],
    "commit order preserves the Effect's observable transaction sequence"
);
assert.deepEqual(scrollPlan.windows[1].rect,
    { x: 24, y: 50, width: 1252, height: 1320 });
assert.deepEqual(scrollPlan.windows[2].rect,
    { x: 1284, y: 50, width: 1252, height: 1320 });
assert.equal(scrollPlan.windows[0].rect.x, -5348);
assert.equal(JSON.stringify(columns.map(column => ({
    id: column.id,
    logicalX: column.logicalX,
    pixelWidth: column.pixelWidth,
}))), columnSnapshot, "LayoutEngine does not mutate its input model");

const wideRect = { x: 375, y: 50, width: 1809, height: 1320 };
const presentationPlan = computeLayoutPlan({
    reason: "enter-wide",
    epoch: 8,
    columns,
    safeRect,
    innerGap: 8,
    parkingBaseX: -5348,
    scrollOffsetX: 1260,
    scrollOffsets: null,
    presentedColumn: columns[2],
    presentedRect: wideRect,
});
assert.equal(presentationPlan.scrollTransaction, null);
assert.deepEqual(
    presentationPlan.windows.map(item => item.placement),
    ["parked", "parked", "visible", "parked"]
);
assert.deepEqual(presentationPlan.windows[2].rect, wideRect);

function mockWindow(id, frameGeometry, events) {
    let geometry = frameGeometry;
    let opacity = 1;
    return {
        id,
        fullScreen: false,
        minimized: false,
        output: { name: "DP-1" },
        get frameGeometry() { return geometry; },
        set frameGeometry(value) { geometry = value; events.push(`${id}:geometry`); },
        get opacity() { return opacity; },
        set opacity(value) { opacity = value; events.push(`${id}:opacity:${value}`); },
    };
}

const events = [];
const incomingWindow = mockWindow("incoming", { x: -5000, y: 50, width: 100, height: 100 }, events);
const outgoingWindow = mockWindow("outgoing", { x: 24, y: 50, width: 100, height: 100 }, events);
const states = new Map([
    [incomingWindow, {
        floating: false, layoutMode: "normal", internalChange: false,
        scrollOriginalOpacity: 1, scrollVisuallyHidden: true,
        scrollParkedByScript: true, scrollParkingMinimized: true,
        scrollLastVisibleGeometry: null,
    }],
    [outgoingWindow, {
        floating: false, layoutMode: "normal", internalChange: false,
        scrollOriginalOpacity: 1, scrollVisuallyHidden: false,
        scrollParkedByScript: false, scrollParkingMinimized: false,
        scrollLastVisibleGeometry: null,
    }],
]);
incomingWindow.minimized = true;
const parking = new ParkingManager({
    stateFor: window => states.get(window),
    getState: window => states.get(window),
    refreshSafeArea: () => {},
    getSafeRect: () => safeRect,
    debug: () => {},
});
const committer = new GeometryCommitter({
    stateFor: window => states.get(window),
    sameRect: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    rectCopy: rect => ({ ...rect }),
    rectText: rect => JSON.stringify(rect),
    isTileMode: () => false,
    isRectInsideAnyOutput: () => true,
    setWindowVisibility: (window, visible) => parking.setVisibility(window, visible),
    isWindowHidden: window => parking.isHidden(window),
    rememberVisibleGeometry: (window, rect) =>
        parking.rememberVisibleGeometry(window, rect),
    debug: () => {},
    warn: () => {},
});
committer.commit({
    reason: "test",
    scrollTransaction: null,
    commitOrder: [
        {
            column: { id: 1, logicalX: 0, window: incomingWindow },
            placement: "visible",
            rect: { x: 24, y: 50, width: 100, height: 100 },
            oldProjectedRect: null,
            newProjectedRect: { x: 24 },
        },
        {
            column: { id: 2, logicalX: 108, window: outgoingWindow },
            placement: "parked",
            rect: { x: -5348, y: 50, width: 100, height: 100 },
            oldProjectedRect: null,
            newProjectedRect: { x: -84 },
        },
    ],
});
assert.ok(events.indexOf("incoming:geometry") < events.indexOf("incoming:opacity:1"),
    "an incoming hidden window receives visible geometry before being shown");
assert.ok(events.indexOf("outgoing:geometry") < events.indexOf("outgoing:opacity:0"),
    "an outgoing window is parked before being hidden");
assert.equal(outgoingWindow.minimized, true);

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);
const applicationSource = mainSource.slice(
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
const relayoutSource = applicationSource.slice(
    applicationSource.indexOf("function relayoutImpl"),
    applicationSource.indexOf("function relayout(reason")
);
assert.ok(relayoutSource.includes("computeLayoutPlan({"));
assert.ok(relayoutSource.includes("geometryCommitter.commit(plan)"));
assert.equal(relayoutSource.includes("frameGeometry ="), false,
    "relayout orchestration cannot write KWin geometry directly");

console.log("PASS pure LayoutPlan and ordered GeometryCommitter behavior");
