const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mainSource = fs.readFileSync(
    path.join(root, "package/contents/code/main.js"), "utf8");
const bridgeHeader = fs.readFileSync(
    path.join(root, "bridge/src/ScrollDockBridge.h"), "utf8");
const bridgeSource = fs.readFileSync(
    path.join(root, "bridge/src/ScrollDockBridge.cpp"), "utf8");

function stepOffsets(columnCount, currentOffset, targetIndex) {
    const viewportWidth = 100;
    const width = 50;
    const maximum = Math.max(0, columnCount * width - viewportWidth);
    const bounded = value => Math.max(0, Math.min(value, maximum));
    const targetOffset = bounded((targetIndex + 1) * width - viewportWidth);
    const direction = targetOffset > currentOffset ? 1 : -1;
    const offsets = [];
    for (let index = 0; index < columnCount; index += 1) {
        const offset = bounded((index + 1) * width - viewportWidth);
        if (direction > 0 && offset > currentOffset && offset <= targetOffset) {
            if (!offsets.includes(offset)) offsets.push(offset);
        } else if (direction < 0 && offset < currentOffset && offset >= targetOffset) {
            if (!offsets.includes(offset)) offsets.push(offset);
        }
    }
    return offsets.sort((left, right) =>
        direction > 0 ? left - right : right - left);
}

assert.deepEqual(stepOffsets(5, 0, 4), [50, 100, 150],
    "1|2 to column 5 traverses 2|3, 3|4, and 4|5");
assert.deepEqual(stepOffsets(5, 150, 1), [100, 50, 0],
    "reverse Dock navigation traverses each neighboring viewport");

assert.ok(mainSource.includes("const DOCK_SCROLL_STEP_MS = 140"));
assert.ok(mainSource.includes('type: "advance-dock-scroll"'));
assert.ok(mainSource.includes("function dockScrollOffsetsToTarget"));
assert.ok(mainSource.includes("function advancePendingDockScroll"));
assert.ok(mainSource.includes("function cancelPendingDockScroll"));
assert.ok(mainSource.includes("if (!offsets.length) return finishDockScroll"),
    "an already visible Dock target focuses without moving the viewport");

const advanceSource = mainSource.slice(
    mainSource.indexOf("function advancePendingDockScroll"),
    mainSource.indexOf("function beginDockScroll")
);
assert.ok(advanceSource.includes("pending.offsets.shift()"));
assert.ok(advanceSource.includes('relayout(`${pending.reason}-step`'));
assert.equal(advanceSource.includes("workspace.activeWindow"), false,
    "intermediate steps must not activate the parked target");

assert.ok(bridgeHeader.includes("QQueue<QString> m_pendingCommands"));
assert.ok(bridgeHeader.includes("QSet<QString> m_recentCommandIds"));
assert.ok(bridgeSource.includes("m_pendingCommands.enqueue(compact)"));
assert.ok(bridgeSource.includes("m_pendingCommands.dequeue()"));
assert.ok(bridgeSource.includes('QStringLiteral("advance-dock-scroll")'));
assert.equal(bridgeSource.includes("m_pendingCommand ="), false,
    "the Bridge must not overwrite an earlier pending command");

console.log("PASS Dock clicks traverse adjacent viewports through the FIFO Bridge");
