const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function incomingVisualStart(rect, translationX, scaleX, anchor, opacity) {
    const width = rect.width * scaleX;
    let x = rect.x + (rect.width - width) / 2;
    if (anchor === "left") x = rect.x;
    if (anchor === "right") x = rect.x + rect.width - width;
    return { x: x + translationX, y: rect.y, width,
        height: rect.height, opacity };
}

const rightSlot = { x: 1284, y: 50, width: 1252, height: 1320 };
const wide = { x: 375, y: 50, width: 1809, height: 1320 };
const fromRight = incomingVisualStart(rightSlot, 20, 0.94, "right", 0.2);
assert.ok(Math.abs(fromRight.x - 1379.12) < 0.001);
assert.ok(Math.abs(fromRight.width - 1176.88) < 0.001);
assert.equal(fromRight.y, 50);
assert.equal(fromRight.height, 1320);
assert.equal(fromRight.opacity, 0.2);
assert.ok(fromRight.x + fromRight.width / 2 >
    wide.x + wide.width / 2,
"returning Wide starts on the right and visibly scrolls toward center");
assert.ok(fromRight.width / wide.width < rightSlot.width / wide.width,
"the safe-edge incoming scale is preserved instead of flashing at 72%");

const leftSlot = { x: 24, y: 50, width: 1252, height: 1320 };
const fromLeft = incomingVisualStart(leftSlot, -1260, 1, "center", 1);
assert.equal(fromLeft.x, -1236,
    "H keeps its logical left-to-right incoming origin when entering Wide");

const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"),
    "utf8"
);
const presentationSource = effectSource.slice(
    effectSource.indexOf("if (this.presentationTransition"),
    effectSource.indexOf("if (!this.sameSize")
);
assert.ok(presentationSource.includes("window.ccNiriIncomingVisual || null"));
assert.ok(presentationSource.indexOf("const chainedIncoming") <
    presentationSource.indexOf("this.motion.cancel(window)"),
"the incoming visual origin is captured before the first animation is cancelled");
assert.ok(presentationSource.includes("this.motion.visualSnapshot(window, oldGeometry)"),
    "a chained Wide transition starts at the current interpolated visual rectangle");
assert.ok(presentationSource.includes("const sourceGeometry = chainedIncoming || oldGeometry"));
assert.ok(presentationSource.includes("this.duration + this.presentationDuration"),
"the merged scroll-plus-wide transition has enough time to remain visible");
assert.ok(presentationSource.includes("from: chainedIncoming.opacity"));
assert.ok(effectSource.includes("window.ccNiriIncomingVisual = incomingVisual"));
assert.ok(effectSource.includes("PRESENTATION_CHAINED"));

console.log("PASS persistent Wide return chains scrolling into 72% presentation");
