"""Run in dbus-run-session: canonical and legacy transports share one Bridge."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
context = GLib.MainContext.default()
canonical = ("org.cc.CCNiriBridge", "/CCNiriBridge", "org.cc.CCNiriBridge1")
legacy = ("org.cc.ScrollDockBridge", "/ScrollDock", "org.cc.ScrollDockBridge1")

if sys.argv[1] == "--legacy-peer":
    class OldBridge(dbus.service.Object):
        @dbus.service.method(legacy[2], in_signature="", out_signature="s")
        def GetState(self):
            return Path(sys.argv[2]).read_text()
    name = dbus.service.BusName(legacy[0], bus=bus, do_not_queue=True)
    peer = OldBridge(bus, legacy[1])
    GLib.MainLoop().run()
    sys.exit(0)

binary = str(Path(sys.argv[1]).resolve())

def call(endpoint, method, *args):
    service, path, interface = endpoint
    return bus.get_object(service, path).get_dbus_method(method, interface)(*args)

def wait(predicate):
    end = time.monotonic() + 3
    while time.monotonic() < end:
        while context.pending():
            context.iteration(False)
        if predicate():
            return
        time.sleep(.01)
    assert predicate(), "Bridge did not become ready / signal did not arrive"

with tempfile.TemporaryDirectory(prefix="cc-niri-bridge-compat-") as directory:
    environment = dict(os.environ, XDG_STATE_HOME=directory)
    cache = Path(directory, "cc-niri/workspaces.json")
    state = {"protocol": 1, "sessionId": "p8", "generation": 1,
             "targetOutput": "DP-1", "columns": [{"uuid": "a", "widthMode": "full"}]}
    peer_file = Path(directory, "legacy-state.json")
    peer_file.write_text(json.dumps(state))
    process = None
    subscriptions = []
    try:
        # A genuine legacy-only D-Bus peer: canonical GetState must fall back.
        process = subprocess.Popen([sys.executable, __file__, "--legacy-peer", str(peer_file)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait(lambda: bus.name_has_owner(legacy[0]))
        assert not bus.name_has_owner(canonical[0])
        subprocess.run([binary, "--save-current-state"], env=environment, check=True)
        assert json.loads(cache.read_text()) == state
        # A competing legacy owner prevents a second Bridge from remaining live.
        duplicate = subprocess.run([binary], env=environment, timeout=3, capture_output=True)
        assert duplicate.returncode == 3
        assert not bus.name_has_owner(canonical[0])
        process.terminate(); process.wait(timeout=3); process = None
        wait(lambda: not bus.name_has_owner(legacy[0]))

        process = subprocess.Popen([binary], env=environment)
        wait(lambda: bus.name_has_owner(canonical[0]) and bus.name_has_owner(legacy[0]))
        assert bus.get_name_owner(canonical[0]) == bus.get_name_owner(legacy[0])
        assert json.loads(str(call(canonical, "GetState"))) == state
        assert call(canonical, "GetState") == call(legacy, "GetState")
        # Durable cached data does not establish a second live session.
        assert not call(legacy, "RequestEmergencyRestore")
        signals = {canonical[0]: [], legacy[0]: []}
        for endpoint in (canonical, legacy):
            service, path, interface = endpoint
            subscriptions.append(bus.add_signal_receiver(
                lambda value, service=service: signals[service].append(json.loads(str(value))),
                signal_name="StateChanged", dbus_interface=interface, bus_name=service, path=path))
        assert call(legacy, "PublishState", json.dumps(state))
        wait(lambda: all(len(events) == 1 for events in signals.values()))
        assert all(events == [state] for events in signals.values())
        assert call(canonical, "GetState") == call(legacy, "GetState")
        newer = dict(state, generation=2)
        assert call(canonical, "PublishState", json.dumps(newer))
        wait(lambda: all(len(events) == 2 for events in signals.values()))
        assert all(events[-1] == newer for events in signals.values())
        assert not call(legacy, "PublishState", json.dumps(state)), "shared stale-generation guard"
        assert json.loads(cache.read_text()) == newer

        # Cross-endpoint dequeue and deduplication prove there is only one queue.
        command = {"protocol": 1, "sessionId": "p8", "baseGeneration": 2,
                   "commandId": "shared", "type": "set-column-order", "order": ["a"]}
        assert call(legacy, "RequestReorder", json.dumps(command))
        assert call(canonical, "RequestCommand", json.dumps(command))
        assert json.loads(str(call(canonical, "TakePendingCommand"))) == command
        assert str(call(legacy, "TakePendingCommand")) == ""
        assert call(canonical, "RequestEmergencyRestore")
        assert json.loads(str(call(legacy, "TakePendingCommand")))["type"] == "emergency-restore"
        assert str(call(canonical, "TakePendingCommand")) == ""
        deferred = dict(command, commandId="deferred", type="finalize-contextual-wide",
                        windowUuid="a", transitionToken="token")
        assert call(legacy, "RequestDeferredCommand", json.dumps(deferred), 16)
        time.sleep(.05)
        assert json.loads(str(call(canonical, "TakePendingCommand"))) == deferred
        assert not call(legacy, "PublishMotionPlan", "{}")
        assert not call(legacy, "ReportMotionComplete", "{}")
        assert not call(legacy, "ReportMotionParked", "{}")
        duplicate = subprocess.run([binary], env=environment, timeout=3, capture_output=True)
        assert duplicate.returncode == 3
        assert call(canonical, "GetState") == call(legacy, "GetState")
        subprocess.run([binary, "--save-current-state"], env=environment, check=True)
        assert json.loads(cache.read_text()) == newer
        print("PASS canonical / legacy same owner, state, signals, sequence guards, queue, dedup, deferred commands, upgrade fallback and duplicate-process rejection")
    finally:
        for subscription in subscriptions:
            subscription.remove()
        if process is not None:
            process.terminate(); process.wait(timeout=3)
