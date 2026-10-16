"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createV2Runtime } = require("./helpers/scroll-layout-v2-runtime");
const ids = r => r.state.columns.map(c => c.v2WindowUuid);
const focus = r => (r.store.focusedColumn() || {}).v2WindowUuid;
const seed = (r, modes = ["half", "twoThirds", "full", "half", "twoThirds"]) => {
    const windows = modes.map((widthMode, i) => ({ window: r.window(`a${i}`), widthMode }));
    assert.equal(r.mount(windows, { focusedUuid: "a0" }), true);
    return windows.map(e => e.window);
};

test("P2 all focus sources share one camera policy and one epoch per changed focus", () => {
    for (const source of ["directional", "activation", "programmatic", "alt-tab", "history", "dock"]) {
        const r = createV2Runtime({ dockEnabled: true });
        const windows = seed(r);
        r.paint();
        const modes = r.state.columns.map(c => c.widthMode);
        const positions = r.state.columns.map(c => c.logicalX);
        assert.equal(r.controller.focusWindow(windows[1], source), true);
        assert.equal(focus(r), "a1");
        assert.equal(r.state.scrollOffsetX, 1484);
        assert.equal(r.state.geometryGeneration, 2);
        assert.equal(r.plans.length, 2);
        assert.equal(r.plans[1].source.cameraX, r.plans[0].cameraTargetX);
        assert.equal(r.plans[1].requiredCapability, "v2-scroll");
        assert.deepEqual(r.state.columns.map(c => c.logicalX), positions);
        assert.deepEqual(r.state.columns.map(c => c.widthMode), modes);
        assert.equal(r.controller.focusWindow(windows[1], source), false);
        assert.equal(r.transaction.currentEpoch(), 2);
    }
});

test("P2 rapid H/L uses desired focus while retarget sources retain observed camera", () => {
    const r = createV2Runtime();
    seed(r);
    r.paint();
    const seen = [];
    for (const direction of [1, 1, 1, 1, -1, -1, -1, -1]) {
        assert.equal(r.controller.focusRelative(direction), true);
        seen.push([focus(r), r.state.scrollOffsetX, r.state.geometryGeneration]);
        assert.equal(r.controller.lastTarget.source.cameraX, 0,
            "an unpainted previous target must not become the animation source");
    }
    assert.deepEqual(seen, [["a1", 1484, 2], ["a2", 3604, 3], ["a3", 4876, 4], ["a4", 6996, 5],
        ["a3", 4876, 6], ["a2", 3604, 7], ["a1", 1484, 8], ["a0", 0, 9]]);
    assert.equal(r.controller.focusRelative(-1), false);
    assert.equal(r.transaction.currentEpoch(), 9);
    assert.equal(r.controller.focusRelative(5), false);
    assert.deepEqual(ids(r), ["a0", "a1", "a2", "a3", "a4"]);
});

test("P2 closing left/right/focused mixed columns preserves painted survivor sources", () => {
    for (const index of [0, 1, 2]) {
        const r = createV2Runtime();
        const windows = seed(r, ["half", "twoThirds", "half"]);
        r.controller.focusWindow(windows[1]);
        const sample = r.paint(1400); // Actual partial motion, not target camera=1484.
        const painted = new Map(sample.entries.map(e => [e.uuid, e.visualRect]));
        assert.equal(r.controller.remove(windows[index]), true);
        const plan = r.controller.lastTarget;
        assert.equal(plan.requiredCapability, "v2-column-geometry");
        assert.equal(plan.continuity, "observed");
        assert.equal(plan.source.cameraX, 1400);
        assert.ok(plan.source.entries.every(e => e.uuid !== `a${index}`));
        plan.source.entries.forEach(e => assert.deepEqual(e.visualRect, painted.get(e.uuid)));
        assert.ok(plan.cameraTargetX >= 0 && plan.cameraTargetX <= plan.maxCamera);
        assert.equal(r.controller.remove(windows[index]), false);
        assert.equal(r.transaction.currentEpoch(), 3);
        assert.deepEqual(ids(r), [0, 1, 2].filter(i => i !== index).map(i => `a${i}`));
        assert.equal(focus(r), index === 1 ? "a2" : "a1");
    }
});

