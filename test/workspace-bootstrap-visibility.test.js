"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRuntime } = require("./helpers/workspace-runtime");

function fixture() {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true,
        PrimaryWindowCount: 2, OtherWorkspaceWindowCount: 3 });
    r.paintV2();
    return r;
}

function parkDestination(r) {
    r.evaluate('workspace.windowList().filter(w => String(w.internalId).startsWith("b"))' +
        '.forEach(w => parkingManager.setVisibility(w, false))');
}

test("workspace mount reveals a ready neighbor while the hidden focused client's ACK is delayed", () => {
    const r = fixture();
    parkDestination(r);
    r.holdGeometry(r.b[1]);
    const arms = r.nativeArms.length;
    r.nativeSwitch(1, r.b[1]);
    assert.equal(r.evaluate("continuousLayout.coordinator.bootstrap.phase"), "configure");
    assert.equal(r.b[0].opacity, 1, "the ready full neighbor must not require H to become visible");
    assert.equal(r.b[0].minimized, false);
    assert.equal(r.b[1].opacity, 0, "the unacknowledged focused frame stays hidden");
    assert.equal(r.nativeArms.length, arms, "all configure ACKs still gate Native ownership");
    r.flushGeometry(r.b[1]);
    assert.equal(r.b[1].opacity, 1);
    r.paintV2();
    assert.equal(r.workspace.activeWindow, r.b[1]);
    assert.equal(r.evaluate("continuousLayout.coordinator.bootstrap"), null);
});

test("a late focused configure ACK restores visibility without waiting for a second slow client", () => {
    const r = fixture();
    parkDestination(r);
    r.holdGeometry(r.b[0]); r.holdGeometry(r.b[1]);
    r.nativeSwitch(1, r.b[0]);
    assert.equal(r.b[0].opacity, 0);
    r.flushGeometry(r.b[0]);
    assert.equal(r.b[0].opacity, 1, "frameGeometryChanged must also restore the focused client");
    assert.equal(r.b[1].opacity, 0);
    assert.equal(r.evaluate("continuousLayout.coordinator.bootstrap.phase"), "configure");
    r.flushGeometry(r.b[1]); r.paintV2();
    assert.equal(r.state.enabled, true);
    assert.equal(r.workspace.activeWindow, r.b[0]);
});

test("partial neighbors remain hidden until the Native arm ACK even when their safe frames are ready", () => {
    const r = fixture();
    r.nativeSwitch(1, r.b[0]); r.paintV2();
    r.shortcuts.get("CCScrollCycleColumnWidth")(); r.paintV2();
    r.nativeSwitch(0, r.a[0]); r.paintV2();
    parkDestination(r);
    r.b[0].frameGeometry = { x: 100, y: 100, width: 800, height: 600 };
    r.holdGeometry(r.b[0]);
    const bridge = r.evaluate("continuousLayout.coordinator.bridge");
    const arm = bridge.armScrollPlan.bind(bridge);
    let finishArm;
    bridge.armScrollPlan = (plan, done) => { finishArm = () => arm(plan, done); };
    r.nativeSwitch(1, r.b[0]);
    const target = r.evaluate("continuousLayout.controller.lastTarget");
    assert.ok(target.entries.find(e => e.uuid === "b1").visualRect.x + r.b[1].frameGeometry.width > 2560);
    assert.equal(r.b[1].opacity, 0);
    r.flushGeometry(r.b[0]);
    assert.equal(r.b[0].opacity, 1);
    assert.equal(r.b[1].opacity, 0, "a clamped safe anchor is not its final clipped visual frame");
    assert.equal(typeof finishArm, "function");
    finishArm();
    assert.equal(r.b[1].opacity, 1);
    r.paintV2();
    assert.equal(r.state.enabled, true);
});

test("an ACK from a departed workspace cannot reveal its parked client", () => {
    const r = fixture();
    parkDestination(r);
    r.holdGeometry(r.b[1]);
    r.nativeSwitch(1, r.b[1]);
    r.nativeSwitch(0, r.a[0]); r.paintV2();
    const arms = r.nativeArms.length;
    r.flushGeometry(r.b[1]);
    assert.equal(r.b[1].opacity, 0);
    assert.equal(r.nativeArms.length, arms);
    assert.equal(r.state.activeWorkspaceId, "A");
    assert.equal(r.workspace.activeWindow, r.a[0]);
});

test("a synchronous workspace change during reveal retires the remaining bootstrap callbacks", () => {
    const r = fixture();
    parkDestination(r);
    r.holdGeometry(r.b[0]); r.holdGeometry(r.b[1]);
    r.nativeSwitch(1, r.b[0]);
    const coordinator = r.evaluate("continuousLayout.coordinator");
    const setVisibility = coordinator.setVisibility;
    let switched = false;
    coordinator.setVisibility = (window, visible) => {
        setVisibility(window, visible);
        if (!switched && window === r.b[0] && visible) {
            switched = true;
            r.nativeSwitch(0, r.a[0]);
        }
    };
    r.flushGeometry(r.b[0]);
    assert.equal(switched, true);
    const arms = r.nativeArms.length;
    r.flushGeometry(r.b[1]);
    assert.equal(r.nativeArms.length, arms);
    assert.equal(r.b[1].opacity, 0);
    r.paintV2();
    assert.equal(r.state.activeWorkspaceId, "A");
    assert.equal(r.workspace.activeWindow, r.a[0]);
});
