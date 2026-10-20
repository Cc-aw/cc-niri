#!/usr/bin/env python3
"""Release production Clip/Rust/Bridge/Ring on a private virtual KWin.

P0 supplies only bounded normal input injection and framebuffer readback, with
an empty P0 projection model. Never install or contact the desktop bus/display.
"""
import argparse
import ast
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path('/home/cc/cc_niri')
spec = importlib.util.spec_from_file_location("p0", ROOT / "tools/scroll-layout-v2-p0-input-probe.py")
p0 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p0)
CLIP_DIR = ROOT / "build/native-viewport-clip/bin"
CLIP = CLIP_DIR / "kwin/effects/plugins/cc-niri-viewport-clip.so"
BRIDGE = ROOT / "build/bridge/cc-niri-bridge"
DEST = ROOT / "test/scroll-layout-v2-p3-evidence/20261015"


def isolated(destination, scale, ime=False, scenario=None):
    for artifact in [CLIP, BRIDGE, p0.PLUGIN, p0.RING]:
        if not artifact.is_file():
            raise RuntimeError("missing build-tree artifact: " + str(artifact))
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cc-niri-p0-") as temporary:
        base = Path(temporary)
        for directory in ["config", "data", "cache", "state", "runtime"]:
            (base / directory).mkdir(mode=0o700)
        (base / "config/kwinrc").write_text("[Script-cc-niri-maximize]\nScrollLayoutV2Enabled=true\n"
                                            "[Effect-cc-niri-viewport-clip]\nAnimationProfile=smooth60\n" +
                                            ("OptimizedWorkspaceAnimation=true\nWorkspaceDuration=420\n"
                                             "[Plugins]\nslideEnabled=false\n" if scenario in {"p5", "p6"} else ""))
        if ime:
            profile = base / "config/fcitx5/profile"
            profile.parent.mkdir()
            profile.write_text("[Groups/0]\nName=Default\nDefault Layout=us\nDefaultIM=pinyin\n\n"
                "[Groups/0/Items/0]\nName=keyboard-us\nLayout=\n\n[Groups/0/Items/1]\nName=pinyin\nLayout=\n\n[GroupOrder]\n0=Default\n")
        env = {key: os.environ[key] for key in ["PATH", "LANG"] if key in os.environ}
        if ime and "HOME" in os.environ:
            env["HOME"] = os.environ["HOME"]
        env.update({"CC_NIRI_P0_ISOLATED_ROOT": str(base), "XDG_RUNTIME_DIR": str(base / "runtime"),
                    "XDG_CONFIG_HOME": str(base / "config"), "XDG_DATA_HOME": str(base / "data"),
                    "XDG_CACHE_HOME": str(base / "cache"), "XDG_STATE_HOME": str(base / "state"),
                    "XDG_DATA_DIRS": "/usr/local/share:/usr/share", "QT_QPA_PLATFORM": "offscreen",
                    "KWIN_COMPOSE": "O2", "__EGL_VENDOR_LIBRARY_FILENAMES": "/usr/share/glvnd/egl_vendor.d/50_mesa.json",
                    "QT_PLUGIN_PATH": ":".join(map(str, [CLIP_DIR, p0.PLUGIN_DIR, p0.RING_DIR])),
                    "QT_FORCE_STDERR_LOGGING": "1", "QT_LOGGING_RULES": "kwin_effects.debug=true"})
        if scenario == "input-lifecycle":
            env.update(KDE_DEBUG="1", CC_NIRI_P0_NO_CORE="1")
        args = ["dbus-run-session", "--", sys.executable, __file__, "--inside", "--output", str(destination.resolve()), "--scale", str(scale)]
        if ime:
            args.append("--ime")
        if scenario:
            args.extend(["--scenario",scenario])
        process = subprocess.Popen(args, env=env, start_new_session=True, text=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            stdout, stderr = process.communicate(timeout=70 if scenario in {"p5", "p6"} else 45)
            code = process.returncode
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                stdout, stderr = process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate(timeout=3)
            code = 1
        (destination / "runner.json").write_text(json.dumps(dict(command=args, exit_code=code, stdout=stdout, stderr=stderr), indent=2) + "\n")
        print(stdout, end="")
        if code:
            print(stderr[-1500:])
        return code


def inside(destination, scale, ime=False, scenario=None):
    if not p0.guard():
        raise RuntimeError("P3 refuses non-isolated environment")
    base = Path(os.environ["CC_NIRI_P0_ISOLATED_ROOT"])
    bus = os.environ["DBUS_SESSION_BUS_ADDRESS"]
    report = dict(started_utc=datetime.now(timezone.utc).isoformat(), status="INCONCLUSIVE", scale=scale,
                  ime="fcitx5" if ime else None,
                  scope="production Release Clip + Rust + Bridge + Ring, private virtual Mesa KWin; P0 raw injector only",
                  artifacts={str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                             for p in [CLIP, BRIDGE, p0.PLUGIN, p0.RING]}, checks={}, plans=[], geometry=[], captures=[])
    processes, logs = [], []
    checks = report["checks"]

    def log(name):
        handle = (destination / name).open("w")
        logs.append(handle)
        return handle

    def call(path, method, *args, service="org.kde.KWin"):
        raw = p0.run(["gdbus", "call", "--address", bus, "--dest", service,
                      "--object-path", path, "--method", method, *map(str, args)])
        if raw.strip() in {"(true,)", "(false,)"}:
            return raw.strip() == "(true,)"
        return ast.literal_eval(raw.strip())[0] if raw.strip() != "()" else None

    def owned(service, process):
        try:
            raw = p0.run(["gdbus", "call", "--address", bus, "--dest", "org.freedesktop.DBus",
                          "--object-path", "/org/freedesktop/DBus", "--method",
                          "org.freedesktop.DBus.GetConnectionUnixProcessID", service])
        except RuntimeError:
            return False
        return process.poll() is None and int(re.search(r"uint32 (\d+)", raw)[1]) == process.pid

    def native(method, *args):
        return call("/ccNiriViewportMotion", "org.cc.NiriViewportMotion1." + method, *args)

    def fixture(method, *args):
        return call("/ccNiriP0Input", "org.cc.CCNiriP0Input1." + method, *args)

    def recorder(method, *args):
        return call("/P0", "org.cc.CCNiriP0Fixture1." + method, *args, service="org.cc.CCNiriP0Fixture")

    def records():
        return [json.loads(line.removeprefix("CC_NIRI_P0_INPUT "))
                for line in (destination / "clients.log").read_text().splitlines()
                if line.startswith("CC_NIRI_P0_INPUT ")]

    def events(phase, names):
        return [r for r in records() if r.get("phase") == phase and r.get("kind") == "client-event" and r.get("event") in names]

    def signals(name):
        result = []
        for line in (destination / "signals.log").read_text().splitlines():
            if "." + name + " " in line:
                result.append(json.loads(ast.literal_eval(line.split(name + " ", 1)[1])[0]))
        return result

    def wait(predicate, timeout=2):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            value = predicate()
            if value:
                return value
            time.sleep(0.025)
        raise RuntimeError("P3 condition timed out")

    script_counter = 0

    def geometry(label, poses=None, focus=None):
        nonlocal script_counter
        script_counter += 1
        script = base / f"p3-{script_counter}.js"
        source = r'''
const outputs = Array.from(workspace.screens);
if (outputs.length !== 2 || outputs.some(o => !/^Virtual-[01]$/.test(o.name))) throw new Error("not private virtual KWin");
const poses = POSES;
const windows = workspace.windowList().filter(w => /^CC_NIRI_P0_[ABCD]$/.test(w.caption));
if (poses) windows.forEach(w => {
    const pose = poses[w.caption.slice(-1)];
    w.minimized = !pose;
    if (pose) w.frameGeometry = pose;
});
const focus = FOCUS;
if (focus) workspace.activeWindow = windows.find(w => w.caption === "CC_NIRI_P0_" + focus);
const timer = new QTimer(); timer.interval = 20; let attempts = 0;
timer.timeout.connect(() => {
    attempts++;
    const ready = !poses || Object.entries(poses).every(([name, pose]) => {
        const w = windows.find(w => w.caption === "CC_NIRI_P0_" + name);
        return w && ["x", "y", "width", "height"].every(k => w.frameGeometry[k] === pose[k]);
    });
    if (ready || attempts > 60) {
        timer.stop();
        const rows = windows.map(w => { const r=w.frameGeometry; return {
            title: w.caption, uuid: String(w.internalId).replace(/[{}]/g, "").toLowerCase(), output: w.output.name,
            minimized: w.minimized, rect: {x:r.x, y:r.y, width:r.width, height:r.height} }; });
        callDBus("org.cc.CCNiriP0Fixture", "/P0", "org.cc.CCNiriP0Fixture1", "Record",
            JSON.stringify({kind:"p3-geometry",label:LABEL,ready:ready,
                workspaceId:workspace.currentDesktop.id,rows:rows,focus:workspace.activeWindow ? workspace.activeWindow.caption : null}), function() {});
    }
}); timer.start();
'''
        source = source.replace("POSES", json.dumps(poses)).replace("FOCUS", json.dumps(focus)).replace("LABEL", json.dumps(label))
        script.write_text(source)
        script_id = call("/Scripting", "org.kde.kwin.Scripting.loadScript", script, f"p3-{script_counter}")
        call(f"/Scripting/Script{script_id}", "org.kde.kwin.Script.run")
        result = wait(lambda: next((r for r in records() if r.get("kind") == "p3-geometry" and r["label"] == label), None))
        report["geometry"].append(result)
        if not result["ready"]:
            raise RuntimeError("client geometry ACK failed: " + label)
        return result

    def send(kind, **fields):
        if not fixture("Input", json.dumps(dict(epoch=0, kind=kind, **fields))):
            raise RuntimeError("private raw input rejected")
        time.sleep(0.035)

    def capture(name, samples):
        from PySide6.QtGui import QImage
        if not fixture("Capture", name):
            raise RuntimeError("readback request rejected")
        paths = [base / "screens" / f"{name}-Virtual-{i}.png" for i in [0, 1]]
        wait(lambda: all(p.exists() and not QImage(str(p)).isNull() for p in paths))
        observations = []
        for i, path in enumerate(paths):
            image = QImage(str(path)); shutil.copy2(path, destination / path.name)
            assert image.size().width() == int(2560 * scale)
            for x, y, expected in samples.get(i, []):
                actual = image.pixelColor(round(x * scale), round(y * scale)).name()
                observations.append(dict(output=i, x=x, y=y, expected=expected, actual=actual))
            if i == 1:
                rgb = image.convertToFormat(QImage.Format_RGB888)
                observations.append(dict(output=i, expected="#000000", actual="#000000" if not any(bytes(rgb.constBits())) else "NONBLACK",
                                         scope="entire-secondary-framebuffer"))
        report["captures"].append(dict(name=name, samples=observations))
        return all(v["actual"] == v["expected"] for v in observations)

    try:
        kwin_log = log("kwin.log")
        kwin_args = ["kwin_wayland", "--virtual", "--width", "2560", "--height", "1440",
            "--scale", str(scale), "--output-count", "2", "--socket", "cc-niri-p0", "--no-lockscreen",
            "--no-global-shortcuts", "--no-kactivities"]
        if ime:
            kwin_args.extend(["--inputmethod", "/usr/bin/fcitx5 -D --disable=cloudpinyin,clipboard,notifications --ui=classic"])
        kwin = subprocess.Popen(kwin_args, stdout=kwin_log, stderr=kwin_log)
        processes.append(kwin)
        wait(lambda: (base / "runtime/cc-niri-p0").exists(), 8)
        wait(lambda: owned("org.kde.KWin", kwin), 3)
        report["support"] = call("/KWin", "org.kde.KWin.supportInformation")
        assert "KWin::VirtualBackend" in report["support"] and "Mesa" in report["support"] and "Compositing Type: OpenGL" in report["support"]
        assert call("/Effects", "org.kde.kwin.Effects.loadEffect", "cc-niri-p0-input-fixture")
        assert fixture("SetVirtualScale", scale)
        assert fixture("EnableRawInput")
        checks["raw_injector_has_no_p0_projection"] = json.loads(fixture("Status"))["entries"] == []
        bridge_log = log("bridge.log")
        bridge = subprocess.Popen([str(BRIDGE)], stdout=bridge_log, stderr=bridge_log)
        processes.append(bridge)
        wait(lambda: owned("org.cc.CCNiriBridge", bridge), 3)
        assert call("/Effects", "org.kde.kwin.Effects.loadEffect", "cc-niri-viewport-clip")
        assert call("/Effects", "org.kde.kwin.Effects.loadEffect", "cc-niri-focus-ring")
        report["capability"] = json.loads(native("GetPartialScrollCapability"))
        ring_identity = json.loads(call("/ccNiriFocusRing", "org.cc.NiriFocusRing1.GetFocusRingStatus"))
        report["loaded_binary_paths"] = {"clip": report["capability"].get("binaryPath"), "ring": ring_identity.get("binaryPath")}
        checks["exact_build_tree_plugins_loaded"] = report["loaded_binary_paths"] == {"clip": str(CLIP), "ring": str(p0.RING)}
        checks["native_capability_explicit"] = report["capability"]["enabled"] and report["capability"]["protocol"] == 3 and report["capability"]["inputPolicy"] == "two-click"
        signal_log = log("signals.log")
        monitor = subprocess.Popen(["stdbuf", "-oL", "gdbus", "monitor", "--address", bus, "--dest", "org.kde.KWin",
                                   "--object-path", "/ccNiriViewportMotion"], stdout=signal_log, stderr=signal_log)
        processes.append(monitor)
        client_log = log("clients.log")
        client_env = dict(os.environ, WAYLAND_DISPLAY="cc-niri-p0", QT_QPA_PLATFORM="wayland", WAYLAND_DEBUG="client")
        if scenario: client_env["CC_NIRI_P0_CLIENT_LIFETIME_MS"]="60000" if scenario in {"p5", "p6"} else "40000"
        if ime:
            client_env["QT_IM_MODULE"] = "fcitx"
        client = subprocess.Popen([sys.executable, str(p0.ROOT / "tools/scroll-layout-v2-p0-input-probe.py"), "--clients"],
            env=client_env, stdout=client_log, stderr=client_log)
        processes.append(client)
        wait(lambda: any(r.get("kind") == "private-shortcut-service" for r in records()), 4)
        time.sleep(.2)
        start_poses = {"A": dict(x=440, y=66, width=1680, height=1358), "B": dict(x=1304, y=66, width=1256, height=1358)}
        bound = geometry("initial-safe-client-ack", start_poses, "A")
        rows = {r["title"][-1]: r for r in bound["rows"]}
        state = dict(protocol=2, sessionId="p3-private", generation=1, workspaceId=bound["workspaceId"], targetOutput="Virtual-0",
                     columns=[dict(uuid=rows[n]["uuid"]) for n in ["A", "B"]])
        state["workspaces"] = [dict(id=state["workspaceId"], columns=state["columns"])]
        def bridge_call(method, value):
            assert owned("org.cc.CCNiriBridge", bridge)
            return call("/CCNiriBridge", "org.cc.CCNiriBridge1." + method, json.dumps(value), service="org.cc.CCNiriBridge")
        plan = dict(protocol=3, type="PARTIAL_SCROLL", sessionId=state["sessionId"], workspaceId=state["workspaceId"], targetOutput="Virtual-0",
            epoch=1, issuedAt=int(time.time() * 1000), scopeRevision=1, maxCamera=1696, clipPartial=True, retargetOnly=True,
            oldScrollOffsetX=212, newScrollOffsetX=212, viewport=dict(x=0,y=0,width=2560,height=1440), layoutRect=dict(x=0,y=66,width=2560,height=1358), entries=[
                dict(windowId=rows["A"]["uuid"],columnId=1,logicalX=652,pixelWidth=1680,oldPlacement="visible",newPlacement="visible"),
                dict(windowId=rows["B"]["uuid"],columnId=2,logicalX=2348,pixelWidth=1256,oldPlacement="visible",newPlacement="visible")])
        checks["bridge_requires_membership"] = not bridge_call("PublishMotionPlan", plan)
        assert bridge_call("PublishState", state)
        def arm(value):
            report["plans"].append(copy.deepcopy(value))
            assert bridge_call("PublishMotionPlan", value)
            assert native("ArmScrollPlan", json.dumps(value))
        arm(plan)
        painted = wait(lambda: (lambda v: v if v.get("valid") else None)(json.loads(native("GetPartialPaintedState"))))
        report["initial_painted"] = painted
        checks["actual_painted_camera_and_scope"] = painted["cameraX"] == 212 and painted["epoch"] == 1 and painted["scopeRevision"] == 1
        source = wait(lambda: (lambda v: v if v.get("valid") else None)(json.loads(native("GetColumnGeometrySource"))))
        report["column_geometry_source"] = source
        clients = {r["windowId"]: r for r in source["entries"]}
        checks["p4_source_has_real_per_client_frames"] = len(clients) == 2 and all(
            clients[rows[n]["uuid"]]["frameRect"] == start_poses[n] and
            all(clients[rows[n]["uuid"]][k] is True for k in ["owned", "painted", "acknowledged"])
            for n in ["A", "B"])
        checks["p4_source_uses_actual_camera_and_pass"] = source["protocol"] == 4 and source["type"] == "COLUMN_GEOMETRY_SOURCE" and all(
            source[k] == plan[k] for k in ["sessionId", "workspaceId", "targetOutput", "epoch", "scopeRevision", "maxCamera", "viewport", "layoutRect"]
            ) and source["cameraX"] == 212 and source["sampleSerial"] > 0
        checks["p4_source_preserves_natural_partial_visual"] = all(
            clients[e["windowId"]]["logicalX"] == e["logicalX"] and
            clients[e["windowId"]]["columnId"] == e["columnId"] and
            clients[e["windowId"]]["visualRect"] == dict(x=e["logicalX"]-212, y=66, width=e["pixelWidth"], height=1358)
            for e in plan["entries"])
        checks["right_partial_strict_output"] = capture("right-partial", {0:[(450,300,"#386ac4"),(1304,300,"#386ac4"),(2110,300,"#386ac4"),(2135,300,"#000000"),(2140,300,"#32a060"),(2559,300,"#32a060")]})
        if scenario == "input-lifecycle":
            report["internal_windows"] = []
            for mode in ["active", "handoff"]:
                if mode == "handoff":
                    width = dict(protocol=1, type="PAIR_TO_WIDE", sessionId=state["sessionId"],
                        epoch=2, issuedAt=int(time.time()*1000), viewport=plan["viewport"], entries=[
                            dict(windowId=rows[n]["uuid"], role="target" if n == "A" else "neighbor",
                                 oldVisualRect=start_poses[n], newVisualRect=start_poses[n]) for n in ["A", "B"]])
                    assert bridge_call("PublishMotionPlan", width)
                    wait(lambda: "[MOTION_PLAN_NATIVE] ARM" in (destination / "kwin.log").read_text())
                    native("CancelScrollPlan", json.dumps(dict(sessionId=state["sessionId"], epoch=1)))
                    status = json.loads(native("GetScrollMotionStatus"))
                    checks["frozen_handoff_exercised"] = status["clipHandoffActive"] and not status["active"]
                    assert checks["frozen_handoff_exercised"]
                for cycle in range(8):
                    # Keep native focus away from the tooltip before deleting it;
                    # then cross its retained frame through normal pointer input.
                    send("move", x=600, y=300)
                    assert fixture("OpenInternalWindow")
                    live = wait(lambda: (lambda v: v if v["effectWindow"] and v["inStackingOrder"] and v["handlePresent"] else None)(
                        json.loads(fixture("InternalWindowStatus"))))
                    assert fixture("CloseInternalWindow")
                    closed = json.loads(fixture("InternalWindowStatus"))
                    report["internal_windows"].append(dict(mode=mode, cycle=cycle, live=live, closed=closed))
                    checks[f"{mode}_{cycle}_closed_internal_retained_without_qwindow"] = (
                        closed["effectWindow"] and closed["inStackingOrder"] and closed["deleted"]
                        and closed["held"] and not closed["handlePresent"])
                    assert checks[f"{mode}_{cycle}_closed_internal_retained_without_qwindow"]
                    for x in [810, 900, 1030, 790]:
                        send("move", x=x, y=200)
                    checks[f"{mode}_{cycle}_pointer_motion_survives"] = owned("org.kde.KWin", kwin)
                    assert fixture("ReleaseInternalWindow")
                    released = wait(lambda: (lambda v: v if not v["effectWindow"] else None)(
                        json.loads(fixture("InternalWindowStatus"))))
                    report["internal_windows"][-1]["released"] = released
            native("CancelScrollPlan", json.dumps(dict(sessionId=state["sessionId"], epoch=2)))
            checks["lifecycle_cancel_drains_handoff"] = not json.loads(native("GetScrollMotionStatus"))["clipHandoffActive"]
            checks["lifecycle_pairs_drained"] = all(json.loads(native("GetPartialScrollCapability"))[k] == 0
                for k in ["pendingButtons", "pendingTouches"])
            recorder("Mark", "lifecycle-after-cancel")
            send("move", x=1000, y=300); send("press"); send("release")
            clicks = events("lifecycle-after-cancel", {"MouseButtonPress", "MouseButtonRelease"})
            checks["lifecycle_cancel_restores_native_input"] = len(clicks) == 2 and all(
                r["title"] == "CC_NIRI_P0_A" and r["x"] == 560 and r["y"] == 234 for r in clicks)
            raise P4ScenarioComplete()
        if scenario in {"p4", "p5", "p6"}:
            scenario_spec=importlib.util.spec_from_file_location("p4scenario",Path("/tmp/cc-niri-transfer-scenario.py"))
            scenario_module=importlib.util.module_from_spec(scenario_spec);scenario_spec.loader.exec_module(scenario_module)
            try:
                scenario_module.run(locals())
            finally:
                if scenario == "p6" and not call("/Effects", "org.kde.kwin.Effects.isEffectLoaded", "cc-niri-viewport-clip"):
                    report["p6_last_status"] = {"endpoint_unloaded": True}
                else:
                    report[f"{scenario}_last_status"]=json.loads(native("GetScrollMotionStatus"))
                    report[f"{scenario}_last_source"]=json.loads(native("GetColumnGeometrySource"))
                    report.setdefault("scroll_capture",json.loads(native("GetScrollFrameCapture")))
            raise P4ScenarioComplete()
        recorder("Mark", "popup-open")
        send("move",x=1000,y=300); send("press",button=273); send("release",button=273)
        wait(lambda: any(r.get("kind") == "popup-shown" for r in records()))
        before = len(signals("PartialFocusRequested"))
        recorder("Mark", "popup-outside")
        send("move",x=2400,y=300); send("press"); send("release")
        checks["popup_grab_delegated_without_partial_focus"] = len(signals("PartialFocusRequested")) == before and any(r.get("kind") == "popup-hidden" for r in records())
        recorder("Mark", "dnd-open")
        send("move",x=1000,y=300); send("press"); send("move",x=1040,y=300)
        wait(lambda: json.loads(fixture("Status"))["nativeDrag"])
        recorder("Mark", "dnd-cross-partial")
        send("move",x=2400,y=300); send("release")
        wait(lambda: not json.loads(fixture("Status"))["nativeDrag"])
        checks["wayland_drag_preserves_native_authority"] = len(signals("PartialFocusRequested")) == before and any(r.get("kind") == "drag-end" for r in records())
        geometry("modal-parent-active", focus="A")
        recorder("OpenDialog")
        modal = wait(lambda: (lambda v: v if v["activeModal"] else None)(json.loads(fixture("Status"))))
        report["modal_before_input"] = modal
        recorder("Mark", "modal-outside")
        send("move",x=2400,y=300); send("press"); send("release")
        checks["modal_preserves_native_authority"] = modal["activeModal"] and len(signals("PartialFocusRequested")) == before
        recorder("CloseDialog"); time.sleep(.1)
        if ime:
            geometry("ime-parent-active", focus="A")
            time.sleep(.1)
            recorder("Mark", "ime-candidate"); recorder("BeginIME"); time.sleep(.15)
            p0.run(["fcitx5-remote", "--check", "-s", "pinyin"])
            p0.run(["fcitx5-remote", "--check", "-o"])
            for code in [49,23,35,30,24]:
                send("key",code=code,pressed=True); send("key",code=code,pressed=False)
            time.sleep(.25)
            candidate_status = json.loads(fixture("Status")); report["ime_candidate"] = candidate_status
            candidates = [w for w in candidate_status["auxiliary"] if w["width"] > 0]
            checks["fcitx5_candidate_observed"] = bool(candidates)
            if candidates:
                candidate = candidates[0]
                send("move",x=max(2148,candidate["x"]+20),y=candidate["y"]+min(15,candidate["height"]/2))
                send("press"); send("release")
                checks["fcitx5_candidate_click_not_partial_focus"] = len(signals("PartialFocusRequested")) == before
                send("key",code=28,pressed=True); send("key",code=28,pressed=False)
                checks["fcitx5_candidate_commits_text"] = any(r.get("kind") == "ime-text" and any(ord(c)>127 for c in r["text"]) for r in records())
            send("key",code=1,pressed=True); send("key",code=1,pressed=False)
            p0.run(["fcitx5-remote", "--check", "-c"])
        geometry("first-click-baseline-focus", focus="A")
        recorder("Mark", "partial-first-click")
        send("move", x=2400,y=300); send("press"); send("release")
        wait(lambda: signals("PartialFocusRequested"))
        request = signals("PartialFocusRequested")[-1]; report["focus_request"] = request
        command = json.loads(call("/CCNiriBridge", "org.cc.CCNiriBridge1.TakePendingCommand", service="org.cc.CCNiriBridge"))
        report["focus_command"] = command
        checks["native_intent_relays_through_existing_bounded_bridge_pump"] = command["type"] == "focus-partial-column" and command["protocol"] == 1 and command["epoch"] == request["epoch"] and command["windowUuid"] == request["windowUuid"] and command["baseGeneration"] == state["generation"]
        checks["first_click_pair_consumed"] = not events("partial-first-click", {"MouseButtonPress","MouseButtonRelease"})
        checks["focus_intent_only"] = request["windowUuid"] == rows["B"]["uuid"] and geometry("before-js-focus")["focus"] == "CC_NIRI_P0_A"
        checks["pair_drained"] = json.loads(native("GetPartialScrollCapability"))["pendingButtons"] == 0
        # JS authority receives intent, arms first, then submits safe real frames and focus.
        plan.update(epoch=2,issuedAt=int(time.time()*1000),oldScrollOffsetX=212,newScrollOffsetX=1060,retargetOnly=False)
        arm(plan)
        recorder("Mark", "native-ack-before-client-ack")
        send("press"); send("release")
        checks["pending_geometry_never_receives_wrong_click"] = not events("native-ack-before-client-ack", {"MouseButtonPress","MouseButtonRelease"})
        target_poses = {"A":dict(x=0,y=66,width=1680,height=1358),"B":dict(x=1288,y=66,width=1256,height=1358)}
        committed = geometry("native-arm-then-safe-client-ack", target_poses, "B")
        checks["js_activation_after_native_arm_and_geometry"] = committed["focus"] == "CC_NIRI_P0_B"
        wait(lambda: json.loads(native("GetScrollMotionStatus")).get("completed"))
        checks["safe_frames_keep_primary_and_client_width"] = all(r["output"] == "Virtual-0" and r["rect"]["width"] == start_poses[r["title"][-1]]["width"]
            for r in report["geometry"][-1]["rows"] if not r["minimized"])
        recorder("Mark", "second-click")
        send("move",x=1400,y=300); send("press"); send("release")
        click = events("second-click", {"MouseButtonPress","MouseButtonRelease"})
        report["second_click_events"] = click
        checks["second_click_native_coordinates"] = len(click) == 2 and all(r["title"] == "CC_NIRI_P0_B" and r["x"] == 112 and r["y"] == 234 and r["spontaneous"] for r in click)
        eligibility = dict(protocol=1,type="focus-ring-eligibility",sessionId="p3-private-ring",generation=1,enabled=True,
            targetOutput="Virtual-0",workspaceId=state["workspaceId"],windows=[rows[n]["uuid"] for n in ["A","B"]])
        assert call("/ccNiriFocusRing", "org.cc.NiriFocusRing1.PublishEligibility", json.dumps(eligibility))
        time.sleep(.25)
        report["ring_status"] = json.loads(call("/ccNiriFocusRing", "org.cc.NiriFocusRing1.GetFocusRingStatus"))
        checks["real_ring_shared_frame"] = report["ring_status"]["drawCount"] > 0 and report["ring_status"]["sharedFrameSamples"] > 0
        checks["left_partial_and_ring_no_secondary_leak"] = capture("left-partial-ring", {0:[(0,300,"#386ac4"),(1272,300,"#000000"),(1300,300,"#32a060")]})
        recorder("Mark", "partial-wheel")
        send("move",x=100,y=300); send("axis")
        checks["wheel_on_shifted_visual_consumed"] = not events("partial-wheel", {"Wheel"})
        recorder("Mark", "partial-touch")
        send("touch-down",id=0,x=100,y=300); send("touch-move",id=0,x=120,y=310); send("touch-up",id=0)
        checks["shifted_touch_pair_consumed"] = not events("partial-touch", {"TouchBegin","TouchUpdate","TouchEnd"})
        checks["touch_pairs_drained"] = json.loads(native("GetPartialScrollCapability"))["pendingTouches"] == 0
        recorder("Mark", "native-touch")
        send("touch-down",id=0,x=1400,y=300); send("touch-up",id=0)
        touches = events("native-touch", {"TouchBegin","TouchEnd"}); report["native_touch_events"] = touches
        checks["aligned_native_touch_coordinates"] = len(touches) == 2 and all(r["title"] == "CC_NIRI_P0_B" and r["points"][0]["x"] == 112 and r["points"][0]["y"] == 234 for r in touches)
        recorder("Mark", "native-implicit-grab")
        send("move",x=1400,y=300); send("press"); send("move",x=100,y=300)
        send("press",button=273); send("release",button=273); send("release")
        grabbed = events("native-implicit-grab", {"MouseButtonPress","MouseButtonRelease"}); report["native_grab_events"] = grabbed
        checks["forwarded_grab_keeps_all_button_pairs"] = len(grabbed) == 4 and all(r["title"] == "CC_NIRI_P0_B" for r in grabbed)
        before_idle = json.loads(native("GetScrollMotionStatus")); time.sleep(.2)
        after_idle = json.loads(native("GetScrollMotionStatus"))
        checks["no_plugin_idle_continuation_repaint"] = all(before_idle[k] == after_idle[k] for k in ["scrollOutputRepaintRequests","scrollContinuousFullRepaintRequests"])
        native("StartScrollFrameCapture")
        plan.update(epoch=3,issuedAt=int(time.time()*1000),oldScrollOffsetX=1060,newScrollOffsetX=212)
        arm(plan)
        wait(lambda: (lambda v: v.get("epoch") == 3 and v.get("cameraX",1060) < 1050)(json.loads(native("GetPartialPaintedState"))))
        time.sleep(.04)
        plan.update(epoch=4,issuedAt=int(time.time()*1000),oldScrollOffsetX=212,newScrollOffsetX=1060)
        arm(plan)
        report["reversal_status"] = json.loads(native("GetScrollMotionStatus"))
        wait(lambda: json.loads(native("GetScrollMotionStatus")).get("completed"))
        motion_capture = json.loads(native("GetScrollFrameCapture")); report["motion_capture"] = motion_capture
        old_frames = [r for r in motion_capture["paintedFrames"] if r["epoch"] == 3]
        new_frames = [r for r in motion_capture["paintedFrames"] if r["epoch"] == 4]
        checks["real_reversal_reuses_last_painted_pose_and_nonzero_velocity"] = bool(old_frames and new_frames) and abs(new_frames[0]["initialX"]-old_frames[-1]["x"]) < 0.000001 and old_frames[-1]["v"] < 0 and abs(new_frames[0]["initialVelocity"]-old_frames[-1]["v"]) < 0.000001
        checks["reversal_strict_output_no_secondary_leak"] = capture("partial-reversal", {})
        # Keep a consumed pair while retargeting and cancelling its runtime.
        recorder("Mark", "held-pair-retarget-cancel")
        send("move",x=100,y=300); send("press")
        checks["held_pair_recorded"] = json.loads(native("GetPartialScrollCapability"))["pendingButtons"] == 1
        plan.update(epoch=5,issuedAt=int(time.time()*1000),oldScrollOffsetX=1060,newScrollOffsetX=212)
        arm(plan)
        recorder("CloseClient", "CC_NIRI_P0_A")
        time.sleep(.05)
        native("CancelScrollPlan", json.dumps(dict(sessionId=state["sessionId"],epoch=5)))
        send("release")
        checks["release_after_cancel_consumed"] = not events("held-pair-retarget-cancel", {"MouseButtonPress","MouseButtonRelease"})
        checks["cancel_releases_runtime_and_pairs"] = not json.loads(native("GetScrollMotionStatus"))["active"] and json.loads(native("GetPartialScrollCapability"))["pendingButtons"] == 0
        checks["p4_source_cancel_releases_client_facts"] = json.loads(native("GetColumnGeometrySource")) == {"valid": False}
        checks["injector_still_has_no_p0_policy"] = json.loads(fixture("Status"))["entries"] == []
        report["status"] = "PASS" if all(checks.values()) else "FAIL"
    except P4ScenarioComplete:
        report["status"] = "PASS" if all(checks.values()) else "FAIL"
    except Exception as error:
        report["error"] = repr(error)
        if scenario == "input-lifecycle" and (destination / "kwin.log").exists() and "KCrash:" in (destination / "kwin.log").read_text():
            report.update(status="FAIL", failureClass="compositor-crash")
            try:
                kwin.wait(timeout=.5)
            except subprocess.TimeoutExpired:
                pass
    finally:
        if scenario == "input-lifecycle" and "kwin" in locals():
            report["kwin_exit_code_before_cleanup"] = kwin.poll()
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=2)
        for handle in logs: handle.close()
        report["records"] = records() if (destination / "clients.log").exists() else []
        report["ended_utc"] = datetime.now(timezone.utc).isoformat()
        (destination / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(dict(status=report["status"], passed=sum(checks.values()), total=len(checks), evidence=str(destination))))
    return 0 if report["status"] == "PASS" else 1


class P4ScenarioComplete(Exception):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--isolated", action="store_true")
    mode.add_argument("--inside", action="store_true")
    parser.add_argument("--output", type=Path, default=DEST)
    parser.add_argument("--scale", type=float, choices=[1.0,1.5], default=1.0)
    parser.add_argument("--ime", action="store_true")
    parser.add_argument("--scenario",choices=["p4", "p5", "p6", "input-lifecycle"])
    args = parser.parse_args()
    return inside(args.output, args.scale, args.ime, args.scenario) if args.inside else isolated(args.output, args.scale, args.ime, args.scenario)


if __name__ == "__main__":
    sys.exit(main())
