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

assert.ok(mainSource.includes("const WIDE_SCROLL_PHASE_MS = 220"));
assert.ok(mainSource.includes("const WIDE_PAIR_HOLD_MS = 180"));
assert.ok(mainSource.includes("const WIDE_EXPANSION_PHASE_MS = 240"));
assert.ok(mainSource.includes("const WIDE_GEOMETRY_RETRY_MS = 50"));
assert.ok(mainSource.includes("const WIDE_GEOMETRY_MAX_ATTEMPTS = 20"));
assert.ok(mainSource.includes(
    'const WIDE_REVEAL_PHASE_SCROLLING = "scrolling-to-normal-pair"'));
assert.ok(mainSource.includes(
    'const WIDE_REVEAL_PHASE_AWAITING_STEP = "awaiting-wide-step"'));
assert.ok(mainSource.includes(
    'const WIDE_REVEAL_PHASE_SETTLED = "settled-normal-pair"'));
assert.ok(mainSource.includes(
    'const WIDE_REVEAL_PHASE_EXPANDING = "expanding-wide"'));
assert.ok(mainSource.includes(
    'const WIDE_REVEAL_PHASE_ANIMATING = "animating-wide"'));
assert.ok(mainSource.includes('"settle-wide-transition"'));
assert.ok(mainSource.includes('"complete-wide-transition"'));
assert.ok(mainSource.includes('"RequestDeferredCommand"'));
assert.ok(mainSource.includes("transitionToken: pending.token"));
assert.ok(mainSource.includes("DEFERRED_WIDE_COMPLETE"));
assert.ok(mainSource.includes("DEFERRED_PAIR_SETTLED"));
assert.ok(mainSource.includes("DEFERRED_WIDE_ACK"));
assert.ok(mainSource.includes("DEFERRED_WIDE_REUSE"),
    "activation must reuse the pending target instead of restarting its stages");
assert.ok(mainSource.includes("function armPersistentWideStep"));
assert.ok(mainSource.includes("WIDE_STEP_ARM"));
assert.ok(mainSource.includes("WIDE_STEP index="));
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
assert.ok(bridgeSource.includes('QStringLiteral("settle-wide-transition")'));
assert.ok(bridgeSource.includes('QStringLiteral("check-wide-transition")'));
assert.ok(bridgeSource.includes('QStringLiteral("finalize-wide-transition")'));
assert.ok(bridgeSource.includes('QStringLiteral("complete-wide-transition")'));

const settleFunction = mainSource.slice(
    mainSource.indexOf("function settlePendingWideTransition"),
    mainSource.indexOf("function schedulePersistentWideTransition"));
assert.ok(settleFunction.includes('relayout(`${pending.reason}-settle-pair`'));
assert.ok(settleFunction.indexOf("WIDE_REVEAL_PHASE_SETTLED") <
    settleFunction.indexOf('"complete-wide-transition"'),
"the destination pair is reasserted and marked settled before Wide is requested");

const expansionSource = mainSource.slice(
    mainSource.indexOf("function beginPendingWideExpansion"),
    mainSource.indexOf("function requestDeferredWideStage"));
assert.ok(expansionSource.includes("applyColumnGeometry(column, target"));
assert.ok(expansionSource.includes("acknowledgePendingWideGeometry(column)"));
assert.equal(expansionSource.includes("relayout(`${pending.reason}-enter-wide`"), false,
    "the neighbor must not be parked before the Wayland client accepts 72%");
assert.ok(mainSource.indexOf("function acknowledgePendingWideGeometry") <
    mainSource.indexOf("function completePendingWideTransition"));
assert.ok(mainSource.includes("WIDE_EXPANSION_PHASE_MS"),
    "the neighbor remains present for the full Wide paint animation");
assert.ok(mainSource.includes("function checkPendingWideGeometry"));
assert.ok(mainSource.includes("WIDE_GEOMETRY_TIMEOUT"));
assert.ok(mainSource.includes("pending.deferredSequence++"),
    "each retry must have a unique Bridge command id");
assert.ok(mainSource.includes("function sameRectNear"));
assert.ok(mainSource.includes(
    "sameRectNear(column.window.frameGeometry, presentationRect())"),
"fractional Wayland geometry must count as a Wide acknowledgement");

const focusFunction = mainSource.slice(
    mainSource.indexOf("function focusRelativeColumn"),
    mainSource.indexOf("function toggleFocusWide"));
assert.ok(focusFunction.indexOf("WIDE_REVEAL_PHASE_AWAITING_STEP") <
    focusFunction.indexOf("const nextIndex"),
"the second same-direction key press expands Wide before moving another column");
assert.ok(focusFunction.includes("pendingWideTransition.entryDirection === delta"));
assert.ok(focusFunction.includes("newScrollOffsetX,\n        delta"),
"the first H/L press arms Wide but must stop at the normal destination pair");

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
