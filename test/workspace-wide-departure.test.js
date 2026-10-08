"use strict";

const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");

// Real layout bundle: Pair keeps the outgoing neighbor at its half-width real
// rectangle while the Effect moves/fades it. Keep it for Slide's frozen pose,
// then settle the sleeping workspace through the compositor-idle gate.
for (const side of [0, 1]) for (const acknowledged of [false, true]) {
    for (const departure of ["J", "K", "native", "rejected"]) {
        const r = createRuntime({ HoldWorkspaceTransitionAck: true, HoldWidthAck: true });
        const fromB = departure === "K";
        if (fromB) r.nativeSwitch(1, r.b[0]);
        const source = fromB ? r.b : r.a;
        const owner = source[side], neighbor = source[1 - side];
        r.workspace.activeWindow = owner;
        const pair = source.slice(0, 2).map(window => ({ ...window.frameGeometry }));
        r.evaluate("toggleFocusWide(workspace.activeWindow)");
        assert.equal(r.motionPlans.at(-1).type, "PAIR_TO_WIDE");
        const ack = r.motionAcks.at(-1);
        if (acknowledged) ack(true);
        const wide = { ...owner.frameGeometry };
        const pending = r.evaluate("contextualWideCoordinator.pendingPark");
        const timer = pending.timer;
        const command = { transitionToken: pending.token, commandId: pending.commandId,
            motionCompleted: true };
        assert.equal(neighbor.opacity, 1, "neighbor remains visible during normal expansion");
        if (acknowledged) assert.ok(wide.width > pair[side].width);

        // Observe the physical parking handoff after compositor idle, so no
        // transform is exposed on an unparked neighbor.
        let reports = 0;
        let handoff;
        const report = r.evaluate("runtimeBridge.reportMotionParked.bind(runtimeBridge)");
        r.evaluate("runtimeBridge").reportMotionParked = (data, callback) => {
            ++reports;
            handoff = { opacity: neighbor.opacity, minimized: neighbor.minimized,
                neighbor: { ...neighbor.frameGeometry }, owner: { ...owner.frameGeometry },
                pair: source.slice(0, 2).map(window => ({ ...window.frameGeometry })) };
            report(data, callback);
        };
        const destination = fromB ? 0 : 1;
        const destinationOwner = fromB ? r.a[0] : r.b[0];
        if (departure === "native") {
            r.nativeSwitch(destination, destinationOwner);
        } else {
            r.workspace.setCurrentDesktopForScreen = (desktop, output) => {
                assert.equal(output, r.output);
                assert.equal(reports, acknowledged ? 0 : 1, "committed Wide stays intact for the actual J/K request");
                assert.equal(neighbor.opacity, 1, "do not drop the source neighbor before Slide");
                if (departure === "rejected") throw new Error("simulated desktop request rejection");
                r.nativeSwitch(r.desktops.indexOf(desktop), destinationOwner);
            };
            r.shortcuts.get(fromB ? "CCScrollWorkspacePrevious" : "CCScrollWorkspaceNext")();
        }
        assert.equal(reports, acknowledged ? 0 : 1);
        if (acknowledged && departure !== "rejected") {
            const pendingDeparture = [...r.evaluate("contextualWideCoordinator.departures")][0];
            assert.ok(pendingDeparture);
            assert.equal(neighbor.opacity, 1, "keep the real neighbor until Slide completes");
            pendingDeparture.timer.callback();
            const oldReply = r.workspaceTransitionAcks.at(-1);
            oldReply(true);
            assert.equal(neighbor.opacity, 1, "active Slide cannot commit parking");
            pendingDeparture.timer.callback();
            r.workspaceTransitionAcks.at(-1)(false);
            assert.equal(reports, 1);
            const settledWrites = r.writes();
            oldReply(false);
            assert.equal(r.writes(), settledWrites, "late idle reply cannot repeat parking");
            assert.equal(handoff.opacity, 0, "park neighbor before releasing its visual isolation");
            assert.ok(handoff.neighbor.x + handoff.neighbor.width <= r.output.geometry.x,
                "outgoing neighbor has a real offscreen parking rectangle");
            assert.equal(handoff.minimized, true);
            assert.deepEqual(handoff.owner, wide, "settling does not resize the Wide owner");
        } else if (!acknowledged) {
            assert.deepEqual(handoff.pair, pair, "an uncommitted plan cannot park an actual Pair neighbor");
            assert.equal(handoff.opacity, 1);
        } else {
            const pendingDeparture = [...r.evaluate("contextualWideCoordinator.departures")][0];
            pendingDeparture.timer.callback();
            assert.equal(r.evaluate("contextualWideCoordinator.departures.size"), 0,
                "a rejected desktop request retires departure without a late parking write");
        }
        assert.equal(r.evaluate("contextualWideCoordinator.pendingPark"), null);
        const writes = r.writes();
        ack(true);
        if (timer) timer.callback();
        assert.equal(r.evaluate("contextualWideCoordinator").finalizePark(command), false);
        assert.equal(r.writes(), writes, "late ACK/timer/completion cannot mutate either desktop");
        assert.equal(reports, acknowledged && departure === "rejected" ? 0 : 1,
            "cancelled handoff is not reported twice");
        if (departure !== "rejected") r.nativeSwitch(fromB ? 1 : 0, owner);
        assert.equal(r.state.viewport.mode, "wide-focus");
        assert.equal(neighbor.opacity, 0, "return restores Wide without reviving its neighbor");
        assert.equal(r.evaluate("invariantChecker.errors().length"), 0);
    }
}

// Returning, moving, closing or stopping while an idle query is in flight
// must invalidate its permission to write the old neighbor's geometry.
for (const change of ["return", "move", "close", "close-owner", "stop"]) {
    const r = createRuntime({ HoldWorkspaceTransitionAck: true, HoldWidthAck: true });
    r.evaluate("toggleFocusWide(workspace.activeWindow)"); r.motionAcks.at(-1)(true);
    r.nativeSwitch(1, r.b[0]);
    const pending = [...r.evaluate("contextualWideCoordinator.departures")][0];
    pending.timer.callback();
    const reply = r.workspaceTransitionAcks.at(-1);
    if (change === "return") r.nativeSwitch(0, r.a[0]);
    if (change === "move") r.move(r.a[1], ["B"]);
    if (change === "close") r.close(r.a[1]);
    if (change === "close-owner") r.close(r.a[0]);
    if (change === "stop") r.evaluate('emergencyRestoreAllWindows("test-stop")');
    const writes = r.writes(); reply(false);
    assert.equal(r.writes(), writes, `${change} retires the old workspace parking callback`);
    assert.equal(r.evaluate("contextualWideCoordinator.departures.size"), 0);
}
console.log("PASS Wide workspace parking waits for compositor idle; J/K/native, both sides, ACKs, stale queries, rejected requests and lifecycle cancellation");
