const assert = require("node:assert/strict");
const { ContextualWideCoordinator } =
    require("../src/kwin/presentation/ContextualWideCoordinator");

function fixture() {
    const left = { id: 1, window: { internalId: "left" } };
    const right = { id: 2, window: { internalId: "right" } };
    const state = {
        columns: [left, right], innerGap: 8, scrollOffsetX: 0,
        focusedColumnIndex: 0,
        viewport: { mode: "pair", wideColumnId: null },
        presentation: { mode: "normal" },
    };
    const requests = [];
    const relayouts = [];
    const parked = [];
    const activated = [];
    const timers = [];
    let geometryMatches = true;
    const gateway = {
        sessionId: () => "session",
        requestDeferred: (command, delay, callback) =>
            requests.push({ command, delay, callback }),
        reportMotionParked: (data, callback) => {
            parked.push(data);
            callback(true);
        },
    };
    const coordinator = new ContextualWideCoordinator({
        appState: state, gateway,
        projectedRectForColumn: column => ({
            x: column === left ? 0 : 108, y: 0, width: 100, height: 100,
        }),
        isFullyVisible: () => true,
        sameRectNear: () => geometryMatches,
        presentationRect: () => ({ x: 0, y: 0, width: 144, height: 100 }),
        normalizeUuid: value => value,
        relayout: (...args) => relayouts.push(args),
        setActiveWindow: window => activated.push(window),
        setTimer: callback => {
            const timer = { callback, cancelled: false };
            timers.push(timer);
            return timer;
        },
        clearTimer: timer => { timer.cancelled = true; },
        debug: () => {}, warn: () => {},
        parkGraceMs: 500, retryMs: 50, maxAttempts: 20,
    });
    return { coordinator, state, left, right, requests, relayouts, parked, timers,
        activated, setGeometryMatches: value => { geometryMatches = value; } };
}

{
    const h = fixture();
    h.state.viewport = { mode: "wide-focus", wideColumnId: 1 };
    h.coordinator.prepareLayoutTransition(h.left);
    assert.equal(h.coordinator.retainedNeighbor(), h.right);
    assert.equal(h.coordinator.parkToken(), "1");
    h.coordinator.onPlanCommitted({ windows: [] }, null,
        { heldIncoming: [] }, null);
    assert.equal(h.requests.length, 1);
    assert.equal(h.timers.length, 1);
    assert.equal(h.coordinator.finalizePark({ transitionToken: "bad" }), false);
    h.coordinator.finalizePark(h.requests[0].command);
    assert.equal(h.requests[1].delay, 500);
    assert.equal(h.coordinator.retainedNeighbor(), h.right);
    h.coordinator.finalizePark({ ...h.requests[1].command,
        motionCompleted: true });
    assert.equal(h.coordinator.retainedNeighbor(), null);
    assert.equal(h.relayouts[0][0], "contextual-wide-park");
    assert.equal(h.parked.length, 1);
    h.timers[0].callback();
    assert.equal(h.parked.length, 1, "late deferred command is harmless");
}

{
    const h = fixture();
    h.state.viewport = { mode: "wide-focus", wideColumnId: 1 };
    h.coordinator.onPlanCommitted({ windows: [] }, null,
        { heldIncoming: [] }, null);
    h.state.viewport = { mode: "pair", wideColumnId: null };
    assert.equal(h.coordinator.wideExitColumn(), h.left);
    const plan = { windows: [{ column: h.left, rect: { x: 0 } }] };
    h.coordinator.onPlanCommitted(plan, h.left,
        { heldIncoming: [h.left] }, h.left.window);
    assert.equal(h.coordinator.isActivationDeferred(), true);
    assert.equal(h.coordinator.finalizeExit({ transitionToken: "bad" }), false);
    h.setGeometryMatches(false);
    h.coordinator.finalizeExit(h.requests[0].command);
    assert.equal(h.requests.length, 2, "geometry ACK retries");
    h.setGeometryMatches(true);
    h.coordinator.finalizeExit(h.requests[1].command);
    assert.equal(h.coordinator.isActivationDeferred(), false);
    assert.deepEqual(h.activated, [h.left.window]);
    assert.equal(h.relayouts[0][0], "contextual-wide-exit-ack");
    h.coordinator.finalizeExit(h.requests[1].command);
    assert.equal(h.activated.length, 1, "late ACK is ignored");
}

{
    const h = fixture();
    h.state.viewport = { mode: "wide-focus", wideColumnId: 1 };
    h.coordinator.prepareLayoutTransition(h.left);
    h.coordinator.onPlanCommitted({ windows: [] }, null,
        { heldIncoming: [] }, null);
    h.timers[0].callback();
    assert.equal(h.requests.length, 2,
        "missing Bridge command falls back to local geometry check");
    h.timers[1].callback();
    assert.equal(h.parked.length, 1);
    h.coordinator.finalizePark(h.requests[0].command);
    assert.equal(h.parked.length, 1);
}

{
    const h = fixture();
    h.state.viewport = { mode: "wide-focus", wideColumnId: 1 };
    h.coordinator.prepareLayoutTransition(h.left);
    h.coordinator.cancelForWindow(h.right.window);
    assert.equal(h.coordinator.retainedNeighbor(), null);
    h.coordinator.prepareLayoutTransition(h.left);
    h.coordinator.cancel();
    assert.equal(h.coordinator.finalizePark({ transitionToken: "2" }), false);
}

console.log("PASS ContextualWideCoordinator owns parking and exit lifecycles");
