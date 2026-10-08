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
service = "org.cc.ScrollDockBridge"
interface = "org.cc.ScrollDockBridge1"
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
        return bool(bus.get_object(service, "/ScrollDock").get_dbus_method(method, interface)(json.dumps(value)))

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
                                    bus_name=service, path="/ScrollDock")
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
        command = json.loads(str(bus.get_object(service, "/ScrollDock").get_dbus_method("TakePendingCommand", interface)()))
        assert command["type"] == "finalize-contextual-wide-exit" and command["motionCompleted"]
        print("PASS isolated SCROLL DBus payload, FIFO authority, duplicate, workspace, restart and explicit return")
    finally:
        if server is not None:
            stop()
