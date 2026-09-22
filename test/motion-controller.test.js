const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.Effect = {
    Translation: 1,
    Scale: 2,
    Opacity: 3,
    Generic: 4,
    Left: 10,
    Right: 11,
    Top: 12,
    Bottom: 13,
};
global.QEasingCurve = { OutCubic: "out-cubic", Linear: "linear" };

let animationRequest = null;
let cancelledIds = null;
global.animate = request => {
    animationRequest = request;
    return [101, 102];
};
global.cancel = ids => {
    cancelledIds = ids;
};

const { MotionCurves, MotionType } = require("../src/effect/MotionTokens.js");
const { MotionController } = require("../src/effect/MotionController.js");

const messages = [];
const controller = new MotionController({ debug: message => messages.push(message) });
const window = {};
const geometry = { x: 100, y: 50, width: 1200, height: 1300 };
const state = controller.start(window, {
    type: MotionType.SCROLL,
    duration: 220,
    curve: MotionCurves.standardDecel,
    oldGeometry: geometry,
    newGeometry: geometry,
    channels: [{
        type: Effect.Translation,
        from: { value1: 1260, value2: 0 },
        to: { value1: 0, value2: 0 },
    }, {
        type: Effect.Scale,
        anchor: "right",
        from: { value1: 0.94, value2: 1 },
        to: { value1: 1, value2: 1 },
    }],
});

assert.equal(state.epoch, 1);
assert.equal(state.type, MotionType.SCROLL);
assert.equal(controller.states.get(window), state);
assert.deepEqual(window.ccNiriScrollAnimation, [101, 102]);
assert.equal(animationRequest.duration, 220);
assert.equal(animationRequest.curve, QEasingCurve.OutCubic);
assert.equal(animationRequest.animations[1].sourceAnchor, Effect.Right);
assert.match(messages[0], /\[MOTION\] start type=SCROLL epoch=1/);

controller.animationEnded(window, 101);
assert.deepEqual(window.ccNiriScrollAnimation, [102]);
assert.equal(controller.states.has(window), true);
controller.animationEnded(window, 102);
assert.equal(controller.states.has(window), false);
assert.equal("ccNiriScrollAnimation" in window, false);
assert.equal("ccNiriIncomingVisual" in window, false);

const otherWindow = {};
controller.start(otherWindow, {
    duration: 1,
    oldGeometry: geometry,
    newGeometry: geometry,
    channels: [{
        type: Effect.Opacity,
        from: 0.2,
        to: 1,
    }],
});
assert.equal(controller.cancel(otherWindow), true);
assert.deepEqual(cancelledIds, [101, 102]);

animationRequest = null;
const noOpWindow = {};
assert.equal(controller.start(noOpWindow, {
    type: MotionType.SCROLL,
    duration: 220,
    oldGeometry: geometry,
    newGeometry: geometry,
    channels: [{ type: Effect.Opacity, from: 1, to: 1 }],
}), null);
assert.equal(animationRequest, null, "no-op channels do not start a KWin animation");
assert.equal(controller.states.has(noOpWindow), false);

const realDateNow = Date.now;
let fakeNow = 1000;
Date.now = () => fakeNow;
const retargetController = new MotionController({ debug: () => {} });
const retargetWindow = {};
retargetController.start(retargetWindow, {
    type: MotionType.SCROLL,
    duration: 220,
    oldGeometry: geometry,
    newGeometry: geometry,
    channels: [{
        type: Effect.Translation,
        from: { value1: 100, value2: 0 },
        to: { value1: 0, value2: 0 },
    }],
});
fakeNow = 1110;
retargetController.start(retargetWindow, {
    type: MotionType.SCROLL,
    duration: 220,
    oldGeometry: geometry,
    newGeometry: geometry,
    channels: [{
        type: Effect.Translation,
        from: { value1: 100, value2: 0 },
        to: { value1: 0, value2: 0 },
    }],
});
assert.equal(animationRequest.duration, 110,
    "a retarget with about 12.5% distance remaining does not restart at 220 ms");
Date.now = realDateNow;

const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"),
    "utf8"
);
assert.match(effectSource, /Generated from src\/effect\/MotionController\.js/);
assert.equal((effectSource.match(/class MotionController/g) || []).length, 1);
assert.match(effectSource, /distanceAwareDuration\(/);
assert.match(effectSource, /reason=no-op/);

delete global.Effect;
delete global.QEasingCurve;
delete global.animate;
delete global.cancel;

console.log("PASS MotionController owns retargetable Effect animation state");
