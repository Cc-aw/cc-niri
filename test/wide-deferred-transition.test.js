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

assert.ok(mainSource.includes("const WIDE_REVEAL_DELAY_MS = 280"));
assert.ok(mainSource.includes(
    'const WIDE_REVEAL_PHASE_NORMAL_PAIR = "normal-pair"'));
assert.ok(mainSource.includes('type: "complete-wide-transition"'));
assert.ok(mainSource.includes('"RequestDeferredCommand"'));
assert.ok(mainSource.includes("transitionToken: token"));
assert.ok(mainSource.includes("DEFERRED_WIDE_COMPLETE"));
assert.ok(mainSource.includes("revealWindowUuids"),
    "the deferred transition records the real normal pair before Wide");
assert.ok(mainSource.includes("deferredWideMatches ||"),
    "activation must not restart a transition already waiting for its wide commit");

const transitionSource = mainSource.slice(
    mainSource.indexOf("function relayoutFocusedColumnTransition"),
    mainSource.indexOf("function setPresentationMode"));
const revealIndex = transitionSource.indexOf("`${reason}-reveal-wide`");
const scheduleIndex = transitionSource.indexOf("schedulePersistentWideTransition(");
assert.ok(revealIndex >= 0 && scheduleIndex > revealIndex,
    "the normal slot must be committed before scheduling the 72% geometry");
assert.equal(transitionSource.includes("`${reason}-enter-wide`"), false,
    "the 72% geometry must not be committed synchronously in the reveal path");

assert.ok(bridgeHeader.includes(
    "bool RequestDeferredCommand(const QString &json, int delayMs);"));
assert.ok(bridgeSource.includes("QTimer::singleShot(boundedDelayMs"));
assert.ok(bridgeSource.includes("m_generation != generation"));
assert.ok(bridgeSource.includes('QStringLiteral("complete-wide-transition")'));

function fullyVisibleColumns(columns, viewportLeft, viewportWidth) {
    const viewportRight = viewportLeft + viewportWidth;
    return columns.filter(column => column.x >= viewportLeft &&
        column.x + column.width <= viewportRight).map(column => column.id);
}

const columns = [
    { id: "1@50", x: 0, width: 50 },
    { id: "2@50", x: 50, width: 50 },
    { id: "3@50", x: 100, width: 50 },
];
assert.deepEqual(fullyVisibleColumns(columns, 0, 100), ["1@50", "2@50"]);
assert.deepEqual(fullyVisibleColumns(columns, 50, 100), ["2@50", "3@50"],
    "minimal scrolling must expose the destination normal pair before Wide");

function mayComplete(pending, command, focusedUuid, generation) {
    return Boolean(pending && pending.token === command.token &&
        pending.windowUuid === focusedUuid && command.generation === generation);
}

const first = { token: "1", windowUuid: "wide" };
const second = { token: "2", windowUuid: "wide" };
assert.equal(mayComplete(second, { token: "1", generation: 7 }, "wide", 7), false,
    "a superseded timer cannot expand the window");
assert.equal(mayComplete(second, { token: "2", generation: 7 }, "other", 7), false,
    "a focus change cancels the deferred expansion");
assert.equal(mayComplete(first, { token: "1", generation: 7 }, "wide", 8), false,
    "a state-generation change cancels stale geometry");
assert.equal(mayComplete(second, { token: "2", generation: 7 }, "wide", 7), true);

console.log("PASS persistent Wide waits for a rendered scrolling phase");
