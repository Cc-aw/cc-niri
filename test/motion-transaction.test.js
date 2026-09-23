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
    viewport: { x: 24, y: 50, width: 2512, height: 1320 },
});
assert.equal(first.id, 1);
assert.equal(first.layoutEpoch, 52);
assert.equal(first.type, MotionType.SCROLL);
assert.equal(first.deltaX, 1260);
assert.equal(first.direction, "left");
assert.deepEqual(first.viewport,
    { x: 24, y: 50, width: 2512, height: 1320 });
assert.deepEqual(first.continuing, [continuing]);
transactions.record("incoming", incoming);
transactions.record("outgoing", outgoing);
assert.deepEqual(first.incoming, [incoming]);
assert.deepEqual(first.outgoing, [outgoing]);
assert.equal(transactions.roleFor(incoming), "incoming");
transactions.record("continuing", incoming);
assert.deepEqual(first.incoming, []);
assert.deepEqual(first.continuing, [continuing, incoming]);
assert.equal(transactions.roleFor(incoming), "continuing");
assert.equal(transactions.current(1080), first);
assert.equal(transactions.current(1081), null, "stale transactions expire");

const wideTransactions = new MotionTransaction(80);
const wideMotion = wideTransactions.begin({
    type: MotionType.WIDE_TO_PAIR,
    now: 1500,
});
assert.equal(wideTransactions.current(1999), wideMotion,
    "Wide neighbor ACK may arrive after the short scroll arming window");
assert.equal(wideTransactions.current(2001), null);

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
assert.equal(replacement.direction, "none");
assert.deepEqual(replacement.incoming, [incoming]);
assert.equal(transactions.clear(), replacement);
assert.equal(transactions.current(2001), null);

const completed = transactions.begin({ deltaX: -1260, now: 3000 });
assert.equal(completed.direction, "right");
assert.equal(transactions.complete(completed.id + 1), null);
assert.equal(transactions.complete(completed.id), completed);

const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"),
    "utf8"
);
assert.match(effectSource, /Generated from src\/effect\/MotionTransaction\.js/);
assert.equal((effectSource.match(/class MotionTransaction/g) || []).length, 1);
assert.ok(!effectSource.includes("this.pendingDeltaX ="));
assert.ok(!effectSource.includes("this.pendingDeltaArmedAt ="));

console.log("PASS MotionTransaction owns grouped scroll transition state");
