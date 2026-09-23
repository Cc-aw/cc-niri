const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DockGateway } = require("../src/kwin/integration/DockGateway");

function fixture() {
    const invocations = [];
    const handled = [];
    const warnings = [];
    const debug = [];
    const snapshot = {
        targetOutput: "DP-1",
        focusedUuid: "focused",
        presentation: { windowUuid: null, mode: "normal" },
        columns: [{ uuid: "focused", widthMode: "half" }],
    };
    const gateway = new DockGateway({
        invoke: (...args) => invocations.push(args),
        service: "org.test.Bridge",
        path: "/Bridge",
        interfaceName: "org.test.Bridge1",
        snapshotProvider: () => snapshot,
        handlers: {
            "set-column-order": command => handled.push(command),
            "emergency-restore": command => handled.push(command),
            "finalize-contextual-wide": command => handled.push(command),
        },
        generationAgnosticTypes: ["finalize-contextual-wide"],
        debug: message => debug.push(message),
        warn: message => warnings.push(message),
        now: () => 0x123,
        random: () => 0.5,
    });
    return { gateway, invocations, handled, warnings, debug, snapshot };
}

{
    const { gateway, handled } = fixture();
    const command = gateway.commandEnvelope({
        commandId: "contextual-1",
        type: "finalize-contextual-wide",
        transitionToken: "1",
        windowUuid: "focused",
    });
    gateway.commit({ columns: [] }, "intervening-state");
    assert.equal(gateway.dispatch(command), true,
        "token-checked internal motion finalizers survive unrelated dock generations");
    assert.deepEqual(handled, [command]);
}

{
    const { gateway, invocations, snapshot, debug } = fixture();
    assert.equal(gateway.sessionId(), "123-80000000");
    assert.equal(gateway.generation(), 0);
    const first = gateway.publish(snapshot, "initial");
    assert.equal(first.protocol, 1);
    assert.equal(first.sessionId, "123-80000000");
    assert.equal(first.generation, 0);
    assert.equal(invocations[0][3], "PublishState");
    assert.deepEqual(JSON.parse(invocations[0][4]), first);
    invocations[0][5](true);
    assert.ok(debug[0].includes("generation=0 columns=1 accepted=true"));

    const committed = gateway.commit(snapshot, "changed");
    assert.equal(gateway.generation(), 1);
    assert.equal(committed.generation, 1);
}

{
    const { gateway, invocations } = fixture();
    const envelope = gateway.requestDeferred({
        protocol: 99,
        sessionId: "spoofed",
        commandId: "deferred-1",
        type: "emergency-restore",
    }, 50, () => {});
    assert.equal(envelope.protocol, 1);
    assert.equal(envelope.sessionId, gateway.sessionId());
    assert.equal(envelope.baseGeneration, 0);
    assert.equal(invocations[0][3], "RequestDeferredCommand");
    assert.equal(invocations[0][5], 50);
    assert.deepEqual(JSON.parse(invocations[0][4]), envelope);
    const future = gateway.commandEnvelope({
        commandId: "future",
        type: "emergency-restore",
        baseGeneration: 2,
    });
    assert.equal(future.baseGeneration, 2,
        "Wide may target the generation committed immediately after reveal");
}

{
    const { gateway, handled } = fixture();
    const command = {
        protocol: 1,
        commandId: "command-1",
        sessionId: gateway.sessionId(),
        baseGeneration: gateway.generation(),
        type: "set-column-order",
        order: ["focused"],
    };
    assert.equal(gateway.acceptPendingJson(JSON.stringify(command)), true);
    assert.deepEqual(handled, [command]);
}

for (const [json, reason] of [
    ["{", "invalid-json"],
    [JSON.stringify({ protocol: 1, commandId: "x", type: "unknown" }),
        "invalid-schema"],
]) {
    const { gateway, warnings, invocations } = fixture();
    assert.equal(gateway.acceptPendingJson(json), false);
    assert.ok(warnings[0].includes(reason));
    assert.equal(invocations.at(-1)[3], "PublishState",
        "a rejection republishes the canonical snapshot");
}

{
    const { gateway, warnings } = fixture();
    const base = {
        protocol: 1,
        commandId: "command-2",
        type: "emergency-restore",
        sessionId: gateway.sessionId(),
        baseGeneration: gateway.generation(),
    };
    assert.equal(gateway.dispatch({ ...base, sessionId: "stale" }), false);
    assert.ok(warnings.at(-1).includes("session-mismatch"));
    assert.equal(gateway.dispatch({ ...base, baseGeneration: 9 }), false);
    assert.ok(warnings.at(-1).includes("stale-generation"));
    assert.equal(gateway.dispatch({ ...base, type: "toString" }), false,
        "prototype properties are not valid command handlers");
    assert.ok(warnings.at(-1).includes("invalid-schema"));
}

{
    const { gateway, invocations } = fixture();
    gateway.takePendingCommand();
    assert.equal(invocations[0][3], "TakePendingCommand");
    assert.equal(typeof invocations[0][4], "function");
}

{
    const { gateway, invocations } = fixture();
    gateway.publishMotionPlan({ epoch: 9, type: "PAIR_TO_WIDE", entries: [] },
        () => {});
    assert.equal(invocations[0][3], "PublishMotionPlan");
    const payload = JSON.parse(invocations[0][4]);
    assert.equal(payload.protocol, 1);
    assert.equal(payload.sessionId, gateway.sessionId());
    assert.equal(payload.epoch, 9);
    gateway.reportMotionParked({
        type: "PAIR_TO_WIDE", transitionToken: "edge-1",
        targetWindowUuid: "focused",
    }, () => {});
    assert.equal(invocations[1][3], "ReportMotionParked");
    const parked = JSON.parse(invocations[1][4]);
    assert.equal(parked.sessionId, gateway.sessionId());
    assert.equal(parked.transitionToken, "edge-1");
}

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);
const applicationSource = mainSource.slice(
    mainSource.indexOf("/* END GENERATED KWIN MODULES */")
);
assert.equal(applicationSource.includes("dockSessionId"), false);
assert.equal(applicationSource.includes("dockGeneration"), false);
assert.equal(applicationSource.includes("callDBus("), false,
    "business code sends Bridge traffic through DockGateway");
assert.ok(applicationSource.includes(
    "return dockGateway.takePendingCommand()"
));

console.log("PASS DockGateway owns session, generation, schema, and transport");
