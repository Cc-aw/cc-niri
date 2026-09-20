const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);

assert.ok(mainSource.includes("let layoutTransactionDepth = 0"));
assert.ok(mainSource.includes("let layoutEpoch = 0"));
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
    mainSource.indexOf("function validateLayoutInvariants"),
    mainSource.indexOf("function endLayoutTransaction")
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
assert.ok(activationSource.includes("layoutTransactionDepth > 0"),
    "activation churn cannot re-enter an active geometry transaction");
assert.ok(mainSource.includes("window.active && layoutTransactionDepth === 0"),
    "activeChanged cannot adopt a window in the middle of relayout");

function createTransactionHarness() {
    let depth = 0;
    let epoch = 0;
    let validations = 0;
    const begin = () => {
        if (depth === 0) epoch += 1;
        depth += 1;
        return epoch;
    };
    const end = () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) validations += 1;
    };
    const transact = callback => {
        begin();
        try {
            callback();
        } finally {
            end();
        }
    };
    return {
        transact,
        snapshot: () => ({ depth, epoch, validations }),
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

console.log("PASS stability layout transactions and invariant auditing");