test("P2 last mixed survivor centers with exact painted source and never uses COLUMN_REINDEX", () => {
    const r = createV2Runtime();
    const windows = seed(r, ["half", "twoThirds"]);
    r.controller.focusWindow(windows[1]);
    r.paint(600);
    const x = r.controller.lastTarget.entries[1].visualRect.x + r.state.scrollOffsetX - 600;
    r.controller.remove(windows[0]);
    const plan = r.controller.lastTarget;
    assert.equal(focus(r), "a1");
    assert.equal(r.state.scrollOffsetX, 212);
    assert.equal(plan.entries[0].visualRect.x, 440);
    assert.equal(plan.source.entries[0].visualRect.x, x);
    assert.equal(plan.source.cameraX, 600);
    assert.equal(plan.kind, "scroll-layout-v2-intent");
    assert.equal(plan.type, undefined);
    r.controller.remove(windows[1]);
    assert.equal(r.state.scrollOffsetX, 0);
    assert.equal(focus(r), undefined);
    assert.equal(r.controller.lastTarget.entries.length, 0);
    assert.equal(r.controller.lastTarget.source.entries.length, 0);
});

test("P2 insert/move/reorder preserve IDs, focus identity, independent widths and source pose", () => {
    const r = createV2Runtime({ dockEnabled: true });
    const windows = seed(r, ["half", "twoThirds", "full"]);
    r.controller.focusWindow(windows[1]);
    const c = r.store.focusedColumn();
    const sample = r.paint(1400);
    const added = r.window("added");
    assert.equal(r.controller.adopt(added, { index: 0, widthMode: "half", focus: false }), true);
    assert.equal(r.store.focusedColumn(), c);
    assert.equal(r.controller.lastTarget.source.entries.find(e => e.uuid === "a1").visualRect.x,
        sample.entries.find(e => e.uuid === "a1").visualRect.x);
    assert.equal(r.controller.adopt(added), false);
    r.paint();
    assert.equal(r.controller.moveFocused(-1), true);
    assert.deepEqual(ids(r), ["added", "a1", "a0", "a2"]);
    assert.equal(r.store.focusedColumn(), c);
    assert.equal(r.controller.reorder(["a2", "a0", "added", "a1"]), true);
    assert.equal(r.store.focusedColumn(), c);
    assert.equal(c.widthMode, "twoThirds");
    assert.equal(r.controller.reorder(["a2", "a2", "added", "a1"]), false);
    assert.equal(r.controller.reorder(ids(r)), false);
    assert.equal(r.controller.lastTarget.requiredCapability, "v2-column-geometry");
});

test("moving or reordering a half column past 2/3 fits its new position without centering", () => {
    for (const delta of [-1, 1]) for (const reorder of [false, true]) {
        const r = createV2Runtime();
        const windows = seed(r, delta < 0 ? ["twoThirds", "half"] : ["half", "twoThirds"]);
        const half = windows[delta < 0 ? 1 : 0], wide = windows[delta < 0 ? 0 : 1];
        r.controller.focusWindow(wide);
        r.paint();
        r.controller.focusWindow(half);
        const sample = r.paint(), focused = r.store.focusedColumn();
        const epoch = r.transaction.currentEpoch();
        assert.equal(reorder ? r.controller.reorder(ids(r).reverse()) : r.controller.moveFocused(delta), true);
        const plan = r.controller.lastTarget;
        assert.equal(r.store.focusedColumn(), focused);
        assert.equal(r.transaction.currentEpoch(), epoch + 1);
        assert.equal(plan.requiredCapability, "v2-column-geometry");
        assert.deepEqual(plan.source.entries, sample.entries);
        assert.equal(plan.entries.find(e => e.uuid === half.internalId).visualRect.x, delta < 0 ? 16 : 1288);
        assert.deepEqual(r.state.columns.map(c => c.widthMode), delta < 0 ? ["half", "twoThirds"] : ["twoThirds", "half"]);
        r.paint();
        r.controller.focusWindow(wide);
        r.paint();
        assert.equal(r.controller.moveFocused(delta), true);
        assert.equal(r.controller.lastTarget.entries.find(e => e.uuid === wide.internalId).visualRect.x, 440);
    }
});

