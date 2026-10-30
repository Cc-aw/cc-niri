"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { SessionPauseController } = require("../src/kwin/runtime/SessionPauseController");
const { createRuntime } = require("./helpers/workspace-runtime");

function fixture() {
    const timers = new Set(), layouts = [], releases = [], statuses = [], faults = [], reads = [];
    let holdRelease = false, holdRead = false;
    let facts = { protocol: 1, type: "session-state", instanceId: "native", sequence: 0, locked: false };
    const c = new SessionPauseController({
        readState: done => { if (holdRead) reads.push(done); else done({ ...facts }); },
        release: done => { releases.push(done); if (!holdRelease) done(true); },
        onResume: done => layouts.push(done), onPause() {},
        onFault: (...args) => faults.push(args), health: s => statuses.push(s), warn() {},
        setTimer: (fn, ms) => { const timer = { fn, ms }; timers.add(timer); return timer; },
        clearTimer: timer => timers.delete(timer),
    });
    const fire = ms => {
        const timer = [...timers].find(t => t.ms === ms);
        assert.ok(timer, `expected ${ms}ms deadline`);
        timers.delete(timer); timer.fn();
    };
    c.refresh("startup"); layouts.at(-1)(true);
    const event = locked => {
        if (facts.locked !== locked) facts = { ...facts, locked, sequence: facts.sequence + 1 };
        c.refresh("session-event");
    };
    return { c, timers, layouts, releases, statuses, faults, reads, fire, event,
        set: value => { facts = { ...facts, ...value }; }, facts: () => ({ ...facts }),
        holdRelease: value => { holdRelease = value; }, holdRead: value => { holdRead = value; } };
}

test("unlock stays resuming until layout proof and a fresh unlocked observation", () => {
    const f = fixture(); f.event(true); f.event(false);
    const done = f.layouts.at(-1);
    assert.equal(f.c.phase, "resuming"); assert.equal(f.c.sawLock, true);
    f.holdRead(true); done(true);
    assert.equal(f.c.phase, "resuming"); assert.equal(f.reads.length, 1);
    f.reads[0](f.facts());
    assert.equal(f.c.phase, "running"); assert.equal(f.c.sawLock, false);
    assert.equal(f.c.resume, null); assert.equal(f.timers.size, 0);
    done(false); assert.equal(f.c.phase, "running");
});

test("activation wakes during release and layout neither restart recovery nor retire its proof", () => {
    const f = fixture(); f.event(true); f.holdRelease(true); f.event(false);
    const release = f.releases.at(-1), count = f.releases.length;
    for (let i = 0; i < 50; ++i) f.c.refresh("activation");
    assert.equal(f.releases.length, count);
    release(true); const done = f.layouts.at(-1);
    for (let i = 0; i < 50; ++i) f.c.refresh("activation");
    assert.equal(f.c.resumeAttempts, 1); assert.equal(f.layouts.length, 2);
    done(true); assert.equal(f.c.phase, "running"); assert.equal(f.timers.size, 0);
});

test("relock and a new cycle retire old completion and deadline without losing the new deadline", () => {
    const f = fixture(); f.event(true); f.event(false);
    const oldDone = f.layouts.at(-1), oldTimer = [...f.timers][0];
    f.event(true); oldDone(true); assert.equal(f.c.phase, "locked");
    f.event(false); const current = [...f.timers][0];
    oldTimer.fn(); oldDone(false);
    assert.equal(f.c.resumeTimer, current); assert.equal(f.timers.size, 1);
    f.c.stop(); f.layouts.at(-1)(true); current.fn();
    assert.equal(f.c.phase, "stopped"); assert.equal(f.timers.size, 0);
});

test("persistent unlock reconciliation failures consume one finite budget across user wakes", () => {
    const f = fixture(); f.event(true); f.event(false);
    for (let i = 0; i < 3; ++i) f.fire(4000);
    assert.equal(f.c.phase, "blocked"); assert.equal(f.c.reason, "resume-attempts-exhausted");
    const layouts = f.layouts.length, releases = f.releases.length;
    for (let i = 0; i < 50; ++i) f.c.refresh("shortcut");
    assert.equal(f.layouts.length, layouts); assert.equal(f.releases.length, releases);
    assert.equal(f.timers.size, 0); assert.equal(f.faults.length, 0);
    // Only a genuinely newer lock cycle opens another bounded budget.
    f.event(true); f.event(false); f.layouts.at(-1)(true);
    assert.equal(f.c.phase, "running"); assert.equal(f.timers.size, 0);
});

test("final verification observes a missed relock, and Native replacement remains terminal", () => {
    const f = fixture(); f.event(true); f.event(false);
    f.set({ locked: true, sequence: 3 }); f.layouts.at(-1)(true);
    assert.equal(f.c.phase, "locked");
    f.event(false); f.set({ instanceId: "replacement" }); f.layouts.at(-1)(true);
    assert.equal(f.c.reason, "native-instance-replaced"); assert.equal(f.c.terminal, true);
    assert.equal(f.c.paused, true); assert.equal(f.timers.size, 0);
});

test("query deadline during layout retires completion, and ordinary post-recovery faults still stop", () => {
    const f = fixture(); f.event(true); f.event(false);
    const oldDone = f.layouts.at(-1);
    f.holdRead(true); f.c.refresh("activation"); f.fire(500);
    oldDone(true); assert.equal(f.c.phase, "blocked"); assert.equal(f.c.paused, true);
    f.holdRead(false); f.c.refresh("shortcut"); f.layouts.at(-1)(true);
    assert.equal(f.c.phase, "running");
    f.c.fault("ordinary-disarm", false);
    assert.equal(f.c.terminal, true); assert.deepEqual(f.faults, [["ordinary-disarm", false]]);
    f.reads[0](f.facts()); assert.equal(f.c.phase, "blocked"); assert.equal(f.timers.size, 0);
});

