"use strict";
const assert = require("node:assert/strict");
const { animationTargetOutput } = require("../src/effect/TargetOutput");
const { OutputTopology } = require("../src/kwin/runtime/OutputTopology");
const internal = { name: "eDP-1", geometry: { x: 0, y: 0 } };
const dp = { name: "DP-1", geometry: { x: -2560, y: 0 } };
const other = { name: "HDMI-A-1", geometry: { x: 2560, y: 0 } };
for (const screens of [[internal], [dp], [other, internal, dp], [other, internal]]) {
    // Qt-style stackingOrder is indexed but not a JS Array.
    const windows = Object.assign({ length: screens.length + 1 }, [...screens.map(screen => ({ screen })), { screen: screens[0] }]);
    for (const configuredName of ["", "DP-1", "eDP-1", "missing"]) {
        const topology = new OutputTopology({ getScreens: () => screens,
            config: { targetOutputName: configuredName }, warn() {} });
        assert.equal(animationTargetOutput(windows, configuredName), topology.primary().name);
    }
}
assert.equal(animationTargetOutput([{ screen: null }], ""), null);
const { CCNiriScrollTransition, MotionTransaction, MotionType } = require("../effect/contents/code/main.js");
const previousEffects = global.effects; const previousEffect = global.Effect;
try {
    for (const [name, width, height] of [["eDP-1", 1920, 1080], ["DP-1", 2560, 1440]]) {
        const screen = { name, geometry: { x: 0, y: 0, width, height } };
        const half = (width - 48 - 8) / 2;
        const left = { x: 24, y: 50, width: half, height: height - 120 };
        const right = { ...left, x: 24 + half + 8 };
        const window = { screen, geometry: left };
        global.effects = { stackingOrder: [window] };
        global.Effect = { Translation: 2, Opacity: 1 };
        const transition = Object.create(CCNiriScrollTransition.prototype);
        Object.assign(transition, { targetOutputName: "", innerGap: 8, duration: 220,
            wideIsolationHolds: new Map(), pendingWideExit: null,
            motionTransaction: new MotionTransaction(80), debug() {},
            parkingGrabber: { grab() {}, release() {} }, viewportClip: { shaderFor: () => null } });
        let motion;
        transition.motion = { states: new Map(), startTransaction: (_window, _transaction, _role, options) => { motion = options; return {}; } };
        transition.geometryChanged(window, right);
        assert.ok(motion, `${name} must start a real scroll animation`);
        assert.equal(motion.type, MotionType.SCROLL); assert.equal(motion.duration, 220);
        assert.equal(motion.channels[0].from.value1, half + 8);
        assert.equal(motion.channels[0].to.value1, 0);
    }
} finally { global.effects = previousEffects; global.Effect = previousEffect; }
console.log("PASS animation target follows layout output selection across DP, laptop and hotplug");
