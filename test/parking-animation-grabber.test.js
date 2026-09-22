const assert = require("node:assert/strict");

const {
    ParkingAnimationGrabber,
} = require("../src/effect/ParkingAnimationGrabber.js");

const calls = [];
const fakeEffect = {
    grab(window, role, force) {
        calls.push(["grab", window.id, role, force]);
        return true;
    },
    ungrab(window, role) {
        calls.push(["ungrab", window.id, role]);
        return true;
    },
};
const logs = [];
const grabber = new ParkingAnimationGrabber({
    effect: fakeEffect,
    minimizedRole: 10,
    unminimizedRole: 11,
    debug: message => logs.push(message),
});
const window = { id: "incoming" };

assert.equal(grabber.grab(window, "incoming"), true);
assert.equal(grabber.has(window), true);
assert.deepEqual(calls, [
    ["grab", "incoming", 10, true],
    ["grab", "incoming", 11, true],
]);
assert.equal(grabber.grab(window, "duplicate"), true,
    "a retarget must retain the existing parking grab");
assert.equal(calls.length, 2);

assert.equal(grabber.release(window, "motion-complete"), true);
assert.equal(grabber.has(window), false);
assert.deepEqual(calls.slice(2), [
    ["ungrab", "incoming", 10],
    ["ungrab", "incoming", 11],
]);
assert.ok(logs.some(message => message.includes("[PARK_GRAB] grab")));
assert.ok(logs.some(message => message.includes("[PARK_GRAB] release")));

const rollbackCalls = [];
const rollbackGrabber = new ParkingAnimationGrabber({
    effect: {
        grab(_window, role) {
            rollbackCalls.push(["grab", role]);
            return role === 20;
        },
        ungrab(_window, role) {
            rollbackCalls.push(["ungrab", role]);
            return true;
        },
    },
    minimizedRole: 20,
    unminimizedRole: 21,
    debug: () => {},
});
assert.equal(rollbackGrabber.grab({ id: "rollback" }, "incoming"), false);
assert.deepEqual(rollbackCalls, [
    ["grab", 20],
    ["grab", 21],
    ["ungrab", 20],
]);

const fs = require("node:fs");
const path = require("node:path");
const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"),
    "utf8"
);
const installSource = fs.readFileSync(
    path.join(__dirname, "../install.sh"),
    "utf8"
);
const uninstallSource = fs.readFileSync(
    path.join(__dirname, "../uninstall.sh"),
    "utf8"
);
assert.match(effectSource,
    /Generated from src\/effect\/ParkingAnimationGrabber\.js/);
assert.ok(effectSource.includes("Effect.WindowMinimizedGrabRole"));
assert.ok(effectSource.includes("Effect.WindowUnminimizedGrabRole"));
assert.ok(effectSource.includes('this.parkingGrabber.grab(window, "incoming")'));
assert.ok(effectSource.includes('this.parkingGrabber.grab(window, "outgoing")'));
for (const effectId of ["SQUASH_EFFECT_ID", "MAGIC_LAMP_EFFECT_ID"]) {
    assert.ok(installSource.includes(effectId));
    assert.ok(uninstallSource.includes(effectId));
}
assert.ok(installSource.includes("SquashWasEnabled"));
assert.ok(installSource.includes("MagicLampWasEnabled"));
assert.ok(uninstallSource.includes("RESTORE_SQUASH"));
assert.ok(uninstallSource.includes("RESTORE_MAGIC_LAMP"));

console.log("PASS CC-owned parking transitions acquire and release KWin grabs");
