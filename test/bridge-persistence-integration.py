"""Run only inside dbus-run-session: no calls can reach the user's desktop."""
import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory(prefix="cc-niri-bridge-") as directory:
    environment = dict(os.environ, XDG_STATE_HOME=directory)
    server = None

    def call(method, *arguments):
        result = subprocess.check_output(["gdbus", "call", "--session", "--dest", "org.cc.ScrollDockBridge",
            "--object-path", "/ScrollDock", "--method", "org.cc.ScrollDockBridge1." + method, *arguments], text=True, stderr=subprocess.DEVNULL).strip()
        if result == "(true,)": return True
        if result == "(false,)": return False
        return ast.literal_eval(result)[0]

    def start():
        global server
        server = subprocess.Popen([binary], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if server.poll() is not None: raise AssertionError("Bridge exited")
            try: return call("GetState")
            except subprocess.CalledProcessError: time.sleep(.02)
        raise AssertionError("Bridge did not register")

    def stop():
        global server
        server.terminate(); server.wait(timeout=5); server = None

    legacy = {"protocol": 1, "sessionId": "legacy", "generation": 10, "targetOutput": "eDP-1", "columns": [{"uuid": "a1", "widthMode": "full"}]}
    state = {"protocol": 2, "sessionId": "w5", "generation": 1, "targetOutput": "eDP-1", "workspaceId": "B",
        "columns": [{"uuid": "b1", "widthMode": "full"}], "workspaces": [
            {"id": "A", "columns": [{"uuid": "a1", "widthMode": "full", "persistentWide": True}], "viewportAnchor": {"uuid": "a1", "delta": 25}},
            {"id": "B", "columns": [{"uuid": "b1", "widthMode": "full"}]}]}
    try:
        assert start() == ""
        assert call("PublishState", json.dumps(legacy))
        # Verify the installer handoff against an actual DBus GetState.
        subprocess.run([binary, "--save-current-state"], env=environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        stop(); assert json.loads(start()) == legacy
        assert call("RequestEmergencyRestore") is False, "cached session must not be treated as live"
        assert call("PublishState", json.dumps(state))
        cache = Path(directory, "cc-niri/workspaces.json")
        assert json.loads(cache.read_text()) == state
        mismatch = dict(state, columns=[{"uuid": "b1", "widthMode": "half"}])
        assert call("PublishState", json.dumps(mismatch)) is False
        assert json.loads(call("GetState")) == state
        assert json.loads(cache.read_text()) == state, "width mismatch must not replace durable Full data"
        stop(); assert json.loads(start()) == state
        assert call("PublishState", json.dumps(dict(state, sessionId="reloaded", generation=0)))
        blocked = Path(directory, "blocked")
        (blocked / "cc-niri/workspaces.json").mkdir(parents=True)
        failed = subprocess.run([binary, "--save-current-state"], env=dict(environment, XDG_STATE_HOME=str(blocked)),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        assert failed.returncode != 0, "upgrade handoff must abort if durable save fails"
        stop()
        cache.write_text("broken")
        assert start() == ""
        print("PASS isolated DBus Bridge upgrade handoff, persistent Full protocol 1/2 restart, width mismatch and corruption")
    finally:
        if server is not None: stop()