test("P2 empty -> first column and width shortcut use one event/epoch with no legacy transaction", () => {
    const r = createV2Runtime();
    assert.equal(r.mount([]), true);
    const window = r.window("single");
    assert.equal(r.controller.adopt(window), true);
    assert.equal(r.state.scrollOffsetX, 0);
    assert.equal(r.controller.lastTarget.continuity, "initial");
    assert.equal(r.state.geometryGeneration, 2);
    r.paint();
    assert.equal(r.width.cycle(), true);
    assert.equal(r.store.focusedColumn().widthMode, "twoThirds");
    assert.equal(r.state.scrollOffsetX, 212);
    assert.equal(r.state.geometryGeneration, 3);
    r.paint();
    r.width.toggleFull();
    assert.equal(r.state.geometryGeneration, 4);
    r.width.toggleFull();
    assert.equal(r.state.geometryGeneration, 5);
    assert.equal(r.store.focusedColumn().widthMode, "twoThirds");
    assert.ok(r.plans.every(p => !p.type && !p.protocol));
});

test("P2 synchronous adoption/activation/geometry callbacks coalesce and duplicates issue no epoch", () => {
    const r = createV2Runtime();
    seed(r, ["half"]);
    const added = r.window("added");
    const nested = r.window("nested");
    let once = false;
    r.onMembership(() => {
        if (once) return;
        once = true;
        assert.equal(r.controller.adopt(added), false);
        r.controller.adopt(nested, { focus: false });
        r.controller.focusWindow(added, "activation");
    });
    assert.equal(r.controller.adopt(added, { widthMode: "twoThirds" }), true);
    assert.equal(r.state.geometryGeneration, 2);
    assert.equal(r.plans.length, 2);
    assert.deepEqual(ids(r), ["a0", "nested", "added"]);
    r.onTarget(plan => {
        const window = r.store.focusedColumn().window;
        assert.equal(r.controller.focusWindow(window, "activation", plan), false);
        assert.equal(r.controller.setGeometry(r.controller.geometry), false);
    });
    r.controller.focusRelative(-1);
    assert.equal(r.state.geometryGeneration, 3);
    assert.equal(r.plans.length, 3);
});

test("P2 mount/restoration queries actual workspace, accepts signed in-memory anchor, rejects old scope ACK", () => {
    const r = createV2Runtime();
    const a = seed(r, ["half", "twoThirds"]);
    r.controller.focusWindow(a[1]);
    const view = r.controller.captureView();
    assert.equal(view.anchor.delta, -440);
    const old = r.controller.lastTarget;
    r.paint();
    r.setCurrent("B");
    const b = r.window("b", "B");
    assert.equal(r.controller.focusWindow(a[0], "activation"), false, "old workspace activation cannot switch back");
    assert.equal(r.mount([{ window: b, widthMode: "twoThirds" }]), true);
    assert.equal(r.controller.lastTarget.source, null);
    assert.equal(r.state.scrollOffsetX, 212);
    assert.equal(r.mount([{ window: b, widthMode: "twoThirds" }]), false);
    assert.equal(r.controller.focusWindow(b, "activation", old), false);
    assert.equal(r.controller.mount({ workspaceId: "A", output: r.getPrimary(), geometry: r.geometry() }, []), false);
    r.setCurrent("A");
    assert.equal(r.mount(a.map((window, i) => ({ window, widthMode: i ? "twoThirds" : "half" })), view), true);
    assert.equal(focus(r), "a1");
    assert.equal(r.state.scrollOffsetX, 1484);
    assert.equal(r.controller.lastTarget.source, null);
    assert.equal(r.controller.focusWindow(a[0], "activation", old), false);
    assert.equal(r.state.geometryGeneration, 4);
});

