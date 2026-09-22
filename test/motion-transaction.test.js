const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { MotionType } = require("../src/effect/MotionTokens.js");
const { MotionTransaction } = require("../src/effect/MotionTransaction.js");

const transactions = new MotionTransaction(80);
const continuing = { id: "B" };
const incoming = { id: "C" };
const outgoing = { id: "A" };
const first = transactions.arm(1260, continuing, 1000, {
    type: MotionType.SCROLL,
    layoutEpoch: 52,
});
assert.equal(first.id, 1);
assert.equal(first.layoutEpoch, 52);
assert.equal(first.type, MotionType.SCROLL);
assert.equal(first.deltaX, 1260);
assert.deepEqual(first.continuing, [continuing]);
transactions.record("incoming", incoming);
transactions.record("outgoing", outgoing);
assert.deepEqual(first.incoming, [incoming]);
assert.deepEqual(first.outgoing, [outgoing]);
assert.equal(transactions.current(1080), first);
assert.equal(transactions.current(1081), null, "stale transactions expire");

const replacement = transactions.begin({
    type: MotionType.CLOSE_REFILL,
    deltaX: 0,
    role: "incoming",
    window: incoming,
    now: 2000,
});
assert.equal(replacement.id, 2);
assert.equal(replacement.layoutEpoch, 2,
    "transactions without an upstream epoch use their stable local epoch");
assert.equal(replacement.type, MotionType.CLOSE_REFILL);
assert.deepEqual(replacement.incoming, [incoming]);
assert.equal(transactions.clear(), replacement);
assert.equal(transactions.current(2001), null);

const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"),
    "utf8"
);
assert.match(effectSource, /Generated from src\/effect\/MotionTransaction\.js/);
assert.equal((effectSource.match(/class MotionTransaction/g) || []).length, 1);
assert.ok(!effectSource.includes("this.pendingDeltaX ="));
assert.ok(!effectSource.includes("this.pendingDeltaArmedAt ="));

console.log("PASS MotionTransaction owns grouped scroll transition state");
