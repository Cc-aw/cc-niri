const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    sameSize,
    isColumnSize,
    visibleSlot,
    isFocusWide,
    presentationTransition,
    parked,
    incomingVisualStart,
} = require("../src/effect/MotionClassifier.js");

const screen = { x: 0, y: 0, width: 2560, height: 1440 };
const left = { x: 24, y: 50, width: 1252, height: 1320 };
const right = { x: 1284, y: 50, width: 1252, height: 1320 };
const wide = { x: 358, y: 50, width: 1844, height: 1320 };
const offscreen = { x: -2000, y: 50, width: 1252, height: 1320 };

assert.equal(sameSize(left, right), true);
assert.equal(isColumnSize(left, screen), true);
assert.equal(visibleSlot(left, screen), "left");
assert.equal(visibleSlot(right, screen), "right");
assert.equal(visibleSlot(offscreen, screen), null);
assert.equal(isFocusWide(wide, screen), true);
assert.equal(presentationTransition(left, wide, screen), true);
assert.equal(presentationTransition(
    left,
    { ...wide, y: 30, height: 1360 },
    screen
), false, "adoption height changes are not Presentation transitions");
assert.equal(parked(offscreen, screen), true);
const incoming = incomingVisualStart(right, 20, 0.94, "right", 0.2);
assert.ok(Math.abs(incoming.x - 1379.12) < 0.001);
assert.ok(Math.abs(incoming.width - 1176.88) < 0.001);
assert.equal(incoming.y, 50);
assert.equal(incoming.height, 1320);
assert.equal(incoming.opacity, 0.2);

const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"),
    "utf8"
);
assert.match(effectSource, /Generated from src\/effect\/MotionClassifier\.js/);
assert.equal((effectSource.match(/function presentationTransition\(/g) || []).length, 1);

console.log("PASS MotionClassifier owns Effect geometry classification");
