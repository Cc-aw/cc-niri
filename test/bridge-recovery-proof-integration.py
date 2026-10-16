"""Transient recovery proof on a private bus; no durable ACK history."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import dbus

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory(prefix="cc-niri-recovery-") as directory:
    bus = dbus.SessionBus()
    process = None
    def start():
        global process
        process = subprocess.Popen([binary], env=dict(os.environ, XDG_STATE_HOME=directory), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            assert process.poll() is None
            try:
                pid = bus.call_blocking("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionUnixProcessID", "s", ("org.cc.CCNiriBridge",))
                if int(pid) == process.pid: return
            except dbus.DBusException: pass
            time.sleep(.02)
        raise AssertionError("private Bridge unavailable")
    def call(method, value=None):
        assert int(bus.call_blocking("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionUnixProcessID", "s", ("org.cc.CCNiriBridge",))) == process.pid
        invoke = bus.get_object("org.cc.CCNiriBridge", "/CCNiriBridge").get_dbus_method(method, "org.cc.CCNiriBridge1")
        return invoke() if value is None else invoke(json.dumps(value))
    def stop(): process.terminate(); process.wait(timeout=5)
    try:
        start()
        state = dict(protocol=2,sessionId="live",generation=1,workspaceId="A",targetOutput="eDP-1",columns=[],workspaces=[dict(id="A",columns=[])])
        proof = dict(protocol=1,type="recovery-status",sessionId="live",requestId=None,state="running",restoredCount=0)
        assert not call("ReportRecoveryStatus",proof)
        assert call("PublishState",state)
        assert call("ReportRecoveryStatus",proof)
        assert json.loads(str(call("GetRecoveryStatus"))) == proof
        cache = Path(directory,"cc-niri/workspaces.json"); durable = cache.read_bytes()
        command = dict(protocol=1,type="emergency-restore",sessionId="live",baseGeneration=1,commandId="fresh")
        assert call("RequestCommand",command)
        assert str(call("GetRecoveryStatus")) == ""
        pending = dict(proof,requestId="fresh",state="pending")
        assert not call("ReportRecoveryStatus",dict(pending,state="restored"))
        assert call("ReportRecoveryStatus",pending)
        for invalid in [dict(pending,requestId="old",state="restored"),dict(pending,sessionId="retired"),dict(pending,restoredCount=-1),dict(pending,protocol=2)]:
            assert not call("ReportRecoveryStatus",invalid)
        assert call("ReportRecoveryStatus",dict(pending,state="restored",restoredCount=4))
        assert json.loads(str(call("GetRecoveryStatus")))["restoredCount"] == 4
        assert cache.read_bytes() == durable, "ACK proof must never be persisted"
        state["sessionId"]="new"; state["generation"]=0
        assert call("PublishState",state); assert str(call("GetRecoveryStatus")) == ""
        assert not call("ReportRecoveryStatus",pending)
        stop(); start(); assert str(call("GetRecoveryStatus")) == ""
        assert not call("ReportRecoveryStatus",dict(proof,sessionId="new")), "cached disk state is not live authority"
        print("PASS transient recovery DBus proof, pending/terminal ordering, stale token/session rejection and no disk ACK")
    finally:
        if process and process.poll() is None: stop()
