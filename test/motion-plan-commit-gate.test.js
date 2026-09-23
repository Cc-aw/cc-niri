const assert = require("node:assert/strict");
const { MotionPlanCommitGate } =
    require("../src/kwin/layout/MotionPlanCommitGate");

const callbacks = [];
const commits = [];
const warnings = [];
let epoch = 1;
const gate = new MotionPlanCommitGate({
    publish: (envelope, callback) => callbacks.push({ envelope, callback }),
    currentEpoch: () => epoch,
    commit: (plan, context, activationWindow) =>
        commits.push({ plan, context, activationWindow }),
    warn: message => warnings.push(message),
});

const first = { epoch: 1 };
gate.schedule(first, { id: "first" }, { wideExitColumn: "A" });
assert.equal(gate.deferActivation("window-A"), true);
epoch = 2;
const second = { epoch: 2 };
gate.schedule(second, { id: "second" }, { wideExitColumn: "B" });
callbacks[0].callback(true);
assert.deepEqual(commits, [], "a superseded plan cannot commit old geometry");
gate.deferActivation("window-B");
callbacks[1].callback(true);
assert.deepEqual(commits, [{
    plan: second,
    context: { wideExitColumn: "B" },
    activationWindow: "window-B",
}]);
assert.equal(gate.deferActivation("late"), false);

epoch = 3;
gate.schedule({ epoch: 3 }, { id: "cancelled" }, {});
gate.cancel();
callbacks[2].callback(true);
assert.equal(commits.length, 1,
    "emergency restore cancels pending geometry commits");

gate.schedule({ epoch: 3 }, { id: "fallback" }, {});
callbacks[3].callback(false);
assert.equal(commits.length, 2,
    "Bridge rejection still commits using the geometry fallback");
assert.equal(warnings.length, 1);

gate.schedule({ epoch: 3 }, { id: "stale-epoch" }, {});
epoch = 4;
callbacks[4].callback(true);
assert.equal(gate.deferActivation("stale"), false);
assert.equal(commits.length, 2);

console.log("PASS motion-plan gate commits only the current ACKed layout");
