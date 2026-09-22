const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LayoutTransaction } =
    require("../src/kwin/stability/LayoutTransaction");
const { InvariantChecker } =
    require("../src/kwin/stability/InvariantChecker");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);

assert.ok(mainSource.includes("const layoutTransaction = new LayoutTransaction"));
assert.ok(mainSource.includes("function beginLayoutTransaction(reason)"));
assert.ok(mainSource.includes("function endLayoutTransaction(reason, epoch)"));
assert.ok(mainSource.includes("function validateLayoutInvariants(reason, epoch)"));

const relayoutSource = mainSource.slice(
    mainSource.indexOf("function relayout(reason, scrollOffsets)"),
    mainSource.indexOf("function columnIndexForWindow")
);
assert.ok(relayoutSource.includes("try {"));
assert.ok(relayoutSource.includes("finally {"));
assert.ok(relayoutSource.includes("endLayoutTransaction(reason, epoch)"),
    "every relayout path closes its transaction even after an exception");

const invariantSource = mainSource.slice(
    mainSource.indexOf("class InvariantChecker"),
    mainSource.indexOf("class ParkingManager")
);
for (const invariant of [
    "duplicate-window",
    "duplicate-uuid",
    "logical-x",
    "invalid-width",
    "state-ownership",
    "wrong-output",
    "focus-index",
    "scroll-offset",
    "missing-presentation",
    "presentation-focus",
]) {
    assert.ok(invariantSource.includes(invariant), `missing invariant ${invariant}`);
}

const activationSource = mainSource.slice(
    mainSource.indexOf("function onWindowActivatedForScrollLayout"),
    mainSource.indexOf("function focusRelativeColumn")
);
assert.ok(activationSource.includes("layoutTransaction.isActive()"),
    "activation churn cannot re-enter an active geometry transaction");
assert.ok(mainSource.includes("window.active && !layoutTransaction.isActive()"),
    "activeChanged cannot adopt a window in the middle of relayout");

function createTransactionHarness() {
    let validations = 0;
    const transaction = new LayoutTransaction({
        audit: () => { validations += 1; },
        debug: () => {},
    });
    return {
        transact: callback => transaction.run("test", callback),
        snapshot: () => ({
            depth: transaction.depth,
            epoch: transaction.currentEpoch(),
            validations,
        }),
    };
}

const nested = createTransactionHarness();
nested.transact(() => nested.transact(() => {}));
assert.deepEqual(nested.snapshot(), { depth: 0, epoch: 1, validations: 1 },
    "nested relayout work belongs to one epoch and validates once");

const exceptional = createTransactionHarness();
assert.throws(() => exceptional.transact(() => {
    throw new Error("geometry writer failed");
}), /geometry writer failed/);
assert.deepEqual(exceptional.snapshot(), { depth: 0, epoch: 1, validations: 1 },
    "an exception cannot strand the layout in a transaction");

exceptional.transact(() => {});
assert.deepEqual(exceptional.snapshot(), { depth: 0, epoch: 2, validations: 2 },
    "a later relayout starts a fresh epoch after recovery");

const output = { name: "DP-1" };
const window = { internalId: "{A}", output };
const column = { id: 1, window, logicalX: 0, pixelWidth: 100 };
const appState = {
    columns: [column],
    focusedColumnIndex: 0,
    innerGap: 8,
    scrollOffsetX: 0,
    safeRect: { width: 100 },
    targetOutput: output,
    presentation: { mode: "normal", windowUuid: null },
};
const states = new Map([[window, {
    managedByScrollLayout: true,
    columnId: 1,
    floating: false,
    adoptionPhase: "managed",
}]]);
const checker = new InvariantChecker({
    appState,
    windowStates: states,
    normalizeUuid: value => String(value).replace(/[{}]/g, "").toLowerCase(),
    stripWidth: () => 100,
    managedPhases: ["managed", "settling"],
    normalPresentationMode: "normal",
    debug: () => {},
    warn: () => {},
});
assert.deepEqual(checker.errors(), []);
appState.focusedColumnIndex = 2;
assert.ok(checker.errors().some(error => error.startsWith("focus-index:")));

console.log("PASS stability layout transactions and invariant auditing");
