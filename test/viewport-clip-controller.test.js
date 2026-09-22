const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    ViewportClipController,
} = require("../src/effect/ViewportClipController.js");

const calls = [];
const controller = new ViewportClipController({
    effect: {
        addFragmentShader(trait, file) {
            calls.push(["add", trait, file]);
            return 9;
        },
        setUniform(shader, name, value) {
            calls.push(["uniform", shader, name, value]);
        },
    },
    mapTextureTrait: 1,
    debug: () => {},
});
const viewport = { x: 24, y: 50, width: 2512, height: 1320 };

assert.equal(controller.shaderFor(viewport), 0,
    "the diagnostic shader is inert unless explicitly enabled");
controller.setEnabled(true);
assert.equal(controller.shaderFor(viewport), 9);
assert.deepEqual(calls, [
    ["add", 1, "viewport_clip.frag"],
    ["uniform", 9, "debugTint", 1],
    ["uniform", 9, "viewportRect", [24, 50, 2512, 1320]],
]);
assert.equal(controller.shaderFor(viewport), 9);
assert.equal(calls.filter(call => call[0] === "add").length, 1,
    "one shared shader serves every window in the same output viewport");

const root = path.join(__dirname, "..");
const legacyShader = fs.readFileSync(path.join(root,
    "effect/contents/shaders/viewport_clip.frag"), "utf8");
const coreShader = fs.readFileSync(path.join(root,
    "effect/contents/shaders/viewport_clip_core.frag"), "utf8");
const effectSource = fs.readFileSync(path.join(root,
    "effect/contents/code/main.js"), "utf8");
const configSource = fs.readFileSync(path.join(root,
    "effect/contents/config/main.xml"), "utf8");

assert.ok(legacyShader.includes("gl_FragCoord"));
assert.ok(legacyShader.includes("gl_FragColor"));
assert.ok(coreShader.includes("gl_FragCoord"));
assert.ok(coreShader.includes("out vec4 fragColor"));
assert.ok(effectSource.includes("new ViewportClipController"));
assert.ok(effectSource.includes("motionOptions.fragmentShader"));
assert.ok(effectSource.includes("INCOMING_FULL_DELTA"));
assert.ok(effectSource.includes("OUTGOING_FULL_DELTA"));
assert.ok(configSource.includes('name="DebugViewportClipTint"'));
assert.ok(!legacyShader.includes("discard"));
assert.ok(!coreShader.includes("discard"));

console.log("PASS viewport clip diagnostic tint is explicit and non-destructive");