test("a synchronous empty proof cannot publish ready before remaining mount work rejects", () => {
    const f = fixture(); f.event(true);
    const running = f.statuses.filter(s => s.state === "running").length;
    f.c.onResume = done => {
        done(true);
        assert.equal(f.c.phase, "resuming");
        assert.equal(f.c.sawLock, true);
        return false;
    };
    f.event(false);
    assert.equal(f.c.phase, "blocked"); assert.equal(f.c.paused, true);
    assert.equal(f.c.reason, "resume-attempts-exhausted");
    assert.equal(f.statuses.filter(s => s.state === "running").length, running);
    assert.equal(f.timers.size, 0);
});

function emptyRuntime() {
    const config = { ScrollLayoutV2Enabled: true, MockV2Native: true,
        PrimaryWindowCount: 0, OtherWorkspaceWindowCount: 0 };
    const r = createRuntime(config);
    const fire = ms => {
        const pending = r.timers.filter(t => t.running && t.interval === ms);
        assert.equal(pending.length, 1, `expected one ${ms}ms deadline`);
        if (pending[0].singleShot) pending[0].running = false;
        pending[0].timeout.emit();
    };
    const proof = () => JSON.stringify({ sessionId: r.published.at(-1).sessionId,
        epoch: -1, active: false, clipHandoffActive: false });
    return { r, config, fire, proof };
}

test("real entry recovers historical query plus empty-disarm deadlines only after a new cancel proof", () => {
    const { r, config, fire, proof } = emptyRuntime();
    r.sessionEvent(true); config.HoldSessionState = true; r.sessionEvent(false); fire(500);
    assert.equal(r.evaluate("sessionPause.reason"), "session-query-deadline");
    config.HoldSessionState = false; config.HoldV2Status = true;
    r.evaluate('sessionPause.refresh("activation")');
    assert.equal(r.evaluate("sessionPause.phase"), "resuming");
    fire(150);
    assert.equal(r.state.enabled, true); assert.equal(r.state.sessionPaused, true);
    const publications = r.published.length, writes = r.writes();
    assert.equal(r.scrollStatusAcks.length, 2);
    r.scrollStatusAcks[0](proof());
    assert.equal(r.published.length, publications); assert.equal(r.writes(), writes);
    assert.equal(r.evaluate("sessionPause.phase"), "resuming");
    config.HoldV2Status = false; r.scrollStatusAcks[1](proof());
    r.sessionStateAcks.forEach(reply => reply());
    assert.equal(r.evaluate("sessionPause.phase"), "running");
    assert.equal(r.evaluate("sessionPause.terminal"), false);
    assert.equal(r.state.enabled, true); assert.equal(r.state.sessionPaused, false);
    assert.equal(r.timers.filter(t => t.running).length, 0);
});

test("real entry unknown ownership stays paused with bounded retries; stop makes late proofs inert", () => {
    const { r, config, fire, proof } = emptyRuntime();
    r.sessionEvent(true); config.HoldV2Status = true; r.sessionEvent(false); fire(150);
    fire(500); fire(0); fire(500);
    assert.equal(r.evaluate("sessionPause.phase"), "blocked");
    assert.equal(r.state.sessionPaused, true); assert.equal(r.state.enabled, true);
    const cancels = r.nativeCancels.length, writes = r.writes(), publications = r.published.length;
    for (let i = 0; i < 50; ++i) r.shortcuts.get("CCScrollWorkspaceNext")();
    assert.equal(r.nativeCancels.length, cancels); assert.equal(r.writes(), writes);
    assert.equal(r.published.length, publications);
    const late = [...r.scrollStatusAcks]; config.HoldV2Status = false;
    r.evaluate("app.stop()"); const afterStop = r.published.length;
    late.forEach(reply => reply(proof()));
    assert.equal(r.evaluate("sessionPause.phase"), "stopped");
    assert.equal(r.published.length, afterStop); assert.equal(r.writes(), writes);
    assert.equal(r.timers.filter(t => t.running).length, 0);
});

test("real entry waits for current painted layout after relock and preserves fullscreen suspension", () => {
    const r = createRuntime({ ScrollLayoutV2Enabled: true, MockV2Native: true, PrimaryWindowCount: 2 });
    assert.equal(r.evaluate("sessionPause.phase"), "resuming"); r.paintV2();
    assert.equal(r.evaluate("sessionPause.phase"), "running");
    r.sessionEvent(true); r.sessionEvent(false);
    assert.equal(r.evaluate("sessionPause.phase"), "resuming");
    const oldDeadline = r.timers.find(t => t.running && t.interval === 4000);
    r.sessionEvent(true); oldDeadline.timeout.emit();
    assert.equal(r.evaluate("sessionPause.phase"), "locked");
    r.sessionEvent(false); r.paintV2(); assert.equal(r.evaluate("sessionPause.phase"), "running");
    r.sessionEvent(true); r.a[0].fullScreen = true; r.sessionEvent(false);
    assert.equal(r.evaluate("sessionPause.phase"), "running");
    assert.equal(r.state.enabled, true); assert.equal(r.state.sessionPaused, false);
    assert.equal(r.timers.filter(t => t.running).length, 0);
});
