const assert = require("node:assert/strict");

function vectorsForTransaction(deltaX, continuing, incoming, outgoing) {
    const learnedDelta = continuing.oldProjectedX - continuing.newProjectedX;
    assert.equal(learnedDelta, deltaX);
    return {
        continuing: { from: learnedDelta, to: 0 },
        incoming: { from: learnedDelta, to: 0 },
        outgoing: {
            from: outgoing.oldProjectedX - outgoing.parkingX,
            to: outgoing.newProjectedX - outgoing.parkingX,
        },
    };
}

function edgePolicy(deltaX) {
    return {
        incoming: deltaX > 0 ? "safe-slide-from-right" : "translate-from-left",
        outgoing: deltaX < 0 ? "safe-slide-to-right" : "translate-to-left",
    };
}

const moveRight = vectorsForTransaction(1260,
    { oldProjectedX: 1284, newProjectedX: 24 },
    { oldProjectedX: 2544, newProjectedX: 1284 },
    { oldProjectedX: 24, newProjectedX: -1236, parkingX: -10388 });
assert.deepEqual(moveRight.continuing, { from: 1260, to: 0 });
assert.deepEqual(moveRight.incoming, { from: 1260, to: 0 });
assert.deepEqual(moveRight.outgoing, { from: 10412, to: 9152 });

const moveLeft = vectorsForTransaction(-1260,
    { oldProjectedX: 24, newProjectedX: 1284 },
    { oldProjectedX: -1236, newProjectedX: 24 },
    { oldProjectedX: 1284, newProjectedX: 2544, parkingX: -10388 });
assert.deepEqual(moveLeft.continuing, { from: -1260, to: 0 });
assert.deepEqual(moveLeft.incoming, { from: -1260, to: 0 });
assert.deepEqual(moveLeft.outgoing, { from: 11672, to: 12932 });

assert.deepEqual(edgePolicy(1260), {
    incoming: "safe-slide-from-right",
    outgoing: "translate-to-left",
});
assert.deepEqual(edgePolicy(-1260), {
    incoming: "translate-from-left",
    outgoing: "safe-slide-to-right",
});

console.log("PASS V3 direction-correct transitions with right-output-safe edge policy");
