#!/usr/bin/env python3
"""Read-only inventory or a bounded, disposable KWin virtual API fixture.

The isolated fixture never addresses the desktop bus/display, loads CC-Niri
plugins, injects input, or writes user configuration. It is NOT P0 input proof.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def command(args, timeout=5, env=None):
    try:
        result = subprocess.run(args, capture_output=True, text=True,
                                timeout=timeout, env=env, check=False)
        return {"command": args, "exit_code": result.returncode,
                "stdout": result.stdout, "stderr": result.stderr}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": args, "exit_code": None, "error": str(error)}


def digest(path):
    path = Path(path)
    try:
        return {"path": str(path), "resolved": str(path.resolve()),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    except OSError as error:
        return {"path": str(path), "status": "UNAVAILABLE", "error": str(error)}


def inventory(destination):
    destination.mkdir(parents=True, exist_ok=True)
    calls = {
        "support": ["/KWin", "org.kde.KWin.supportInformation"],
        "script": ["/Scripting", "org.kde.kwin.Scripting.isScriptLoaded", "cc-niri-maximize"],
        "motion": ["/ccNiriViewportMotion", "org.cc.NiriViewportMotion1.GetScrollMotionStatus"],
    }
    report = {"captured_utc": datetime.now(timezone.utc).isoformat(),
              "scope": "read-only; installed hashes do not prove loaded binary SHA",
              "head": command(["git", "-C", str(ROOT), "rev-parse", "HEAD"]),
              "branch": command(["git", "-C", str(ROOT), "branch", "--show-current"]),
              "status": command(["git", "-C", str(ROOT), "status", "--short"]),
              "packages": command(["rpm", "-q", "kwin", "kwin-devel", "python3-pyside6"])}
    for name, args in calls.items():
        report[name] = command(["gdbus", "call", "--session", "--dest", "org.kde.KWin",
                                "--object-path", args[0], "--method", *args[1:]])
    report["bridge_service"] = command(["systemctl", "--user", "show", "cc-niri-bridge.service",
                                        "--property=ActiveState,SubState,ExecStart"])
    home = Path.home()
    paths = [ROOT / "package/contents/code/main.js",
             home / ".local/share/kwin/scripts/cc-niri-maximize/contents/code/main.js",
             ROOT / "build/bridge/cc-niri-bridge", home / ".local/libexec/cc-niri-bridge"]
    for name in ["cc-niri-viewport-clip", "cc-niri-focus-ring"]:
        paths.extend([home / f".local/lib64/qt6/plugins/kwin/effects/plugins/{name}.so",
                      ROOT / f"build/native-{name.removeprefix('cc-niri-')}/bin/kwin/effects/plugins/{name}.so"])
    report["artifacts"] = [digest(path) for path in paths]
    (destination / "inventory.json").write_text(json.dumps(report, indent=2) + "\n")
    failures = [name for name in calls if report[name]["exit_code"] != 0]
    print(json.dumps({"inventory": str(destination / "inventory.json"),
                      "status": "INCONCLUSIVE" if failures else "PASS", "failed_queries": failures}))
    return 1 if failures else 0


def clients():
    # Called only after the runner verifies its private bus and runtime socket.
    from PySide6.QtCore import ClassInfo, QObject, QTimer, Qt, Slot
    from PySide6.QtDBus import QDBusConnection
    from PySide6.QtWidgets import QApplication, QWidget

    class Client(QWidget):
        def event(self, event):
            if event.type().name in {"Resize", "Move", "MouseButtonPress", "MouseButtonRelease"}:
                print("CC_NIRI_P0_CLIENT " + json.dumps({"title": self.windowTitle(),
                      "event": event.type().name, "width": self.width(), "height": self.height()}), flush=True)
            return super().event(event)

    @ClassInfo(**{"D-Bus Interface": "org.cc.CCNiriP0Fixture1"})
    class Recorder(QObject):
        @Slot(str, result=bool)
        def Record(self, message):
            print("CC_NIRI_P0 " + message, flush=True)
            return True

    app = QApplication([])
    recorder = Recorder()
    bus = QDBusConnection.sessionBus()
    if not bus.registerService("org.cc.CCNiriP0Fixture") or not bus.registerObject(
            "/P0", recorder, QDBusConnection.ExportAllSlots):
        raise RuntimeError("private fixture recorder registration failed")
    windows = []
    for suffix, width in [("A", 1680), ("B", 1256)]:
        window = Client()
        window.setWindowFlag(Qt.FramelessWindowHint)
        window.setWindowTitle("CC_NIRI_P0_" + suffix)
        window.resize(width, 1358)
        window.show()
        windows.append(window)
    QTimer.singleShot(7500, app.quit)
    return app.exec()


def inside(destination):
    isolated = Path(os.environ.get("CC_NIRI_P0_ISOLATED_ROOT", "/missing"))
    runtime = isolated / "runtime"
    # No desktop addressing fallback, even when readiness or a DBus call fails.
    if (not isolated.is_dir() or Path(os.environ.get("XDG_RUNTIME_DIR", "")) != runtime
            or not os.environ.get("DBUS_SESSION_BUS_ADDRESS")
            or os.environ.get("WAYLAND_DISPLAY") or os.environ.get("DISPLAY")
            or os.environ.get("XDG_CONFIG_HOME") != str(isolated / "config")):
        raise RuntimeError("isolated environment verification failed")
    bus = os.environ["DBUS_SESSION_BUS_ADDRESS"]

    def dbus(path, method, *args):
        return command(["gdbus", "call", "--address", bus, "--dest", "org.kde.KWin",
                        "--object-path", path, "--method", method, *args])

    processes = []
    report = {"scope": "virtual KWin API/geometry only; no Clip/Ring/input injection",
              "started_utc": datetime.now(timezone.utc).isoformat(), "status": "INCONCLUSIVE"}
    with (destination / "kwin.log").open("w") as log, (destination / "clients.log").open("w") as client_log:
        try:
            args = ["kwin_wayland", "--virtual", "--width", "2560", "--height", "1440",
                    "--scale", "1", "--output-count", "2", "--socket", "cc-niri-p0",
                    "--no-lockscreen", "--no-global-shortcuts", "--no-kactivities"]
            report["kwin_command"] = args
            kwin = subprocess.Popen(args, stdout=log, stderr=log)
            processes.append(kwin)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if kwin.poll() is not None:
                    raise RuntimeError(f"virtual KWin exited: {kwin.returncode}")
                if (runtime / "cc-niri-p0").exists():
                    support = dbus("/KWin", "org.kde.KWin.supportInformation")
                    if support["exit_code"] == 0:
                        report["support"] = support
                        break
                time.sleep(0.1)
            else:
                raise RuntimeError("virtual KWin readiness timed out")
            env = dict(os.environ, WAYLAND_DISPLAY="cc-niri-p0", QT_QPA_PLATFORM="wayland")
            client = subprocess.Popen([sys.executable, __file__, "--clients"], env=env,
                                      stdout=client_log, stderr=client_log)
            processes.append(client)
            time.sleep(1)
            fixture = str(ROOT / "test/fixtures/scroll-layout-v2-p0-kwin.js")
            loaded = dbus("/Scripting", "org.kde.kwin.Scripting.loadScript", fixture, "cc-niri-p0-fixture")
            report["load_fixture"] = loaded
            match = re.search(r"\((-?\d+),?\)", loaded.get("stdout", ""))
            if loaded["exit_code"] != 0 or not match or int(match[1]) < 0:
                raise RuntimeError("isolated script loading failed")
            script_id = int(match[1])
            report["run_fixture"] = dbus(f"/Scripting/Script{script_id}", "org.kde.kwin.Script.run")
            if report["run_fixture"]["exit_code"] != 0:
                raise RuntimeError("isolated script run failed")
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                if '"kind":"complete"' in (destination / "clients.log").read_text():
                    report["status"] = "COMPLETE_REQUIRES_VALIDATION"
                    break
                if kwin.poll() is not None:
                    raise RuntimeError("virtual KWin exited during fixture")
                time.sleep(0.1)
            else:
                raise RuntimeError("fixture completion not observed")
        except (OSError, RuntimeError) as error:
            report["error"] = str(error)
        finally:
            # Only subprocesses owned by this runner. Never kill a system KWin.
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
            report["owned_processes_reaped"] = all(process.poll() is not None for process in processes)
    records = []
    for line in (destination / "clients.log").read_text().splitlines():
        if "CC_NIRI_P0 {" in line:
            try:
                records.append(json.loads(line.split("CC_NIRI_P0 ", 1)[1]))
            except json.JSONDecodeError:
                pass
    report["records"] = records
    if report["status"] == "COMPLETE_REQUIRES_VALIDATION":
        checks = {}
        api = next((record for record in records if record["kind"] == "api"), {})
        areas = [record for record in records if record["kind"] == "working-area"]
        states = {record.get("phase"): record for record in records if record["kind"] == "after-request"}
        final = next((record for record in records if record["kind"] == "complete"), {})
        checks["two_virtual_outputs"] = len(api.get("screens", [])) == 2
        checks["clientArea_available"] = (api.get("clientArea") == "function" and api.get("maximizeArea") == 2
                                          and len(areas) == 2 and not any(record["kind"] == "api-error" for record in records))
        checks["no_panel_workareas_match_outputs"] = {record["output"]: record["area"] for record in areas} == {
            screen["name"]: screen["geometry"] for screen in api.get("screens", [])}
        checks["two_test_clients"] = any(record["kind"] == "clients" and record.get("count") == 2 for record in records)
        checks["safe_anchor_on_primary"] = all(states.get(phase, {}).get("output") == "Virtual-0" for phase in [1, 3])
        checks["unsafe_geometry_switches_output"] = states.get(2, {}).get("output") == "Virtual-1"
        checks["resize_converges"] = (final.get("frame") == {"x": 1304, "y": 66, "width": 1256, "height": 1358}
                                      and final.get("output") == "Virtual-0"
                                      and any(record["kind"] == "frame-changed" and record.get("frame", {}).get("width") == 1680 for record in records))
        resize_returns = {record["phase"]: record for record in records if record["kind"] == "after-resize-request"}
        checks["resize_is_asynchronous"] = (resize_returns.get(4, {}).get("frame", {}).get("width") == 1256
                                             and resize_returns.get(5, {}).get("frame", {}).get("width") == 1680)
        support = report.get("support", {}).get("stdout", "")
        checks["virtual_backend_without_project_plugins"] = "KWin::VirtualBackend" in support and "cc-niri-viewport-clip" not in support
        report["checks"] = checks
        report["status"] = "PASS_API_FIXTURE_ONLY" if all(checks.values()) else "FAIL_API_FIXTURE"
    (destination / "isolated.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"isolated": str(destination / "isolated.json"), "status": report["status"]}))
    return 0 if report["status"] == "PASS_API_FIXTURE_ONLY" else 1


def isolated(destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cc-niri-p0-") as temporary:
        base = Path(temporary)
        for name in ["runtime", "config", "data", "cache", "state"]:
            (base / name).mkdir(mode=0o700)
        # Keep the real HOME untouched; Qt/KDE state is isolated with XDG paths.
        env = {name: os.environ[name] for name in ["PATH", "LANG"] if name in os.environ}
        env.update({"CC_NIRI_P0_ISOLATED_ROOT": str(base), "XDG_RUNTIME_DIR": str(base / "runtime"),
                    "XDG_CONFIG_HOME": str(base / "config"), "XDG_DATA_HOME": str(base / "data"),
                    "XDG_CACHE_HOME": str(base / "cache"), "XDG_STATE_HOME": str(base / "state"),
                    "XDG_DATA_DIRS": "/usr/local/share:/usr/share", "QT_QPA_PLATFORM": "offscreen",
                    "KWIN_COMPOSE": "Q", "QT_LOGGING_RULES": "kwin_scripting.debug=true"})
        args = ["dbus-run-session", "--", sys.executable, __file__,
                "--inside-isolated", "--output", str(destination.resolve())]
        # Bound the entire private process group, including abnormal startup
        # and recorder failures. A timeout must not leave an orphan compositor.
        process = subprocess.Popen(args, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            stdout, stderr = process.communicate(timeout=28)
            result = {"command": args, "exit_code": process.returncode, "stdout": stdout, "stderr": stderr}
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                stdout, stderr = process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate(timeout=3)
            result = {"command": args, "exit_code": 1, "stdout": stdout, "stderr": stderr,
                      "error": "private process group exceeded 28s; terminated within cleanup budget"}
        (destination / "runner.json").write_text(json.dumps(result, indent=2) + "\n")
        print(result.get("stdout", ""), end="")
        if result["exit_code"] != 0:
            print(json.dumps({"status": "INCONCLUSIVE", "runner": str(destination / "runner.json")}))
        return result["exit_code"] or (1 if "error" in result else 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--inventory", action="store_true")
    mode.add_argument("--isolated", action="store_true")
    mode.add_argument("--inside-isolated", action="store_true", help=argparse.SUPPRESS)
    mode.add_argument("--clients", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--output", type=Path, default=ROOT / "test/scroll-layout-v2-p0-evidence/20261014")
    args = parser.parse_args()
    if args.clients:
        base = Path(os.environ.get("CC_NIRI_P0_ISOLATED_ROOT", "/missing"))
        if (not base.is_dir() or os.environ.get("XDG_RUNTIME_DIR") != str(base / "runtime")
                or os.environ.get("XDG_CONFIG_HOME") != str(base / "config")
                or os.environ.get("WAYLAND_DISPLAY") != "cc-niri-p0" or os.environ.get("DISPLAY")
                or not os.environ.get("DBUS_SESSION_BUS_ADDRESS")):
            parser.error("clients must be started by the isolated runner")
        return clients()
    if args.inside_isolated:
        return inside(args.output)
    return inventory(args.output) if args.inventory else isolated(args.output)


if __name__ == "__main__":
    sys.exit(main())
