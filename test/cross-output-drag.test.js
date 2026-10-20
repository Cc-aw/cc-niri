"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRuntime } = require("./helpers/workspace-runtime");

function fixture() {
    const config = { ScrollLayoutV2Enabled: true, MockV2Native: true, PrimaryWindowCount: 1 };
    const r = createRuntime(config);
    r.paintV2();
    const secondary = { name: "HDMI-A-1", geometry: { x: 2560, y: 0, width: 1920, height: 1080 } };
    r.workspace.screens.push(secondary);
    const window = r.add("incoming", 0, { output: secondary });
    const state = () => r.evaluate('stateFor(workspace.windowList().find(w => w.internalId === "incoming"))');
    const start = () => { window.move = true; window.interactiveMoveResizeStarted.emit(); };
    const finish = () => { window.move = false; window.interactiveMoveResizeFinished.emit(); };
    return { r, config, window, secondary, state, start, finish };
}

test("secondary drag defers every adoption event and geometry write until release", () => {
    const f = fixture(), { r, window } = f;
    r.workspace.activeWindow = window;
    const arms = r.nativeArms.length, cancels = r.nativeCancels.length, writes = r.writes();
    f.start();
    assert.equal(f.state().interactiveMoveResize, true);
    window.output = r.output; window.outputChanged.emit();
    window.readyForPaintingChanged.emit(); window.frameGeometryChanged.emit(); window.activeChanged.emit();
    assert.equal(r.ids().includes("incoming"), false);
    assert.equal(r.nativeArms.length, arms);
    assert.equal(r.nativeCancels.length, cancels, "an unowned drag does not retire the unrelated primary strip");
    assert.equal(r.writes(), writes, "the script must not fight the active pointer move");
    f.finish(); r.paintV2();
    assert.equal(f.state().interactiveMoveResize, false);
    assert.equal(r.ids().includes("incoming"), true);
    assert.equal(r.state.enabled, true);
    assert.equal(r.evaluate("continuousLayout.coordinator.bootstrap"), null);
});

test("rapid crossing back to secondary reconciles only the final output", () => {
    const f = fixture(), { r, window } = f;
    r.workspace.activeWindow = window;
    f.start();
    for (const output of [r.output, f.secondary, r.output, f.secondary]) {
        window.output = output; window.outputChanged.emit(); window.frameGeometryChanged.emit();
    }
    f.finish(); r.paintV2();
    assert.deepEqual(r.ids(), ["a0"]);
    assert.equal(f.state().interactiveMoveResize, false);
    assert.equal(r.state.enabled, true);
});

test("native move and resize facts block adoption even before the started callback", () => {
    for (const flag of ["move", "resize"]) {
        const f = fixture(), { r, window } = f;
        window[flag] = true; window.output = r.output;
        window.outputChanged.emit(); r.workspace.activeWindow = window;
        window.readyForPaintingChanged.emit(); window.frameGeometryChanged.emit();
        assert.equal(r.ids().includes("incoming"), false, flag);
        window[flag] = false; window.interactiveMoveResizeFinished.emit(); r.paintV2();
        assert.equal(r.ids().includes("incoming"), true, flag);
    }
});

test("dragging an existing primary column preserves Floating ownership after release", () => {
    const f = fixture(), { r } = f, window = r.a[0];
    window.move = true; window.interactiveMoveResizeStarted.emit();
    window.output = f.secondary; window.outputChanged.emit();
    window.move = false; window.interactiveMoveResizeFinished.emit();
    const state = r.evaluate('stateFor(workspace.windowList().find(w => w.internalId === "a0"))');
    assert.equal(state.floating, true);
    assert.equal(state.interactiveMoveResize, false);
    assert.equal(r.ids().includes("a0"), false);
    assert.equal(r.state.enabled, true);
    window.output = r.output; window.outputChanged.emit(); window.activeChanged.emit();
    assert.equal(r.ids().includes("a0"), false, "crossing back does not silently reattach Floating windows");
});

test("release during a held Native cancellation cannot leave the gesture flag stuck", () => {
    const f = fixture(), { r, config } = f, window = r.a[0];
    config.HoldV2Status = true;
    window.move = true; window.interactiveMoveResizeStarted.emit();
    window.move = false; window.interactiveMoveResizeFinished.emit();
    config.HoldV2Status = false;
    const sessionId = r.published.at(-1).sessionId;
    for (const ack of r.scrollStatusAcks.splice(0)) ack(JSON.stringify({ sessionId,
        epoch: r.nativeArms.at(-1).epoch, active: false, clipHandoffActive: false }));
    const state = r.evaluate('stateFor(workspace.windowList().find(w => w.internalId === "a0"))');
    assert.equal(state.interactiveMoveResize, false);
    assert.equal(state.floating, true);
    assert.equal(r.state.enabled, true);
});

test("closed or paused incoming gestures never remount or arm on finish", () => {
    for (const paused of [false, true]) {
        const f = fixture(), { r, window } = f;
        f.start(); window.output = r.output;
        if (paused) r.sessionEvent(true); else r.close(window);
        const arms = r.nativeArms.length;
        f.finish();
        assert.equal(r.nativeArms.length, arms);
        assert.equal(r.ids().includes("incoming"), false);
    }
});

test("an old finish waiting for Native cannot adopt a new active gesture", () => {
    const f = fixture(), { r, config, window } = f;
    r.workspace.activeWindow = window;
    f.start(); window.output = r.output; window.outputChanged.emit();
    config.HoldV2Status = true;
    f.finish(); f.start();
    config.HoldV2Status = false;
    for (const ack of r.scrollStatusAcks.splice(0)) ack(JSON.stringify({
        sessionId: r.published.at(-1).sessionId, epoch: r.nativeArms.at(-1).epoch,
        active: false, clipHandoffActive: false }));
    assert.equal(f.state().interactiveMoveResize, true);
    assert.equal(r.ids().includes("incoming"), false);
    f.finish(); r.paintV2();
    assert.equal(r.ids().includes("incoming"), true);
    assert.equal(r.state.enabled, true);
});
