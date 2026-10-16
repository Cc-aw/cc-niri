"""Run in dbus-run-session; never publish to the user's desktop service."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
context = GLib.MainContext.default()
binary = str(Path(sys.argv[1]).resolve())
service = "org.cc.CCNiriBridge"
interface = "org.cc.CCNiriBridge1"
object_path = "/CCNiriBridge"
if "--legacy" in sys.argv[2:]:
    service, interface, object_path = "org.cc.ScrollDockBridge", "org.cc.ScrollDockBridge1", "/ScrollDock"
events = []


def drain(predicate, timeout=2):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        while context.pending():
            context.iteration(False)
        if predicate():
            return
        time.sleep(.005)
    assert predicate(), "signal did not arrive"


with tempfile.TemporaryDirectory(prefix="cc-niri-scroll-") as directory:
    server = None

    def start():
        global server
        server = subprocess.Popen([binary], env=dict(os.environ, XDG_STATE_HOME=directory),
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            assert server.poll() is None, "isolated Bridge failed to register"
            try:
                # Establish ownership before *any* mutation; a wrong bus must
                # never let the fixture issue calls to an existing live Bridge.
                assert int(bus.call_blocking("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionUnixProcessID", "s", (service,))) == server.pid
                return
            except dbus.DBusException:
                time.sleep(.02)
        raise AssertionError("isolated Bridge unavailable")

    def call(method, value):
        assert server.poll() is None
        assert int(bus.call_blocking("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionUnixProcessID", "s", (service,))) == server.pid
        return bool(bus.get_object(service, object_path).get_dbus_method(method, interface)(json.dumps(value)))

    def stop():
        global server
        server.terminate()
        server.wait(timeout=5)
        server = None

    try:
        start()
        for name in ["StateChanged", "MotionPlanChanged"]:
            bus.add_signal_receiver(lambda value, kind=name: events.append((kind, json.loads(str(value)))),
                                    signal_name=name, dbus_interface=interface,
                                    bus_name=service, path=object_path)
        columns = [{"uuid": key} for key in ["a", "b", "c"]]
        state = dict(protocol=2, sessionId="live", generation=0, workspaceId="A", targetOutput="eDP-1",
                     columns=columns, workspaces=[dict(id="A", columns=columns)])
        plan = dict(protocol=2, type="SCROLL", sessionId="live", workspaceId="A", targetOutput="eDP-1",
                    epoch=10, issuedAt=1000, oldScrollOffsetX=0.0, newScrollOffsetX=1260.0,
                    viewport=dict(x=24, y=50, width=2512, height=1320), entries=[
                        dict(windowId="a", columnId=1, logicalX=0, pixelWidth=1252, oldPlacement="visible", newPlacement="parked"),
                        dict(windowId="b", columnId=2, logicalX=1260, pixelWidth=1252, oldPlacement="visible", newPlacement="visible"),
                        dict(windowId="c", columnId=3, logicalX=2520, pixelWidth=1252, oldPlacement="parked", newPlacement="visible")])
        assert not call("PublishMotionPlan", plan)
        assert call("PublishState", state)
        assert call("PublishMotionPlan", plan)
        drain(lambda: len(events) == 2)
        assert events == [("StateChanged", state), ("MotionPlanChanged", plan)], "wire data/order changed"
        assert call("PublishMotionPlan", plan)
        changed = copy.deepcopy(plan)
        changed["issuedAt"] += 1
        assert not call("PublishMotionPlan", changed), "conflicting duplicate epoch"
        state["generation"] = 1
        state["workspaceId"] = "B"
        state["workspaces"] = [dict(id="B", columns=columns)]
        assert call("PublishState", state)
        assert not call("PublishMotionPlan", plan), "old workspace plan passed switch"
        changed["workspaceId"] = "B"
        changed["epoch"] = 11
        assert call("PublishMotionPlan", changed)
        drain(lambda: len(events) == 4)
        assert [kind for kind, _ in events] == ["StateChanged", "MotionPlanChanged", "StateChanged", "MotionPlanChanged"]
        stop()
        start()
        assert not call("PublishMotionPlan", changed), "cached workspace state is not live authority"
        state["sessionId"] = "reloaded"
        state["generation"] = 0
        assert call("PublishState", state)
        assert not call("PublishMotionPlan", changed), "previous session plan accepted after restart"
        changed["sessionId"] = "reloaded"
        changed["epoch"] = 0
        assert call("PublishMotionPlan", changed)
        returning = copy.deepcopy(changed)
        returning.update(epoch=1, oldScrollOffsetX=0.0, newScrollOffsetX=0.0, retargetOnly=True)
        returning["entries"] = [dict(windowId="a", columnId=1, logicalX=0, pixelWidth=1252, oldPlacement="visible", newPlacement="visible"),
                                dict(windowId="b", columnId=2, logicalX=1260, pixelWidth=1252, oldPlacement="visible", newPlacement="visible")]
        implicit = copy.deepcopy(returning)
        del implicit["retargetOnly"]
        assert not call("PublishMotionPlan", implicit), "implicit zero-offset plan accepted"
        assert call("PublishMotionPlan", returning)
        drain(lambda: ("MotionPlanChanged", returning) in events)
        assert call("PublishMotionPlan", returning), "return plan not idempotent"
        forged = copy.deepcopy(returning)
        forged.update(epoch=2, retargetOnly="true")
        assert not call("PublishMotionPlan", forged), "untyped return flag accepted"
        partial = copy.deepcopy(returning)
        partial.update(epoch=2, oldScrollOffsetX=1260.0, newScrollOffsetX=1260.0, clipPartial=True)
        partial["entries"][0].update(pixelWidth=2512)
        partial["entries"][1].update(logicalX=2520)
        malformed = copy.deepcopy(partial)
        malformed["clipPartial"] = "true"
        assert not call("PublishMotionPlan", malformed), "untyped partial flag accepted"
        missing = copy.deepcopy(partial)
        del missing["clipPartial"]
        assert not call("PublishMotionPlan", missing), "partial placement requires explicit opt-in"
        assert call("PublishMotionPlan", partial), "Full/half static clipping rejected"
        drain(lambda: ("MotionPlanChanged", partial) in events)
        assert call("PublishMotionPlan", partial), "partial snapshot not idempotent"
        width = dict(protocol=1, type="WIDE_TO_PAIR", sessionId="reloaded", epoch=3,
                     issuedAt=1002, side="right", transitionToken="partial-width",
                     targetWindowUuid="b", viewport=partial["viewport"], entries=[
                         dict(windowId="b", role="target", oldVisualRect=partial["viewport"],
                              newVisualRect=dict(x=1284, y=50, width=1252, height=1320)),
                         dict(windowId="a", role="neighbor", oldVisualRect=dict(x=-2496, y=50, width=2512, height=1320),
                              newVisualRect=dict(x=-1236, y=50, width=2512, height=1320))])
        clip = copy.deepcopy(partial)
        clip["epoch"] = width["epoch"]
        assert call("PublishMotionPlan", width)
        assert call("PublishMotionPlan", clip), "width and clipping must share the layout epoch"
        drain(lambda: ("MotionPlanChanged", clip) in events)
        assert events[-2:] == [("MotionPlanChanged", width), ("MotionPlanChanged", clip)], "Legacy timeline must arrive before clipping"
        assert call("ReportMotionComplete", dict(type="WIDE_TO_PAIR", sessionId="reloaded",
                    transitionToken="partial-width", targetWindowUuid="b")), "clipping must preserve Legacy completion"
        command = json.loads(str(bus.get_object(service, object_path).get_dbus_method("TakePendingCommand", interface)()))
        assert command["type"] == "finalize-contextual-wide-exit" and command["motionCompleted"]
        # Fixed leading inset changes neither the protocol nor its nonnegative
        # bounds. New column membership must be accepted before this motion.
        first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        single_columns = [dict(uuid=first, widthMode="half")]
        centered_state = dict(protocol=2, sessionId="single-center", generation=0,
                              workspaceId="A", targetOutput="eDP-1", columns=single_columns,
                              workspaces=[dict(id="A", columns=single_columns)])
        assert call("PublishState", centered_state)
        centered_plan = dict(protocol=2, type="SCROLL", sessionId="single-center", workspaceId="A",
                             targetOutput="eDP-1", epoch=1, issuedAt=1003,
                             oldScrollOffsetX=0, newScrollOffsetX=630, viewport=plan["viewport"], entries=[
                                 dict(windowId=first, columnId=1, logicalX=630, pixelWidth=1252,
                                      oldPlacement="visible", newPlacement="visible"),
                                 dict(windowId=second, columnId=2, logicalX=1890, pixelWidth=1252,
                                      oldPlacement="parked", newPlacement="visible")])
        assert not call("PublishMotionPlan", centered_plan), "new UUID passed before authoritative state"
        pair_columns = single_columns + [dict(uuid=second, widthMode="half")]
        centered_state.update(generation=1, columns=pair_columns, workspaces=[dict(id="A", columns=pair_columns)])
        assert call("PublishState", centered_state)
        assert call("PublishMotionPlan", centered_plan), "leading-inset 1->2 rejected"
        drain(lambda: ("MotionPlanChanged", centered_plan) in events)
        assert events[-2:] == [("StateChanged", centered_state), ("MotionPlanChanged", centered_plan)]
        centered_state.update(generation=2, columns=single_columns, workspaces=[dict(id="A", columns=single_columns)])
        assert call("PublishState", centered_state)
        center_return = copy.deepcopy(centered_plan)
        center_return.update(epoch=2, oldScrollOffsetX=630, newScrollOffsetX=0)
        center_return["entries"] = [center_return["entries"][0]]
        assert call("PublishMotionPlan", center_return), "leading-inset right removal rejected"
        negative = copy.deepcopy(center_return)
        negative.update(epoch=3, oldScrollOffsetX=-630)
        assert not call("PublishMotionPlan", negative), "negative offset became legal"
        left_insert = copy.deepcopy(centered_plan)
        left_insert.update(type="COLUMN_REINDEX", epoch=3, sourceWindowId=first, sourceLogicalX=630)
        left_insert["entries"] = [
            dict(windowId=second, columnId=2, logicalX=630, pixelWidth=1252,
                 oldPlacement="parked", newPlacement="visible"),
            dict(windowId=first, columnId=1, logicalX=1890, pixelWidth=1252,
                 oldPlacement="visible", newPlacement="visible")]
        assert not call("PublishMotionPlan", left_insert), "typed reindex passed before new membership"
        pair_columns.reverse()
        centered_state.update(generation=3, columns=pair_columns, workspaces=[dict(id="A", columns=pair_columns)])
        assert call("PublishState", centered_state)
        assert call("PublishMotionPlan", left_insert), "typed left insertion rejected"
        drain(lambda: ("MotionPlanChanged", left_insert) in events)
        assert events[-2:] == [("StateChanged", centered_state), ("MotionPlanChanged", left_insert)]
        assert call("PublishMotionPlan", left_insert), "typed duplicate not idempotent"
        malformed = copy.deepcopy(left_insert)
        malformed["sourceLogicalX"] = "630"
        assert not call("PublishMotionPlan", malformed), "untyped source basis accepted"
        malformed = copy.deepcopy(left_insert)
        malformed["sourceLogicalX"] = 631
        assert not call("PublishMotionPlan", malformed), "conflicting same epoch basis accepted"
        centered_state.update(generation=4, columns=single_columns, workspaces=[dict(id="A", columns=single_columns)])
        assert call("PublishState", centered_state)
        close_left = copy.deepcopy(center_return)
        close_left.update(type="COLUMN_REINDEX", epoch=4, sourceWindowId=first, sourceLogicalX=1890)
        assert call("PublishMotionPlan", close_left), "typed close-left center rejected"
        drain(lambda: ("MotionPlanChanged", close_left) in events)
        assert not call("PublishMotionPlan", center_return), "SCROLL bypassed shared epoch barrier"
        malformed = copy.deepcopy(close_left)
        malformed.update(epoch=5, oldScrollOffsetX=-630)
        assert not call("PublishMotionPlan", malformed), "typed wire negative offset accepted"
        ordinary = copy.deepcopy(center_return)
        ordinary.update(epoch=5, oldScrollOffsetX=0, newScrollOffsetX=630)
        assert call("PublishMotionPlan", ordinary), "canonical SCROLL after reindex rejected"
        # V2 camera-only protocol is additive; legacy SCROLL/reindex stay strict.
        centered_state.update(generation=5, columns=pair_columns, workspaces=[dict(id="A", columns=pair_columns)])
        partial3 = dict(protocol=3, type="PARTIAL_SCROLL", sessionId="single-center", workspaceId="A",
                        targetOutput="eDP-1", epoch=6, issuedAt=1004, scopeRevision=1, maxCamera=1696,
                        oldScrollOffsetX=212, newScrollOffsetX=1060, clipPartial=True,
                        viewport=dict(x=0, y=0, width=2560, height=1440),
                        layoutRect=dict(x=0, y=66, width=2560, height=1358), entries=[
                            dict(windowId=first, columnId=1, logicalX=652, pixelWidth=1680, oldPlacement="visible", newPlacement="visible"),
                            dict(windowId=second, columnId=2, logicalX=2348, pixelWidth=1256, oldPlacement="visible", newPlacement="visible")])
        assert not call("PublishMotionPlan", partial3), "partial passed before membership ACK"
        assert call("PublishState", centered_state)
        for patch in [dict(protocol=2), dict(scopeRevision=0), dict(maxCamera=100), dict(clipPartial="true"),
                      dict(layoutRect=dict(x=-1, y=66, width=2560, height=1358)),
                      dict(entries=partial3["entries"] + [partial3["entries"][0]]),
                      dict(type="COLUMN_REINDEX", sourceWindowId=first, sourceLogicalX=652)]:
            malformed = copy.deepcopy(partial3); malformed.update(patch)
            assert not call("PublishMotionPlan", malformed), "malformed partial accepted: " + str(patch)
        assert call("PublishMotionPlan", partial3)
        drain(lambda: ("MotionPlanChanged", partial3) in events)
        assert events[-2:] == [("StateChanged", centered_state), ("MotionPlanChanged", partial3)]
        assert call("PublishMotionPlan", partial3), "partial duplicate rejected"
        conflict = copy.deepcopy(partial3); conflict["scopeRevision"] = 2
        assert not call("PublishMotionPlan", conflict), "partial conflicting epoch accepted"
        assert not call("PublishMotionPlan", ordinary), "legacy bypassed partial epoch"
        for field, value in [("sessionId", "old"), ("workspaceId", "B"), ("targetOutput", "other")]:
            malformed = copy.deepcopy(partial3); malformed.update(epoch=7); malformed[field] = value
            assert not call("PublishMotionPlan", malformed), "partial scope mismatch accepted"
        returning3 = copy.deepcopy(partial3)
        returning3.update(epoch=7, oldScrollOffsetX=1060, newScrollOffsetX=212)
        assert call("PublishMotionPlan", returning3)
        drain(lambda: ("MotionPlanChanged", returning3) in events)
        focus = dict(protocol=1, type="focus-partial-column", commandId="partial-focus-test", sessionId="single-center",
                     workspaceId="A", targetOutput="eDP-1", epoch=7, scopeRevision=1, windowUuid=second, baseGeneration=5)
        for field, value in [("sessionId", "old"), ("workspaceId", "B"), ("targetOutput", "other"),
                             ("epoch", 6), ("epoch", 7.5), ("scopeRevision", "1"), ("scopeRevision", 2), ("windowUuid", "unknown")]:
            forged = copy.deepcopy(focus); forged[field] = value
            assert not call("RequestCommand", forged), "unscoped partial focus accepted"
        assert call("RequestCommand", focus)
        pending = json.loads(str(bus.get_object(service, object_path).get_dbus_method("TakePendingCommand", interface)()))
        assert pending == focus
        assert call("RequestCommand", focus), "duplicate partial focus not idempotent"
        assert not str(bus.get_object(service, object_path).get_dbus_method("TakePendingCommand", interface)()), "duplicate queued focus twice"
        print("PASS isolated PARTIAL_SCROLL v3 membership, strict schema, shared sequence, scope and reversal")
        geometry = dict(protocol=4, type="COLUMN_GEOMETRY", sessionId="single-center", workspaceId="A",
                        targetOutput="eDP-1", epoch=8, issuedAt=1005, sourceEpoch=7, sourceSampleSerial=10,
                        scopeRevision=1, oldScrollOffsetX=212, newScrollOffsetX=636,
                        oldMaxCamera=1696, maxCamera=2544, clipPartial=True,
                        viewport=dict(x=0, y=0, width=2560, height=1440),
                        oldLayoutRect=dict(x=0, y=66, width=2560, height=1358),
                        layoutRect=dict(x=0, y=66, width=2560, height=1358), entries=[
                            dict(windowId=first, columnId=1, sourceKind="painted", oldLogicalX=652,
                                 newLogicalX=652, oldPixelWidth=1680, newPixelWidth=2528,
                                 oldFrameRect=dict(x=440, y=66, width=1680, height=1358),
                                 oldVisualRect=dict(x=440, y=66, width=1680, height=1358),
                                 committedTargetRect=dict(x=16, y=66, width=2528, height=1358),
                                 oldPlacement="visible", newPlacement="visible"),
                            dict(windowId=second, columnId=2, sourceKind="painted", oldLogicalX=2348,
                                 newLogicalX=3196, oldPixelWidth=1256, newPixelWidth=1256,
                                 oldFrameRect=dict(x=1304, y=66, width=1256, height=1358),
                                 oldVisualRect=dict(x=2136, y=66, width=1256, height=1358),
                                 committedTargetRect=dict(x=1304, y=66, width=1256, height=1358),
                                 oldPlacement="visible", newPlacement="parked")])
        # Run the real JS producer, then pass its bytes through private D-Bus,
        # the shared Qt DTO and Rust validator. Handwritten DTOs alone would not
        # catch schema drift between the control plane and the Native decoder.
        generated = json.loads(subprocess.check_output(["node", str(Path(__file__).parent /
            "helpers/scroll-layout-v2-geometry-wire.js"), first, second], text=True))
        assert generated == geometry, "JS/native geometry wire contract diverged"
        geometry = generated
        geometry_columns = [dict(uuid=first, widthMode="full"), dict(uuid=second, widthMode="half")]
        centered_state.update(generation=6, columns=geometry_columns,
                              workspaces=[dict(id="A", columns=geometry_columns)])
        assert call("PublishState", centered_state), "new width membership ACK rejected"
        for field, value in [("sessionId", "old"), ("workspaceId", "B"), ("targetOutput", "other"),
                             ("sourceEpoch", 8), ("sourceSampleSerial", "10"), ("oldMaxCamera", -1),
                             ("clipPartial", "true"), ("protocol", 3)]:
            bad = copy.deepcopy(geometry); bad[field] = value
            assert not call("PublishMotionPlan", bad), "malformed geometry accepted: " + field
        for mutate in [lambda r: r.update(windowId="unknown"), lambda r: r.update(oldLogicalX="652"),
                       lambda r: r.update(oldPixelWidth=1679.99), lambda r: r["committedTargetRect"].update(x=-1),
                       lambda r: r.update(sourceKind="parked"), lambda r: r.update(sourceKind="culled"), lambda r: r.update(columnId=2)]:
            bad = copy.deepcopy(geometry); mutate(bad["entries"][0])
            assert not call("PublishMotionPlan", bad), "invalid geometry row accepted"
        assert call("PublishMotionPlan", geometry), "typed geometry membership/validator rejected"
        drain(lambda: ("MotionPlanChanged", geometry) in events)
        assert call("PublishMotionPlan", geometry), "typed geometry duplicate not idempotent"
        # Frame-ready is only a scoped wakeup; a public command cannot become
        # Native completion authority. JS must still query the Native endpoint.
        ready=dict(protocol=1,type="scroll-frame-ready",commandId="geometry-ready",sessionId="single-center",
                   baseGeneration=6,workspaceId="A",targetOutput="eDP-1",scopeRevision=1,epoch=8)
        for field,value in [("epoch",7),("scopeRevision",2),("workspaceId","other"),("targetOutput","other"),("sessionId","old")]:
            bad=copy.deepcopy(ready);bad[field]=value
            assert not call("RequestCommand",bad), "cross-scope frame wakeup accepted"
        assert call("RequestCommand",ready)
        pending=json.loads(str(bus.get_object(service,object_path).get_dbus_method("TakePendingCommand",interface)()))
        assert pending==ready
        assert call("RequestCommand",ready)
        assert not str(bus.get_object(service,object_path).get_dbus_method("TakePendingCommand",interface)())
        bad = copy.deepcopy(geometry); bad["issuedAt"] += 1
        assert not call("PublishMotionPlan", bad), "conflicting geometry replay accepted"
        assert not call("PublishMotionPlan", returning3), "partial bypassed shared geometry epoch"
        resumed = copy.deepcopy(returning3)
        resumed.update(epoch=9, maxCamera=2544, oldScrollOffsetX=636, newScrollOffsetX=1000)
        resumed["entries"][0].update(pixelWidth=2528)
        resumed["entries"][1].update(logicalX=3196, oldPlacement="parked")
        assert call("PublishMotionPlan", resumed), "partial cannot resume after geometry epoch"
        print("PASS isolated COLUMN_GEOMETRY v4 membership, Qt/Rust validation, strict source and shared epochs")
        print("PASS isolated SCROLL / typed reindex DBus payload, FIFO membership, shared epochs, duplicate, restart and source validation")
    finally:
        if server is not None:
            stop()
