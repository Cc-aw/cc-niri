"use strict";

// Standalone baseline reproducer, not a passing functional acceptance test.
// Uses the generated production entry with the existing in-memory KWin fixture.
// No D-Bus, real timers, desktop input, packages or configuration are touched.
const assert = require("node:assert/strict");
const { createRuntime } = require("../../helpers/workspace-runtime");

function scenario(name, queryDeadline, disarmDeadline) {
    const config = { ScrollLayoutV2Enabled: true, MockV2Native: true,
        PrimaryWindowCount: 0, OtherWorkspaceWindowCount: 0 };
    const r = createRuntime(config), stages = [];
    const record = stage => {
        const health = r.evaluate("({phase:sessionPause.phase,reason:sessionPause.reason," +
            "terminal:sessionPause.terminal,sawLock:sessionPause.sawLock})");
        stages.push({ stage, enabled: r.state.enabled, paused: r.state.sessionPaused,
            columns: r.state.columns.length, ...health,
            liveTimers: r.timers.filter(t => t.running).length });
    };
    const deadline = () => {
        const pending = r.timers.filter(t => t.running);
        assert.equal(pending.length, 1, "only the selected protocol deadline is live");
        pending[0].timeout.emit();
    };
    record("startup"); r.sessionEvent(true); record("locked");
    if (queryDeadline) {
        config.HoldSessionState = true;
        r.sessionEvent(false); deadline(); record("session-query-deadline");
        assert.equal(r.evaluate("sessionPause.reason"), "session-query-deadline");
        config.HoldSessionState = false;
        config.HoldV2Status = disarmDeadline;
        r.evaluate('sessionPause.refresh("activation")');
    } else {
        config.HoldV2Status = disarmDeadline;
        r.sessionEvent(false);
    }
    record("after-unlock-reconciliation");
    assert.equal(r.evaluate("sessionPause.phase"), "running");
    assert.equal(r.evaluate("sessionPause.sawLock"), false);
    if (disarmDeadline) {
        assert.equal(r.scrollStatusAcks.length, 1);
        deadline(); record("empty-disarm-deadline");
        assert.equal(r.evaluate("sessionPause.reason"), "empty-disarm");
        assert.equal(r.evaluate("sessionPause.terminal"), true);
        assert.equal(r.state.enabled, false);
        config.HoldV2Status = false;
        // The cancel was executed; its inactive status proof is only delivered late.
        r.scrollStatusAcks[0](JSON.stringify({ sessionId: r.published.at(-1).sessionId,
            epoch: -1, active: false, clipHandoffActive: false }));
        r.sessionStateAcks.forEach(reply => reply());
        r.shortcuts.get("CCScrollWorkspaceNext")();
        record("late-success-and-user-shortcut");
        assert.equal(r.evaluate("sessionPause.terminal"), true);
        assert.equal(r.state.enabled, false);
        assert.equal(r.timers.filter(t => t.running).length, 0);
    } else {
        assert.equal(r.evaluate("sessionPause.phase"), "running");
        assert.equal(r.state.enabled, true);
        assert.equal(r.timers.filter(t => t.running).length, 0);
    }
    const warnings = r.logs.filter(line => /deadline|geometry failure|blocked reason/.test(line));
    if (queryDeadline && disarmDeadline) {
        assert.equal(warnings.length, 4);
        assert.match(warnings[0], /blocked reason=session-query-deadline/);
        assert.match(warnings[1], /disarm deadline epoch=\d+ timeoutMs=150/);
        assert.match(warnings[2], /geometry failure reason=empty-disarm cancelled=false/);
        assert.match(warnings[3], /blocked reason=empty-disarm/);
    }
    r.evaluate("app.stop()");
    assert.equal(r.timers.filter(t => t.running).length, 0);
    return { name, assertionResult: "PASS", expectedBaselineFailure: disarmDeadline,
        stages, warnings };
}

console.log(JSON.stringify({
    scope: "Deterministic failure-handling reproduction with injected callback delays; " +
        "not a reproduction or measurement of historical D-Bus latency",
    scenarios: [scenario("normal-unlock", false, false),
        scenario("query-deadline-only", true, false),
        scenario("empty-disarm-deadline-only", false, true),
        scenario("historical-warning-chain", true, true)],
}, null, 2));
