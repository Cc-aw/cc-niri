"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { StabilitySupervisor } =
    require("../src/kwin/stability/StabilitySupervisor");

const runtimeSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8");
assert.ok(runtimeSource.includes("audit: (reason, epoch) => stabilitySupervisor.audit(reason, epoch)"),
    "transaction audits must reach the supervisor");
assert.ok(runtimeSource.includes("stabilitySupervisor.stop();\n    return recovery.restoreAll(reason);"),
    "manual emergency restore must cancel pending supervisor timers");

function harness(initialErrors) {
    let errors = initialErrors;
    let enabled = true;
    let relayouts = 0;
    let restores = 0;
    let enabledAtRestore = null;
    const timers = [];
    const warnings = [];
    const supervisor = new StabilitySupervisor({
        checker: {
            check: () => errors.length === 0,
            errors: () => errors,
        },
        setTimer: callback => {
            const timer = { callback, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimer: timer => { timer.cleared = true; },
        relayout: () => { relayouts += 1; },
        recovery: { restoreAll: () => {
            restores += 1;
            enabledAtRestore = enabled;
        } },
        disableLayout: () => { enabled = false; },
        isEnabled: () => enabled,
        warn: message => warnings.push(message),
        debug: () => {},
    });
    return {
        supervisor,
        setErrors: next => { errors = next; },
        fire: index => timers[index].callback(),
        timers,
        warnings,
        snapshot: () => ({ enabled, relayouts, restores, enabledAtRestore }),
    };
}

{
    const h = harness(["focus-index:9"]);
    assert.equal(h.supervisor.audit("test", 1), false);
    h.setErrors([]);
    h.fire(0);
    assert.deepEqual(h.snapshot(), {
        enabled: true, relayouts: 0, restores: 0, enabledAtRestore: null,
    });
    assert.equal(h.supervisor.phase, "normal");
}

{
    const h = harness(["focus-index:9"]);
    h.supervisor.audit("test", 1);
    h.fire(0);
    assert.equal(h.snapshot().relayouts, 1);
    h.setErrors([]);
    h.fire(1);
    assert.equal(h.snapshot().restores, 0);
    assert.equal(h.supervisor.phase, "normal");
    assert.ok(h.warnings.some(message => message.includes("SELF_HEAL_RECOVERED")));
}

{
    const h = harness(["focus-index:9"]);
    h.supervisor.audit("test", 1);
    h.fire(0);
    h.fire(1);
    assert.deepEqual(h.snapshot(), {
        enabled: false, relayouts: 1, restores: 1, enabledAtRestore: false,
    });
    h.supervisor.audit("after-restore", 2);
    h.fire(1);
    assert.equal(h.snapshot().restores, 1, "recovery is latched");
}

{
    const h = harness(["duplicate-window:1"]);
    h.supervisor.audit("test", 1);
    h.fire(0);
    assert.equal(h.snapshot().relayouts, 0, "critical model errors skip relayout");
    assert.equal(h.snapshot().restores, 1);
}

{
    const h = harness(["focus-index:9"]);
    h.supervisor.audit("old", 1);
    h.setErrors([]);
    h.supervisor.audit("new", 2);
    assert.equal(h.timers[0].cleared, true);
    h.setErrors(["focus-index:9"]);
    h.fire(0);
    assert.equal(h.snapshot().restores, 0, "stale timer cannot recover new epoch");
    assert.equal(h.snapshot().relayouts, 0);
}

{
    const h = harness(["focus-index:9"]);
    h.supervisor.audit("test", 1);
    h.supervisor.stop();
    h.fire(0);
    assert.equal(h.snapshot().restores, 0, "manual stop cancels pending audit");
    assert.equal(h.supervisor.phase, "disabled");
}

console.log("PASS stability supervisor delayed verification and fail-safe");
