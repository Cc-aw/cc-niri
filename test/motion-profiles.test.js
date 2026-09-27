const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { MotionCurves, MotionTokens, MotionType } =
    require("../src/effect/MotionTokens.js");
const { MotionProfiles, motionProfile, motionProfileDuration } =
    require("../src/effect/MotionProfiles.js");

assert.deepEqual(Object.keys(MotionProfiles).sort(), Object.values(MotionType).sort());
assert.equal(Object.isFrozen(MotionProfiles), true);
for (const type of Object.values(MotionType)) {
    const profile = motionProfile(type);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(motionProfileDuration(type), MotionTokens[profile.durationToken]);
    assert.ok(profile.curve === MotionCurves.standardDecel ||
        profile.curve === MotionCurves.expressiveSpatial);
    for (const channel of ["translation", "scale", "opacity", "retarget"]) {
        assert.equal(typeof profile[channel], "boolean");
    }
}
assert.equal(motionProfile(MotionType.SCROLL).translation, true);
assert.equal(motionProfile(MotionType.SCROLL).scale, false);
assert.equal(motionProfileDuration(MotionType.SCROLL), 220);
assert.equal(motionProfile(MotionType.CLOSE_REFILL).incomingScaleToken,
    "subtleIncomingScale");
assert.equal(motionProfile(MotionType.CLOSE_REFILL).opacity, true);
assert.equal(motionProfileDuration(MotionType.PAIR_TO_WIDE), 320);
assert.equal(motionProfileDuration(MotionType.WIDE_TO_PAIR), 240);
assert.equal(motionProfile("unknown"), MotionProfiles[MotionType.NONE]);

const source = fs.readFileSync(path.join(__dirname,
    "../src/effect/MotionProfiles.js"), "utf8");
assert.doesNotMatch(source, /\banimate\s*\(|\bframeGeometry\b|\bworkspace\b/);
const effectSource = fs.readFileSync(path.join(__dirname,
    "../effect/contents/code/main.js"), "utf8");
assert.match(effectSource, /Generated from src\/effect\/MotionProfiles\.js/);

console.log("PASS MotionProfiles maps every motion type without executing motion");
