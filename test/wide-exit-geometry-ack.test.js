const assert = require("node:assert/strict");
const { GeometryCommitter } = require("../src/kwin/layout/GeometryCommitter");

const wide = { x: 375, y: 50, width: 1809, height: 1320 };
const pairLeft = { x: 24, y: 50, width: 1252, height: 1320 };
const pairRight = { x: 1284, y: 50, width: 1252, height: 1320 };
const events = [];
const targetWindow = {
    fullScreen: false,
    output: { name: "DP-1" },
    frameGeometry: wide,
};
const incomingWindow = {
    fullScreen: false,
    output: { name: "DP-1" },
    frameGeometry: { x: -5000, y: 50, width: 1252, height: 1320 },
};
const target = { id: 1, logicalX: 0, window: targetWindow };
const incoming = { id: 2, logicalX: 1260, window: incomingWindow };
const states = new Map([[targetWindow, { layoutMode: "normal" }],
    [incomingWindow, { layoutMode: "normal" }]]);
let acknowledgeImmediately = false;
const committer = new GeometryCommitter({
    stateFor: window => states.get(window),
    sameRect: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    sameRectNear: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    rectCopy: rect => ({ ...rect }),
    rectText: rect => JSON.stringify(rect),
    isTileMode: () => false,
    isRectInsideAnyOutput: () => false,
    setWindowVisibility: () => {},
    isWindowHidden: () => false,
    rememberVisibleGeometry: () => {},
    debug: message => events.push(message),
    warn: () => {},
});
Object.defineProperty(targetWindow, "frameGeometry", {
    get() { return wide; },
    set(value) {
        events.push("target-request");
        if (acknowledgeImmediately) wide.x = value.x;
        if (acknowledgeImmediately) wide.width = value.width;
    },
});
Object.defineProperty(incomingWindow, "frameGeometry", {
    get() { return this.actual; },
    set(value) { this.actual = value; events.push("incoming-request"); },
});
incomingWindow.actual = { x: -5000, y: 50, width: 1252, height: 1320 };
const targetItem = {
    column: target, columnId: target.id, placement: "visible", rect: pairLeft,
    newProjectedRect: pairLeft, transitionRole: "static",
};
const incomingItem = {
    column: incoming, columnId: incoming.id, placement: "visible",
    rect: pairRight, newProjectedRect: pairRight, transitionRole: "static",
};
const plan = {
    reason: "wide-to-pair", epoch: 1, scrollTransaction: null,
    wideExitColumn: target, windows: [targetItem, incomingItem],
    commitOrder: [targetItem, incomingItem],
};
assert.deepEqual(committer.commit(plan).heldIncoming, [incoming]);
assert.equal(events.includes("incoming-request"), false,
    "parked neighbor stays parked until target geometry is acknowledged");
acknowledgeImmediately = true;
assert.deepEqual(committer.commit(plan).heldIncoming, []);
assert.equal(events.includes("incoming-request"), true);
console.log("PASS Wide exit gates incoming neighbor on target geometry ACK");
