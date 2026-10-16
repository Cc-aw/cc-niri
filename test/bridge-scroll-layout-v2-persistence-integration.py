"""P5 disk/DBus compatibility, always run under a private dbus-run-session."""
import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
old_reader = "--old-reader" in sys.argv[2:]
with tempfile.TemporaryDirectory(prefix="cc-niri-p5-bridge-") as directory:
    environment = dict(os.environ, XDG_STATE_HOME=directory)
    process = None

    def owned():
        result = subprocess.check_output(["gdbus", "call", "--session", "--dest", "org.freedesktop.DBus",
            "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.GetConnectionUnixProcessID",
            "org.cc.CCNiriBridge"], text=True, stderr=subprocess.DEVNULL)
        import re
        return int(re.search(r"uint32 (\d+)", result)[1]) == process.pid

    def call(method, *arguments):
        assert process.poll() is None and owned(), "refuse another process's Bridge"
        result = subprocess.check_output(["gdbus", "call", "--session", "--dest", "org.cc.CCNiriBridge",
            "--object-path", "/CCNiriBridge", "--method", "org.cc.CCNiriBridge1." + method, *arguments],
            text=True, stderr=subprocess.DEVNULL).strip()
        if result in {"(true,)", "(false,)"}: return result == "(true,)"
        return ast.literal_eval(result)[0]

    def start():
        global process
        process = subprocess.Popen([binary], env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            assert process.poll() is None
            try: return call("GetState")
            except subprocess.CalledProcessError: time.sleep(.02)
        raise AssertionError("private Bridge did not register")

    def stop():
        global process
        process.terminate(); process.wait(timeout=5); process = None

    def publish(state): return call("PublishState", json.dumps(state))
    width = dict(version=1, widthMode="twoThirds", previousNonFullWidthMode="twoThirds")
    basis = dict(outputRect=dict(x=0, y=0, width=2560, height=1440),
                 workingArea=dict(x=0, y=50, width=2560, height=1390), gap=16, physicalScale=1.5)
    anchor = dict(version=1, uuid="a", delta=-440, basis=basis)
    columns = [dict(uuid="a", widthMode="twoThirds", widthV2=width, persistentWide=True),
               dict(uuid="b", widthMode="full", previousNonFullWidthMode="twoThirds",
                    widthV2=dict(width, widthMode="full"))]
    active = dict(id="A", columns=columns, viewportAnchor=None, viewportAnchorV2=anchor,
                  dormantViewportV1=dict(version=1, mode="wide", wideUuid="a"))
    state = dict(protocol=2, sessionId="v2", generation=1, targetOutput="eDP-1", workspaceId="A",
                 columns=columns, viewportAnchorV2=anchor, workspaces=[active, dict(id="B", columns=[])])
    checks = 0
    try:
        assert start() == ""
        assert publish(state); checks += 1
        cache = Path(directory, "cc-niri/workspaces.json")
        assert json.loads(call("GetState")) == state == json.loads(cache.read_text()); checks += 1
        subprocess.run([binary, "--save-current-state"], env=environment, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        stop(); assert json.loads(start()) == state; checks += 1
        assert not call("RequestEmergencyRestore"); checks += 1
        if not old_reader:
            invalid = []
            for field, value in [("version", 2), ("widthMode", "third"), ("previousNonFullWidthMode", "full")]:
                bad = json.loads(json.dumps(state)); bad["columns"][0]["widthV2"][field] = value; invalid.append(bad)
            for mutate in [lambda s: s["viewportAnchorV2"].update(delta="-440"),
                lambda s: s["viewportAnchorV2"].update(delta=-10000001),
                lambda s: s["workspaces"][0]["viewportAnchorV2"].update(delta=-400),
                lambda s: s["workspaces"][0]["viewportAnchorV2"]["basis"]["workingArea"].update(height=0),
                lambda s: s["workspaces"][0]["columns"][0].update(widthMode="half")]:
                bad = json.loads(json.dumps(state)); mutate(bad); invalid.append(bad)
            for bad in invalid:
                assert not publish(bad)
                assert json.loads(call("GetState")) == state == json.loads(cache.read_text()); checks += 1
        # V1 projects the active mode to half, preserving dormant V2 data byte-for-byte.
        projected = json.loads(json.dumps(state)); projected.update(sessionId="v1", generation=0)
        projected["columns"][0]["widthMode"] = "half"
        projected["workspaces"][0]["columns"][0]["widthMode"] = "half"
        assert publish(projected); stop(); assert json.loads(start()) == projected; checks += 1
        state.update(sessionId="v2-return", generation=0)
        assert publish(state); checks += 1
        legacy = dict(protocol=1, sessionId="legacy", generation=0, targetOutput="eDP-1",
                      columns=[dict(uuid="a", widthMode="twoThirds")])
        assert publish(legacy); stop(); assert json.loads(start()) == legacy; checks += 1
        print(json.dumps(dict(status="PASS", checks=checks, old_reader=old_reader,
            scope="private DBus/disk V2, V1 projection, version/anchor rejection, installer handoff and protocol 1")))
    finally:
        if process is not None: stop()
