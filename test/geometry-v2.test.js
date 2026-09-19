const assert = require("node:assert/strict");

function safeRectForGeometry(screen, gap) {
    const xInset = Math.min(gap.left, Math.max(0, screen.width - 1));
    const yInset = Math.min(gap.top, Math.max(0, screen.height - 1));
    return {
        x: screen.x + xInset,
        y: screen.y + yInset,
        width: Math.max(1, screen.width - gap.left - gap.right),
        height: Math.max(1, screen.height - gap.top - gap.bottom),
    };
}

function rectForLayout(mode, safeRect, innerGap) {
    const gap = Math.min(
        Math.max(0, innerGap),
        Math.max(0, Math.min(safeRect.width, safeRect.height) - 2)
    );
    const leftWidth = Math.floor((safeRect.width - gap) / 2);
    const rightWidth = safeRect.width - gap - leftWidth;
    const topHeight = Math.floor((safeRect.height - gap) / 2);
    const bottomHeight = safeRect.height - gap - topHeight;
    const rightX = safeRect.x + leftWidth + gap;
    const bottomY = safeRect.y + topHeight + gap;
    const rects = {
        left: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: safeRect.height },
        right: { x: rightX, y: safeRect.y, width: rightWidth, height: safeRect.height },
        top: { x: safeRect.x, y: safeRect.y, width: safeRect.width, height: topHeight },
        bottom: { x: safeRect.x, y: bottomY, width: safeRect.width, height: bottomHeight },
        topLeft: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: topHeight },
        topRight: { x: rightX, y: safeRect.y, width: rightWidth, height: topHeight },
        bottomLeft: { x: safeRect.x, y: bottomY, width: leftWidth, height: bottomHeight },
        bottomRight: { x: rightX, y: bottomY, width: rightWidth, height: bottomHeight },
    };
    return rects[mode] || null;
}

const safe = safeRectForGeometry(
    { x: 0, y: 0, width: 2560, height: 1440 },
    { top: 50, right: 24, bottom: 70, left: 24 }
);
assert.deepEqual(safe, { x: 24, y: 50, width: 2512, height: 1320 });

const left = rectForLayout("left", safe, 8);
const right = rectForLayout("right", safe, 8);
assert.deepEqual(left, { x: 24, y: 50, width: 1252, height: 1320 });
assert.deepEqual(right, { x: 1284, y: 50, width: 1252, height: 1320 });
assert.equal(right.x - (left.x + left.width), 8);
assert.equal(left.width + 8 + right.width, safe.width);

assert.deepEqual(rectForLayout("top", safe, 8),
    { x: 24, y: 50, width: 2512, height: 656 });
assert.deepEqual(rectForLayout("bottom", safe, 8),
    { x: 24, y: 714, width: 2512, height: 656 });
assert.deepEqual(rectForLayout("topLeft", safe, 8),
    { x: 24, y: 50, width: 1252, height: 656 });
assert.deepEqual(rectForLayout("topRight", safe, 8),
    { x: 1284, y: 50, width: 1252, height: 656 });
assert.deepEqual(rectForLayout("bottomLeft", safe, 8),
    { x: 24, y: 714, width: 1252, height: 656 });
assert.deepEqual(rectForLayout("bottomRight", safe, 8),
    { x: 1284, y: 714, width: 1252, height: 656 });

console.log("PASS V2 safe-area geometry for all eight Quick Tile modes");

const secondarySafe = safeRectForGeometry(
    { x: 2560, y: 0, width: 2560, height: 1440 },
    { top: 24, right: 24, bottom: 24, left: 24 }
);
assert.deepEqual(secondarySafe, { x: 2584, y: 24, width: 2512, height: 1392 });
assert.deepEqual(rectForLayout("left", secondarySafe, 8),
    { x: 2584, y: 24, width: 1252, height: 1392 });
assert.deepEqual(rectForLayout("right", secondarySafe, 8),
    { x: 3844, y: 24, width: 1252, height: 1392 });

console.log("PASS secondary-output 24 px outer gaps and 8 px inner gap");