test("P2 stale/regressed/wrong scope/invalid paint facts are never replaced with fabricated target poses", () => {
    const mutations = [s => { s.sessionId = "retired"; }, s => { s.workspaceId = "B"; }, s => { s.scopeRevision++; }, s => { s.targetOutput = "elsewhere"; },
        s => { s.epoch += 100; }, s => { s.cameraX = NaN; }, s => { s.entries[0].visualRect.width = 0; },
        s => { s.entries.push(s.entries[0]); }, s => { s.entries[0].uuid = "unknown"; }];
    for (const mutate of mutations) {
        const r = createV2Runtime(); const windows = seed(r); const sample = r.paint();
        mutate(sample);
        r.controller.focusWindow(windows[1]);
        assert.equal(r.controller.lastTarget.source, null);
        assert.equal(r.controller.lastTarget.continuity, "unavailable");
    }
    const r = createV2Runtime(); const windows = seed(r); const sample = r.paint();
    r.controller.focusWindow(windows[1]);
    sample.sampleSerial = 0;
    r.controller.focusWindow(windows[2]);
    assert.equal(r.controller.lastTarget.source, null);
});

test("P2 panel/output geometry changes rebase once; output identity replacement cannot reuse old source", () => {
    const r = createV2Runtime();
    const windows = seed(r, ["half", "twoThirds"]);
    r.controller.focusWindow(windows[1]); r.paint();
    assert.equal(r.controller.setGeometry(r.geometry(2560, 16, 50, 1.5)), true);
    assert.equal(r.controller.lastTarget.entries[1].visualRect.y, 66);
    assert.equal(r.controller.lastTarget.entries[1].visualRect.height, 1358);
    assert.equal(r.controller.lastTarget.source.geometry.workingArea.y, 0);
    assert.equal(r.controller.setGeometry(r.geometry(2560, 16, 50, 1.5)), false);
    const fallback = r.geometry(2560, 16, 50, 1.5);
    fallback.diagnostics.push("working-area-fallback");
    assert.equal(r.controller.setGeometry(fallback), true);
    assert.ok(r.controller.lastTarget.geometry.diagnostics.includes("working-area-fallback"));
    const previous = r.controller.lastTarget;
    r.replacePrimary();
    const replacement = r.window("replacement");
    assert.equal(r.mount([{ window: replacement, widthMode: "half" }]), true);
    assert.equal(r.controller.lastTarget.source, null);
    assert.equal(r.controller.focusWindow(replacement, "activation", previous), false);
});

test("P2 closed QObject is released even during departure without reading destroyed properties", () => {
    const r = createV2Runtime(); const windows = seed(r, ["half", "twoThirds"]);
    Object.defineProperty(windows[0], "internalId", { get() { throw new Error("destroyed wrapper"); } });
    assert.equal(r.controller.remove(windows[0]), true);
    r.setCurrent("B");
    Object.defineProperty(windows[1], "internalId", { get() { throw new Error("destroyed wrapper"); } });
    const epoch = r.state.geometryGeneration;
    assert.equal(r.controller.remove(windows[1]), true);
    assert.equal(r.state.columns.length, 0);
    assert.equal(r.controller.lastTarget, null);
    assert.equal(r.state.geometryGeneration, epoch);
});

test("P2 optional Dock, native-only/floating/fullscreen/secondary/sticky and disabled paths stay inert", () => {
    const r = createV2Runtime(); const windows = seed(r);
    assert.equal(r.controller.focusWindow(windows[1], "dock"), false);
    for (const fields of [{ dialog: true }, { transient: true }, { fullScreen: true }, { floating: true },
        { output: {} }, { onAllDesktops: true }, { desktops: [{ id: "B" }] }]) {
        assert.equal(r.controller.adopt(r.window("bad", "A", fields)), false);
    }
    r.state.workspaceSwitching = true;
    assert.equal(r.controller.focusRelative(1), false);
    r.state.workspaceSwitching = false;
    r.state.enabled = false;
    assert.equal(r.controller.focusRelative(1), false);
    assert.equal(r.state.geometryGeneration, 1);
    const disabled = createV2Runtime({ enabled: false });
    assert.equal(disabled.mount([]), false);
    assert.equal(disabled.transaction.currentEpoch(), 0);
});

