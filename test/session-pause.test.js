"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { SessionPauseController } = require("../src/kwin/runtime/SessionPauseController");
const { createRuntime } = require("./helpers/workspace-runtime");

function fixture() {
    let facts = { protocol: 1, type: "session-state", instanceId: "native", sequence: 0, locked: false };
    let hold = false, released = true, resumes = 0, pauses = 0;
    const queries = [], releases = [], timers = new Set(), statuses = [], faults = [];
    const c = new SessionPauseController({
        readState: done => { if (hold) queries.push(done); else done(JSON.stringify(facts)); },
        release: done => { releases.push(done); if (released !== null) done(released); },
        onPause: () => { pauses++; }, onResume: () => { resumes++; },
        onFault: (...value) => faults.push(value), health: s => statuses.push(s), warn: () => {},
        setTimer: (fn, ms) => { const t = { fn, ms }; timers.add(t); return t; },
        clearTimer: t => timers.delete(t),
    });
    const fire = () => { const t = [...timers][0]; assert.ok(t); timers.delete(t); t.fn(); };
    c.refresh("startup");
    return { c, statuses, faults, queries, releases, timers, fire,
        facts: () => facts, set: value => { facts = { ...facts, ...value }; },
        hold: value => { hold = value; }, release: value => { released = value; },
        resumes: () => resumes, pauses: () => pauses };
}
test("lock pauses once; an unlock delivered after missed locked wake still reconciles", () => {
    const f = fixture(); assert.equal(f.resumes(), 1);
    f.set({ sequence: 2 }); f.c.refresh();
    assert.equal(f.resumes(), 2); assert.equal(f.pauses(), 1);
    f.c.refresh(); assert.equal(f.resumes(), 2);
    f.set({ locked: true, sequence: 3 }); f.c.refresh(); f.c.refresh();
    assert.equal(f.c.phase, "locked"); assert.equal(f.pauses(), 2);
    f.set({ locked: false, sequence: 4 }); f.c.refresh();
    assert.equal(f.c.phase, "running"); assert.equal(f.resumes(), 3); assert.equal(f.timers.size, 0);
});
test("unknown release has three bounded attempts; a late callback cannot resume after stop", () => {
    const f = fixture(); f.release(false); f.set({ sequence: 2 }); f.c.refresh();
    f.fire(); f.fire(); assert.equal(f.c.phase, "blocked");
    assert.equal(f.releases.length, 4); assert.equal(f.timers.size, 0);
    f.release(null); f.c.refresh(); const late = f.releases.at(-1);
    f.c.stop(); late(true);
    assert.equal(f.c.phase, "stopped"); assert.equal(f.resumes(), 1); assert.equal(f.timers.size, 0);
});
test("a relock between release and final verification prevents geometry resume", () => {
    const f = fixture(); f.release(null); f.set({ sequence: 2 }); f.c.refresh();
    f.set({ locked: true, sequence: 3 }); f.releases.at(-1)(true);
    assert.equal(f.c.phase, "locked"); assert.equal(f.resumes(), 1);
});
test("session query deadline and retired Native instance fail closed", () => {
    const f = fixture(); f.hold(true); f.c.refresh(); f.fire();
    assert.equal(f.c.phase, "blocked"); assert.equal(f.c.reason, "session-query-deadline");
    f.queries[0](JSON.stringify(f.facts())); assert.equal(f.c.phase, "blocked");
    f.hold(false); f.set({ instanceId: "replacement" }); f.c.refresh();
    assert.equal(f.c.reason, "native-instance-replaced");
    f.set({ instanceId: "native" }); assert.equal(f.c.refresh(), false);
});
test("bursts of session wakes coalesce reads and discard an older in-flight observation", () => {
    const f=fixture();f.hold(true);f.c.refresh();
    for(let i=0;i<20;i++) f.c.refresh();
    assert.equal(f.queries.length,1);
    f.queries[0](JSON.stringify(f.facts()));assert.equal(f.queries.length,2);
    assert.equal(f.resumes(),1);
    f.queries[1](JSON.stringify(f.facts()));assert.equal(f.timers.size,0);
});
test("ordinary cancellation failure cannot be relabeled as lock recovery", () => {
    const f = fixture(); f.c.fault("departure-disarm", false);
    assert.equal(f.c.phase, "blocked"); assert.deepEqual(f.faults, [["departure-disarm", false]]);
    assert.equal(f.resumes(), 1);
});
test("lock related fault resumes after verified unlock without disabling the runtime", () => {
    const f = fixture(); f.set({ locked: true, sequence: 1 }); f.c.fault("departure-disarm", false);
    assert.equal(f.c.phase, "locked"); assert.equal(f.faults.length, 0);
    f.set({ locked: false, sequence: 2 }); f.c.refresh();
    assert.equal(f.c.phase, "running"); assert.equal(f.resumes(), 2);
});
test("generated entry restores layout and width after a lock; auxiliary output events do not cancel", () => {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true, PrimaryWindowCount: 3 });
    r.paintV2(); r.shortcuts.get("CCScrollCycleColumnWidth")(); r.paintV2();
    const modes = Array.from(r.state.columns, c => c.widthMode), camera = r.state.scrollOffsetX;
    const auxiliary = r.add("locker", 0, { normalWindow: false, specialWindow: true });
    const cancels = r.nativeCancels.length; auxiliary.outputChanged.emit(); auxiliary.desktopsChanged.emit();
    assert.equal(r.nativeCancels.length, cancels);
    r.sessionEvent(true); const writes = r.writes(), arms = r.nativeArms.length;
    r.shortcuts.get("CCScrollFocusNextColumn")(); r.shortcuts.get("CCScrollWorkspaceNext")();
    r.a[0].outputChanged.emit();
    assert.equal(r.writes(), writes); assert.equal(r.nativeArms.length, arms);
    assert.equal(r.state.sessionPaused, true); assert.equal(r.state.enabled, true);
    r.sessionEvent(false); r.paintV2();
    assert.equal(r.state.sessionPaused, false); assert.equal(r.state.enabled, true);
    assert.deepEqual(Array.from(r.state.columns, c => c.widthMode), modes);
    assert.equal(r.state.scrollOffsetX, camera);
    r.shortcuts.get("CCScrollFocusNextColumn")(); r.paintV2();
    assert.equal(r.workspace.activeWindow, r.a[1]);
    assert.equal(r.evaluate("sessionPause.phase"), "running");
});
test("startup while locked defers hydration and preserves the saved snapshot", () => {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true, StartLocked: true });
    assert.equal(r.writes(), 0); assert.equal(r.nativeArms.length, 0);
    assert.equal(r.evaluate("scrollLayoutInitialized"), false);
    r.sessionEvent(false); r.paintV2();
    assert.equal(r.evaluate("scrollLayoutInitialized"), true); assert.ok(r.state.columns.length > 0);
    assert.equal(r.evaluate("sessionPause.phase"), "running");
});
test("closing a window while locked removes ownership and unlock remounts only live clients", () => {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true, PrimaryWindowCount: 3 });
    r.paintV2(); r.sessionEvent(true); r.close(r.a[1]);
    r.sessionEvent(false); r.paintV2(); assert.deepEqual(r.ids(), ["a0", "a2"]);
    r.sessionEvent(true); r.evaluate("app.stop()"); const arms = r.nativeArms.length;
    r.sessionEvent(false); assert.equal(r.nativeArms.length, arms);
    assert.equal(r.evaluate("sessionPause.phase"), "stopped");
});
test("lock cancels a pending workspace request and late preparation cannot switch an output", () => {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true }); r.paintV2();
    r.evaluate('let lockTestPrepared; workspaceSwitchController.requestTo(workspace.desktops[1], {prepare: done => {lockTestPrepared=done;}})');
    assert.equal(r.state.workspaceSwitching,true);
    r.sessionEvent(true);r.evaluate('lockTestPrepared(true)');
    assert.equal(r.state.workspaceSwitching,false);assert.equal(r.workspace.currentDesktop,r.desktops[0]);
    r.sessionEvent(false);r.paintV2();assert.equal(r.state.activeWorkspaceId,"A");
});