test("P2 stop or callback failure during adoption clears bounded state and suppresses targets", () => {
    for (const failure of [false, true]) {
        const r = createV2Runtime(); seed(r, ["half"]);
        r.onMembership(() => {
            if (failure) throw new Error("membership callback failed");
            r.controller.stop();
        });
        if (failure) {
            // Cleanup callbacks must not throw a second time during clear.
            let once = false;
            r.onMembership(() => { if (!once) { once = true; throw new Error("membership callback failed"); } });
            assert.throws(() => r.controller.adopt(r.window("added")), /membership callback failed/);
        } else assert.equal(r.controller.adopt(r.window("added")), false);
        assert.equal(r.state.columns.length, 0);
        assert.equal(r.controller.lastTarget, null);
        assert.equal(r.controller.lastSample, null);
        assert.equal(r.controller.busy, false);
        assert.equal(r.controller.enabled, false);
        assert.equal(r.plans.length, 1);
        assert.equal(r.controller.focusRelative(1), false);
    }
});

test("P2 repeated insert/close keeps one target, no dead UUIDs and no historical window references", () => {
    const r = createV2Runtime(); seed(r, ["twoThirds"]);
    for (let i = 0; i < 2000; i++) {
        const window = r.window(`new${i}`);
        r.controller.adopt(window, { focus: false });
        r.controller.remove(window);
        assert.deepEqual(ids(r), ["a0"]);
        assert.equal(r.controller.lastTarget.entries.length, 1);
        assert.equal(r.controller.lastTarget.entries[0].uuid, "a0");
        r.plans.length = 0; // Test observer history is separate from production state.
    }
    assert.equal(r.state.geometryGeneration, 4001);
    assert.equal(r.controller.stop(), true);
    assert.equal(r.state.columns.length, 0);
    assert.equal(r.controller.geometry, null);
    assert.equal(r.controller.stop(), false);
});

test("P2 batched membership changes and subsequent unpainted closes retain only verified survivor poses", () => {
    const r = createV2Runtime(); const windows = seed(r, ["half", "twoThirds", "half"]);
    r.controller.focusWindow(windows[1]);
    const sample = r.paint(1400);
    const expected = sample.entries.find(e => e.uuid === "a1").visualRect;
    const added = r.window("added");
    assert.equal(r.controller.batch("model-event", () => {
        r.controller.adopt(added, { focus: false });
        r.controller.remove(windows[0]);
        r.controller.reorder(["a1", "a2", "added"]);
    }), true);
    assert.equal(r.state.geometryGeneration, 3);
    assert.deepEqual(ids(r), ["a1", "a2", "added"]);
    assert.deepEqual(r.controller.lastTarget.source.entries.find(e => e.uuid === "a1").visualRect, expected);
    r.controller.remove(windows[2]); // No intervening paint: reuse the verified sample identity.
    assert.equal(r.state.geometryGeneration, 4);
    assert.deepEqual(r.controller.lastTarget.source.entries, [{ uuid: "a1", visualRect: expected }]);
    assert.throws(() => { r.controller.lastTarget.source.entries[0].visualRect.x = 99; }, TypeError);
});

test("P2 repeated signed-anchor restoration is idempotent and malformed mount is atomic", () => {
    const r = createV2Runtime(); const windows = seed(r, ["half", "twoThirds"]);
    r.controller.focusWindow(windows[1]);
    const view = r.controller.captureView();
    const entries = windows.map((window, i) => ({ window, widthMode: i ? "twoThirds" : "half" }));
    assert.equal(r.mount(entries, view), false);
    assert.equal(r.state.geometryGeneration, 2);
    assert.equal(r.transaction.currentEpoch(), 2);
    assert.equal(r.mount(entries.concat(entries[0]), view), false);
    assert.equal(r.mount([null], view), false);
    assert.equal(r.controller.mount({ workspaceId: "A", output: r.getPrimary(), geometry: {} }, entries), false);
    assert.deepEqual(ids(r), ["a0", "a1"]);
    assert.equal(r.transaction.currentEpoch(), 2);
});

test("P2 persistent cleanup callback failure is observable while model/output references still release", () => {
    const r = createV2Runtime(); seed(r, ["half"]);
    r.onMembership(() => { throw new Error("cleanup callback failed"); });
    assert.equal(r.controller.stop(), false);
    assert.equal(r.controller.cleanupFailed, true);
    assert.equal(r.state.columns.length, 0);
    assert.equal(r.state.targetOutput, null);
    assert.equal(r.controller.geometry, null);
    assert.equal(r.controller.lastTarget, null);
});
