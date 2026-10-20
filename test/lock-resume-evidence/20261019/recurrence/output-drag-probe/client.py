#!/usr/bin/env python3
"""Bounded Native paint/input experiment in a private virtual KWin only.

No installation, desktop bus/display, installed plugin, hardware input or
user window access. Native test input uses KWin's normal input redirection;
this is platform feasibility evidence, not a production implementation.
"""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "tools/scroll-layout-v2-p3-probe.py").is_file())
PLUGIN_DIR = ROOT / "build/scroll-layout-v2-p0-fixture/plugins"
PLUGIN = PLUGIN_DIR / "kwin/effects/plugins/cc-niri-p0-input-fixture.so"
RING_DIR = ROOT / "build/native-focus-ring/bin"
RING = RING_DIR / "kwin/effects/plugins/cc-niri-focus-ring.so"
DESTINATION = ROOT / "test/scroll-layout-v2-p0-evidence/20261014/native-input"


def guard(client=False):
    base = Path(os.environ.get("CC_NIRI_P0_ISOLATED_ROOT", "/missing"))
    return (str(base).startswith("/tmp/cc-niri-p0-") and base.is_dir()
            and os.environ.get("XDG_RUNTIME_DIR") == str(base / "runtime")
            and os.environ.get("XDG_CONFIG_HOME") == str(base / "config")
            and not os.environ.get("DISPLAY") and bool(os.environ.get("DBUS_SESSION_BUS_ADDRESS"))
            and os.environ.get("WAYLAND_DISPLAY", "") == ("cc-niri-p0" if client else ""))


def run(args, timeout=4):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()}")
    return result.stdout


def clients():
    if not guard(client=True):
        raise RuntimeError("test clients refuse non-isolated environment")
    from PySide6.QtCore import ClassInfo, QMimeData, QObject, Qt, QTimer, Slot
    from PySide6.QtGui import QDrag
    from PySide6.QtDBus import QDBusConnection
    from PySide6.QtWidgets import QApplication, QDialog, QLineEdit, QMenu, QWidget

    phase = "bootstrap"

    def record(value):
        print("CC_NIRI_P0_INPUT " + json.dumps(dict(phase=phase, **value)), flush=True)

    class Client(QWidget):
        def mouseMoveEvent(self, event):
            if phase == "dnd-open" and self.windowTitle().endswith("_A") and event.buttons() & Qt.LeftButton:
                drag = QDrag(self)
                mime = QMimeData(); mime.setText("isolated P0 drag")
                drag.setMimeData(mime)
                record({"kind": "drag-start"})
                action = drag.exec(Qt.CopyAction)
                record({"kind": "drag-end", "action": action.value})
            super().mouseMoveEvent(event)

        def mousePressEvent(self, event):
            if phase == "cross-output-drag" and self.windowTitle().endswith("_B") and event.button() == Qt.LeftButton:
                accepted = self.windowHandle().startSystemMove()
                record({"kind": "system-move-request", "accepted": accepted})
            if phase == "system-resize" and self.windowTitle().endswith("_D") and event.button() == Qt.LeftButton:
                accepted = self.windowHandle().startSystemResize(Qt.RightEdge | Qt.BottomEdge)
                record({"kind": "system-resize-request", "accepted": accepted})
            if phase == "popup-open" and self.windowTitle().endswith("_A") and event.button() == Qt.RightButton:
                menu = QMenu(self)
                menu.addAction("P0 native popup")
                menu.aboutToShow.connect(lambda: record({"kind": "popup-shown"}))
                menu.aboutToHide.connect(lambda: record({"kind": "popup-hidden"}))
                menu.popup(event.globalPosition().toPoint())
                self.p0_menu = menu
            super().mousePressEvent(event)

        def event(self, event):
            name = event.type().name
            if name in {"MouseButtonPress", "MouseButtonRelease", "MouseMove", "Enter", "Leave",
                        "Wheel", "TouchBegin", "TouchUpdate", "TouchEnd", "TouchCancel", "Resize"}:
                value = {"kind": "client-event", "title": self.windowTitle(), "event": name,
                         "spontaneous": event.spontaneous()}
                if hasattr(event, "position"):
                    point = event.position()
                    value.update(x=point.x(), y=point.y())
                if hasattr(event, "button"):
                    value["button"] = event.button().value
                if hasattr(event, "points"):
                    value["points"] = [{"id": point.id(), "x": point.position().x(),
                                        "y": point.position().y()} for point in event.points()]
                record(value)
            if name.startswith("Touch"):
                event.accept()
                return True
            return super().event(event)

    @ClassInfo(**{"D-Bus Interface": "org.cc.CCNiriP0Fixture1"})
    class Recorder(QObject):
        @Slot(str, result=bool)
        def Mark(self, value):
            nonlocal phase
            phase = value
            record({"kind": "mark"})
            return True

        @Slot(str, result=bool)
        def Record(self, value):
            record(json.loads(value))
            return True

        @Slot(str, int, result=bool)
        def FocusRequested(self, title, epoch):
            record({"kind": "focus-request", "title": title, "epoch": epoch})
            return True

        @Slot(result=bool)
        def OpenDialog(self):
            self.dialog = QDialog(windows[0])
            self.dialog.setWindowTitle("CC_NIRI_P0_DIALOG")
            self.dialog.setWindowModality(Qt.WindowModal)
            self.dialog.resize(400, 200)
            self.dialog.show()
            return True

        @Slot(result=bool)
        def CloseDialog(self):
            self.dialog.close()
            self.dialog.deleteLater()
            return True

        @Slot(str, result=bool)
        def CloseClient(self, name):
            for window in windows:
                if window.windowTitle() == name:
                    window.close()
                    return True
            return False

        @Slot(result=bool)
        def BeginIME(self):
            self.edit = QLineEdit(windows[0])
            self.edit.setGeometry(1500, 100, 150, 50)
            self.edit.setStyleSheet("background: white; color: black")
            self.edit.textChanged.connect(lambda text: record({"kind": "ime-text", "text": text}))
            self.edit.show()
            self.edit.setFocus()
            return True

    @ClassInfo(**{"D-Bus Interface": "org.kde.kglobalaccel.Component"})
    class ShortcutsStub(QObject):
        @Slot(str, result=bool)
        def invokeShortcut(self, _name):
            return False

    app = QApplication([])
    recorder = Recorder()
    bus = QDBusConnection.sessionBus()
    if not bus.registerService("org.cc.CCNiriP0Fixture") or not bus.registerObject(
            "/P0", recorder, QDBusConnection.ExportAllSlots):
        raise RuntimeError("private input recorder failed")
    shortcuts = ShortcutsStub()
    if bus.registerService("org.kde.kglobalaccel"):
        if not bus.registerObject("/component/kwin", shortcuts, QDBusConnection.ExportAllSlots):
            raise RuntimeError("private shortcut stub registration failed")
        record({"kind": "private-shortcut-service", "stub": True})
    else:
        # Some KWin builds already start kglobalaccel on this private bus.
        # Never fall back to the desktop bus or replace its service.
        record({"kind": "private-shortcut-service", "stub": False})
    windows = []
    for suffix, width, color in [("A", 1680, "#386ac4"), ("B", 1256, "#32a060"),
                                  ("C", 1256, "#bd4938"), ("D", 1256, "#994499")]:
        window = Client()
        if suffix != "D":
            window.setWindowFlag(Qt.FramelessWindowHint)
        window.setWindowTitle("CC_NIRI_P0_" + suffix)
        window.setAttribute(Qt.WA_AcceptTouchEvents)
        window.setMouseTracking(True)
        window.setStyleSheet(f"background-color: {color}")
        window.resize(width, 1358)
        window.showMinimized() if suffix == "D" else window.show()
        windows.append(window)
    # Private fixtures only (guard already checked); always finite and bounded.
    lifetime=int(os.environ.get("CC_NIRI_P0_CLIENT_LIFETIME_MS","26000"))
    QTimer.singleShot(max(1000,min(lifetime,40000)), app.quit)
    return app.exec()


def panel():
    if not guard(client=True) or os.environ.get("QT_WAYLAND_SHELL_INTEGRATION") != "layer-shell":
        raise RuntimeError("panel fixture refuses non-isolated environment")
    from PySide6.QtCore import ClassInfo, QObject, QTimer, Slot
    from PySide6.QtDBus import QDBusConnection
    from PySide6.QtGui import QGuiApplication
    from PySide6.QtQml import QQmlApplicationEngine
    app = QGuiApplication([])
    engine = QQmlApplicationEngine()
    primary = next(screen for screen in app.screens() if screen.name() == "Virtual-0")
    engine.rootContext().setContextProperty("p0Screen", primary)
    engine.loadData(b'''
import QtQuick
import QtQuick.Window
import org.kde.layershell 1.0 as LayerShell
Window {
    property int reserved: 50
    screen: p0Screen
    width: 2560; height: 50; visible: true; color: reserved === 0 ? "#999901" : "#999900"
    LayerShell.Window.layer: LayerShell.Window.LayerTop
    LayerShell.Window.anchors: LayerShell.Window.AnchorTop | LayerShell.Window.AnchorLeft | LayerShell.Window.AnchorRight
    LayerShell.Window.exclusionZone: reserved
    LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityNone
}
''')
    if not engine.rootObjects():
        raise RuntimeError("layer-shell panel QML failed")

    @ClassInfo(**{"D-Bus Interface": "org.cc.CCNiriP0Panel1"})
    class Controller(QObject):
        @Slot(int, result=bool)
        def SetZone(self, value):
            if value not in {0, 50}:
                return False
            return engine.rootObjects()[0].setProperty("reserved", value)

    controller = Controller()
    bus = QDBusConnection.sessionBus()
    if not bus.registerService("org.cc.CCNiriP0Panel") or not bus.registerObject(
            "/Panel", controller, QDBusConnection.ExportAllSlots):
        raise RuntimeError("private layer-shell controller registration failed")
    QTimer.singleShot(23000, app.quit)
    return app.exec()


def inside(destination, scale=1.0, ime=False):
    if not guard():
        raise RuntimeError("Native fixture refuses non-isolated environment")
    destination.mkdir(parents=True, exist_ok=True)
    base = Path(os.environ["CC_NIRI_P0_ISOLATED_ROOT"])
    bus = os.environ["DBUS_SESSION_BUS_ADDRESS"]
    report = {"started_utc": datetime.now(timezone.utc).isoformat(), "status": "INCONCLUSIVE",
              "scope": "test-only Native effect + build-tree Ring; Virtual/offscreen Mesa OpenGL; normal KWin filters -> Wayland clients",
              "scale": scale, "ime": "fcitx5" if ime else None,
              "plugin_sha256": hashlib.sha256(PLUGIN.read_bytes()).hexdigest(),
              "ring_build_sha256": hashlib.sha256(RING.read_bytes()).hexdigest(), "steps": [], "checks": {}}
    processes = []

    def call(path, method, *args, service="org.kde.KWin"):
        value = run(["gdbus", "call", "--address", bus, "--dest", service,
                     "--object-path", path, "--method", method, *args])
        if value.strip() in {"(true,)", "(false,)"}:
            return value.strip() == "(true,)"
        return ast.literal_eval(value.strip())[0] if value.strip() != "()" else None

    def records():
        values = []
        for line in (destination / "clients.log").read_text().splitlines():
            if line.startswith("CC_NIRI_P0_INPUT "):
                values.append(json.loads(line.removeprefix("CC_NIRI_P0_INPUT ")))
        return values

    def mark(phase):
        call("/P0", "org.cc.CCNiriP0Fixture1.Mark", phase, service="org.cc.CCNiriP0Fixture")

    def workareas(label):
        script = base / (label + ".js")
        script.write_text('''
const outputs = Array.from(workspace.screens);
if (outputs.length !== 2 || outputs.some(o => !/^Virtual-[01]$/.test(o.name))) throw new Error("not isolated");
const areas = outputs.map(o => {
    const d = typeof workspace.currentDesktopForScreen === "function" ? workspace.currentDesktopForScreen(o) : workspace.currentDesktop;
    const r = workspace.clientArea(KWin.MaximizeArea, o, d);
    return {output: o.name, x: r.x, y: r.y, width: r.width, height: r.height};
});
callDBus("org.cc.CCNiriP0Fixture", "/P0", "org.cc.CCNiriP0Fixture1", "Record",
    JSON.stringify({kind: "workareas", label: "LABEL", areas: areas}), function() {});
'''.replace("LABEL", label))
        script_id = call("/Scripting", "org.kde.kwin.Scripting.loadScript", str(script), label)
        call(f"/Scripting/Script{script_id}", "org.kde.kwin.Script.run")
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            value = next((r for r in records() if r.get("kind") == "workareas" and r["label"] == label), None)
            if value:
                return value["areas"]
            time.sleep(0.025)
        raise RuntimeError("panel WorkingArea evidence missing")

    def native(method, *args):
        return call("/ccNiriP0Input", "org.cc.CCNiriP0Input1." + method, *args)

    def maximize(maximized):
        label = "maximized" if maximized else "unmaximized"
        mark(label)
        script = base / (label + ".js")
        script.write_text('''
const outputs = Array.from(workspace.screens);
if (outputs.length !== 2 || outputs.some(o => !/^Virtual-[01]$/.test(o.name))) throw new Error("not isolated");
const w = workspace.windowList().find(w => w.caption === "CC_NIRI_P0_A");
w.setMaximize(MAXIMIZED, MAXIMIZED);
const timer = new QTimer(); timer.interval = 25; let attempts = 0;
timer.timeout.connect(() => {
    attempts++;
    const r = w.frameGeometry;
    const ready = Number(w.maximizeMode) === MODE && (MODE === 0 || (r.x === 0 && r.y === 0 && r.width === 2560 && r.height === 1440));
    if (ready || attempts > 60) {
        timer.stop();
        callDBus("org.cc.CCNiriP0Fixture", "/P0", "org.cc.CCNiriP0Fixture1", "Record",
            JSON.stringify({kind: "maximize-result", label: "LABEL", ready: ready, mode: Number(w.maximizeMode),
                output: w.output.name, rect: {x: r.x, y: r.y, width: r.width, height: r.height}}), function() {});
    }
}); timer.start();
'''.replace("MAXIMIZED", "true" if maximized else "false").replace("MODE", "3" if maximized else "0").replace("LABEL", label))
        script_id = call("/Scripting", "org.kde.kwin.Scripting.loadScript", str(script), label)
        call(f"/Scripting/Script{script_id}", "org.kde.kwin.Script.run")
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            result = next((r for r in records() if r.get("kind") == "maximize-result" and r["label"] == label), None)
            if result:
                report.setdefault("maximize_results", []).append(result)
                return result["ready"] and result["output"] == "Virtual-0"
            time.sleep(0.025)
        raise RuntimeError("native maximize geometry evidence missing")

    def capture(name, samples):
        from PySide6.QtGui import QImage
        if not native("Capture", name):
            raise RuntimeError("fixture capture request rejected")
        paths = [base / "screens" / f"{name}-Virtual-{index}.png" for index in [0, 1]]
        deadline = time.monotonic() + 2
        def complete():
            return all(path.exists() and not QImage(str(path)).isNull() for path in paths)
        while time.monotonic() < deadline and not complete():
            time.sleep(0.025)
        if not complete():
            raise RuntimeError("virtual framebuffer capture incomplete")
        observations = []
        for path in paths:
            shutil.copy2(path, destination / path.name)
            image = QImage(str(path))
            if image.isNull() or image.width() != int(2560 * scale) or image.height() != int(1440 * scale):
                raise RuntimeError("unexpected virtual capture dimensions")
            output = int(path.stem[-1])
            for x, y, expected in samples.get(output, []):
                actual = image.pixelColor(round(x * scale), round(y * scale)).name()
                observations.append({"output": output, "x": x, "y": y, "expected": expected, "actual": actual})
            if output == 1:
                rgb = image.convertToFormat(QImage.Format_RGB888)
                observations.append({"output": output, "scope": "entire-secondary-framebuffer",
                                     "expected": "#000000", "actual": "#000000" if not any(bytes(rgb.constBits())) else "NONBLACK"})
        report.setdefault("captures", []).append({"name": name, "samples": observations})
        return all((value["actual"] != "#000000" if value["expected"] == "nonblack"
                    else value["actual"] == value["expected"]) for value in observations)

    epoch = 0
    script_ids = []

    def prepare(phase, entries, mode="two-click", focus="A", reset=True):
        nonlocal epoch
        mark(phase)
        if reset and not native("Reset"):
            raise RuntimeError("fixture Reset rejected outstanding input")
        epoch += 1
        specs = [{"title": "CC_NIRI_P0_" + name, "x": real_x, "width": width,
                  "visualX": visual_x} for name, real_x, width, visual_x in entries]
        # Only the test JS controller mutates geometry/activation; the Native
        # fixture consumes settled rectangles and publishes focus intent.
        source = r"""
const outputs = Array.from(workspace.screens);
if (outputs.length !== 2 || outputs.some(o => !/^Virtual-[01]$/.test(o.name))) throw new Error("not isolated");
const specs = SPEC;
workspace.windowList().filter(w => /^CC_NIRI_P0_[ABCD]$/.test(w.caption)).forEach(w => {
    const spec = specs.find(s => s.title === w.caption);
    w.minimized = !spec;
    if (spec) w.frameGeometry = {x: spec.x, y: 66, width: spec.width, height: 1358};
});
workspace.activeWindow = workspace.windowList().find(w => w.caption === "CC_NIRI_P0_FOCUS");
const timer = new QTimer(); timer.interval = 25; let attempts = 0;
timer.timeout.connect(() => {
    attempts++;
    const ready = specs.every(s => {
        const w = workspace.windowList().find(w => w.caption === s.title);
        return w && w.frameGeometry.x === s.x && w.frameGeometry.y === 66 && w.frameGeometry.width === s.width && w.frameGeometry.height === 1358;
    });
    if (ready || attempts > 60) {
        timer.stop();
        callDBus("org.cc.CCNiriP0Fixture", "/P0", "org.cc.CCNiriP0Fixture1", "Record",
            JSON.stringify({kind: "prepared", ready: ready, epoch: EPOCH,
                workspaceId: workspace.currentDesktop.id,
                uuids: specs.map(s => {
                    const w = workspace.windowList().find(w => w.caption === s.title);
                    return String(w.internalId).toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
                })}), function() {});
    }
}); timer.start();
""".replace("SPEC", json.dumps(specs)).replace("FOCUS", focus).replace("EPOCH", str(epoch))
        script = base / f"prepare-{epoch}.js"
        script.write_text(source)
        script_id = call("/Scripting", "org.kde.kwin.Scripting.loadScript", str(script), f"cc-niri-p0-input-{epoch}")
        if script_id < 0:
            raise RuntimeError("test JS preparation script failed to load")
        script_ids.append(script_id)
        call(f"/Scripting/Script{script_id}", "org.kde.kwin.Script.run")
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            prepared = next((r for r in records() if r.get("kind") == "prepared" and r.get("epoch") == epoch), None)
            if prepared:
                if not prepared["ready"]:
                    raise RuntimeError("client resize did not converge before Native configure")
                break
            time.sleep(0.025)
        else:
            raise RuntimeError("preparation evidence missing")
        payload = {"epoch": epoch, "mode": mode,
                   "entries": [{"title": spec["title"], "visualX": spec["visualX"]} for spec in specs]}
        if not native("Configure", json.dumps(payload)):
            raise RuntimeError("Native fixture Configure rejected settled test geometry")
        time.sleep(0.08)
        report["steps"].append({"phase": phase, "configuration": payload,
                                "binding": prepared, "status": json.loads(native("Status"))})

    def event(kind, **values):
        if not native("Input", json.dumps(dict(epoch=epoch, kind=kind, **values))):
            raise RuntimeError(f"Native test input rejected: {kind}")
        time.sleep(0.04)

    def click(x, y=300):
        event("move", x=x, y=y)
        event("press")
        event("release")

    def events(phase, kinds=None):
        return [record for record in records() if record.get("kind") == "client-event"
                and record["phase"] == phase and (not kinds or record["event"] in kinds)]

    checks = report["checks"]
    buttons = {"MouseButtonPress", "MouseButtonRelease"}
    right = [("A", 440, 1680, 440), ("B", 1304, 1256, 2136)]
    left = [("A", 440, 1680, 440), ("B", 0, 1256, -832)]
    both = left + [("C", 1304, 1256, 2136)]
    with (destination / "kwin.log").open("w") as log, (destination / "clients.log").open("w") as client_log:
        try:
            args = ["kwin_wayland", "--virtual", "--width", "2560", "--height", "1440", "--scale", str(scale),
                    "--output-count", "2", "--socket", "cc-niri-p0", "--no-lockscreen",
                    "--no-global-shortcuts", "--no-kactivities"]
            if ime:
                args.extend(["--inputmethod", "/usr/bin/fcitx5 -D --disable=cloudpinyin,clipboard,notifications --ui=classic"])
            kwin = subprocess.Popen(args, stdout=log, stderr=log)
            processes.append(kwin)
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline and kwin.poll() is None:
                if (base / "runtime/cc-niri-p0").exists():
                    try:
                        report["support"] = call("/KWin", "org.kde.KWin.supportInformation")
                        break
                    except (RuntimeError, subprocess.TimeoutExpired):
                        pass
                time.sleep(0.1)
            else:
                raise RuntimeError("virtual compositor readiness failed")
            if "KWin::VirtualBackend" not in report["support"]:
                raise RuntimeError("private compositor is not Virtual")
            if "Mesa" not in report["support"] or "Compositing Type: OpenGL" not in report["support"]:
                raise RuntimeError("private compositor did not use Mesa OpenGL")
            report["effect_supported"] = call("/Effects", "org.kde.kwin.Effects.isEffectSupported", "cc-niri-p0-input-fixture")
            if not call("/Effects", "org.kde.kwin.Effects.loadEffect", "cc-niri-p0-input-fixture"):
                raise RuntimeError("test-only Native effect refused loading")
            if not native("SetVirtualScale", str(scale)):
                raise RuntimeError("private Virtual scale configuration rejected")
            report["support_after_scale"] = call("/KWin", "org.kde.KWin.supportInformation")
            if report["support_after_scale"].count("2560x1440") != 2:
                raise RuntimeError("Virtual logical output sizes differ from fixture assumptions")
            client_env = dict(os.environ, WAYLAND_DISPLAY="cc-niri-p0", QT_QPA_PLATFORM="wayland", WAYLAND_DEBUG="client")
            if ime:
                client_env["QT_IM_MODULE"] = "fcitx"
            client = subprocess.Popen([sys.executable, __file__, "--clients"], env=client_env,
                                      stdout=client_log, stderr=client_log)
            processes.append(client)
            time.sleep(0.7)

            panel_env = dict(client_env, QT_WAYLAND_SHELL_INTEGRATION="layer-shell", QSG_RHI_BACKEND="software")
            with (destination / "panel.log").open("w") as panel_log:
                panel_process = subprocess.Popen([sys.executable, __file__, "--panel"], env=panel_env,
                                                 stdout=panel_log, stderr=panel_log)
                processes.append(panel_process)
                time.sleep(0.5)
                reserved = workareas("panel-reserved")
                report["panel_reserved_workareas"] = reserved
                checks["panel_exclusive_zone_respected"] = any(a["output"] == "Virtual-0" and a["y"] == 50 and a["height"] == 1390 for a in reserved)
                checks["panel_does_not_change_secondary_workarea"] = any(a["output"] == "Virtual-1" and a["y"] == 0 and a["height"] == 1440 for a in reserved)
                call("/Panel", "org.cc.CCNiriP0Panel1.SetZone", "0", service="org.cc.CCNiriP0Panel")
                for attempt in range(5):
                    time.sleep(0.1)
                    unreserved = workareas(f"panel-unreserved-{attempt}")
                    if all(a["y"] == 0 and a["height"] == 1440 for a in unreserved):
                        break
                report["panel_unreserved_workareas"] = unreserved
                checks["zero_exclusive_zone_restores_workarea"] = all(a["y"] == 0 and a["height"] == 1440 for a in unreserved)
                panel_process.terminate()
                panel_process.wait(timeout=2)

            prepare("raw-right", right, mode="raw", focus="B")
            checks["raw_native_projection_and_output_clip_pixels"] = capture("raw-right", {
                0: [(1000, 300, "#386ac4"), (2200, 300, "#32a060"), (2559, 300, "#32a060")],
                1: [(0, 300, "#000000"), (100, 300, "#000000")]})
            click(2200)
            raw = events("raw-right", buttons)
            checks["raw_local_coordinate_error_reproduced"] = len(raw) == 2 and all(r["title"].endswith("_B") and r.get("x") == 896 for r in raw)
            prepare("raw-overlap", right, mode="raw", focus="B")
            click(1500)
            overlap = events("raw-overlap", buttons)
            checks["raw_wrong_background_hit_reproduced"] = len(overlap) == 2 and all(r["title"].endswith("_B") for r in overlap)

            prepare("seat-map", right, mode="seat-map", focus="B")
            # Leave/re-enter through normal hit testing to inspect wl_pointer.enter,
            # not merely the subsequent corrected motion/button coordinates.
            event("move", x=3000, y=300)
            event("move", x=2200, y=300)
            event("move", x=2201, y=300)
            event("press")
            event("release")
            mapped = events("seat-map", buttons)
            report["seat_map_button_coordinates_correct_after_extra_motion"] = len(mapped) == 2 and all(r.get("x") == 65 for r in mapped)
            report["seat_map_enter_events"] = events("seat-map", {"Enter"})

            prepare("fallback-right", right)
            checks["masked_partial_still_paints_without_secondary_leak"] = capture("fallback-right", {
                0: [(1000, 300, "#386ac4"), (2200, 300, "#32a060"), (2559, 300, "#32a060")],
                1: [(0, 300, "#000000"), (100, 300, "#000000")]})
            event("move", x=2200, y=300)
            event("axis")
            event("press")
            event("release")
            checks["right_partial_no_client_button_or_wheel"] = not events("fallback-right", buttons | {"Wheel"})
            checks["right_partial_focus_intent"] = any(r.get("kind") == "focus-request" and r["phase"] == "fallback-right" and r["title"].endswith("_B") for r in records())
            mark("fallback-overlap")
            click(1500)
            aligned = events("fallback-overlap", buttons)
            checks["covered_foreground_receives_correct_native_coordinates"] = len(aligned) == 2 and all(r["title"].endswith("_A") and r.get("x") == 1060 for r in aligned)

            mark("popup-open")
            event("move", x=1000, y=300)
            event("press", button=273)
            event("release", button=273)
            time.sleep(0.1)
            checks["native_popup_created_with_real_button_serial"] = any(r.get("kind") == "popup-shown" and r["phase"] == "popup-open" for r in records())
            mark("popup-outside")
            click(2200)
            time.sleep(0.1)
            checks["popup_grab_outside_click_not_converted_to_column_focus"] = not any(r.get("kind") == "focus-request" and r["phase"] == "popup-outside" for r in records())
            checks["native_popup_dismissed_by_native_chain"] = any(r.get("kind") == "popup-hidden" and r["phase"] == "popup-outside" for r in records())

            mark("dnd-open")
            event("move", x=1000, y=300)
            event("press")
            event("move", x=1040, y=300)
            time.sleep(0.1)
            checks["real_wayland_drag_grab_started"] = json.loads(native("Status"))["nativeDrag"]
            mark("dnd-cross-partial")
            event("move", x=2200, y=300)
            event("release")
            time.sleep(0.1)
            checks["native_drag_not_converted_to_partial_focus"] = not any(r.get("kind") == "focus-request" and r["phase"] == "dnd-cross-partial" for r in records())
            checks["native_drag_grab_released"] = not json.loads(native("Status"))["nativeDrag"] and any(r.get("kind") == "drag-end" for r in records())

            call("/P0", "org.cc.CCNiriP0Fixture1.OpenDialog", service="org.cc.CCNiriP0Fixture")
            time.sleep(0.1)
            mark("modal-outside")
            checks["native_modal_active"] = json.loads(native("Status"))["activeModal"]
            click(2200)
            checks["modal_outside_click_preserves_native_focus_authority"] = not any(r.get("kind") == "focus-request" and r["phase"] == "modal-outside" for r in records())
            call("/P0", "org.cc.CCNiriP0Fixture1.CloseDialog", service="org.cc.CCNiriP0Fixture")

            prepare("fallback-left", left)
            click(100)
            checks["left_partial_consumed"] = not events("fallback-left", buttons)
            checks["left_partial_focus_intent"] = any(r.get("kind") == "focus-request" and r["phase"] == "fallback-left" and r["title"].endswith("_B") for r in records())

            prepare("fallback-both", both)
            checks["both_partial_native_clip_pixels"] = capture("fallback-both", {
                0: [(0, 300, "#32a060"), (420, 300, "#32a060"), (444, 300, "#386ac4"), (2200, 300, "#bd4938")],
                1: [(0, 300, "#000000"), (100, 300, "#000000")]})
            click(100)
            click(2200)
            checks["both_partial_consumed"] = not events("fallback-both", buttons)
            checks["both_partial_correct_intents"] = {r["title"] for r in records() if r.get("kind") == "focus-request" and r["phase"] == "fallback-both"} == {"CC_NIRI_P0_B", "CC_NIRI_P0_C"}
            mark("hover-cross-columns")
            for x in [2700, 2200, 1500, 1501, 1500, 100, 1500]:
                event("move", x=x, y=300)
            hover = events("hover-cross-columns", {"Enter", "MouseMove"})
            checks["cross_column_hover_never_enters_masked_neighbor"] = (bool(hover)
                and all(r["title"].endswith("_A") for r in hover)
                and any(r["event"] == "MouseMove" and r.get("x") == 1060 for r in hover))
            mark("screen-edges")
            click(0)
            click(2559)
            click(2560)
            checks["output_edge_clicks_consume_only_primary_partials"] = (not events("screen-edges", buttons)
                and [r["title"] for r in records() if r.get("kind") == "focus-request" and r["phase"] == "screen-edges"]
                == ["CC_NIRI_P0_B", "CC_NIRI_P0_C"])
            mark("secondary")
            click(2700)
            checks["secondary_no_primary_client_buttons"] = not events("secondary", buttons)

            prepare("touch-partial", right)
            event("touch-down", id=0, x=2200, y=300)
            event("touch-move", id=0, x=2220, y=320)
            event("touch-up", id=0)
            checks["partial_touch_sequence_consumed"] = not events("touch-partial", {"TouchBegin", "TouchUpdate", "TouchEnd"} | buttons)
            checks["partial_touch_focus_intent"] = any(r.get("kind") == "focus-request" and r["phase"] == "touch-partial" for r in records())

            prepare("press-before-focus", right)
            event("move", x=2200, y=300)
            event("press")
            # Geometry/epoch changes while a consumed press is outstanding.
            prepare("release-after-focus", [("B", 652, 1256, 652)], focus="B", reset=False)
            event("release")
            checks["release_consumed_across_epoch_and_geometry_change"] = not events("release-after-focus", buttons)
            mark("second-click")
            click(700)
            second = events("second-click", buttons)
            checks["second_click_correct_native_pair"] = len(second) == 2 and all(r["title"].endswith("_B") and r.get("x") == 48 and r["spontaneous"] for r in second)
            stale = {"epoch": epoch - 1, "mode": "raw", "entries": [{"title": "CC_NIRI_P0_B", "visualX": 1000}]}
            checks["stale_epoch_rejected"] = native("Configure", json.dumps(stale)) is False
            report["final_status_before_reset"] = json.loads(native("Status"))
            checks["input_sequences_drained"] = (report["final_status_before_reset"]["pendingButtons"] == 0
                                                   and report["final_status_before_reset"]["pendingTouches"] == 0
                                                   and report["final_status_before_reset"]["nativeButtons"] == 0)
            checks["reset_releases_masks_and_entries"] = native("Reset") and json.loads(native("Status"))["masked"] == 0

            prepare("before-maximize", right)
            if not native("Reset"):
                raise RuntimeError("input protection did not drain before native maximize")
            checks["native_maximize_remains_on_primary"] = maximize(True)
            checks["native_unmaximize_remains_on_primary"] = maximize(False)
            prepare("after-maximize-partial", right)
            click(2200)
            checks["return_from_maximize_restores_safe_partial_input"] = (not events("after-maximize-partial", buttons)
                and any(r.get("kind") == "focus-request" and r["phase"] == "after-maximize-partial" and r["title"].endswith("_B") for r in records())
                and all(e["output"] == "Virtual-0" for e in json.loads(native("Status"))["entries"]))

            if ime:
                prepare("ime-candidate", right)
                call("/P0", "org.cc.CCNiriP0Fixture1.BeginIME", service="org.cc.CCNiriP0Fixture")
                time.sleep(0.15)
                run(["fcitx5-remote", "--check", "-s", "pinyin"])
                run(["fcitx5-remote", "--check", "-o"])
                for code in [49, 23, 35, 30, 24]:
                    event("key", code=code, pressed=True)
                    event("key", code=code, pressed=False)
                time.sleep(0.25)
                report["ime_candidate_status"] = json.loads(native("Status"))
                # Fcitx's Qt/DBus frontend uses an xdg popup; KWin need not
                # classify that candidate window as InputPanel/InputMethod.
                candidates = [w for w in report["ime_candidate_status"]["auxiliary"] if w["width"] > 0]
                checks["fcitx5_candidate_window_observed"] = bool(candidates)
                capture("ime-candidate", {1: [(0, 300, "#000000")]})
                if candidates:
                    candidate = candidates[0]
                    mark("ime-selection")
                    # Exercise the part overlapping the projected neighbor.
                    event("move", x=max(2148, candidate["x"] + 20), y=candidate["y"] + min(15, candidate["height"] / 2))
                    report["ime_before_press"] = json.loads(native("Status"))
                    event("press")
                    event("release")
                    report["ime_after_click"] = json.loads(native("Status"))
                    time.sleep(0.15)
                    checks["fcitx5_candidate_click_not_column_focus"] = not any(r.get("kind") == "focus-request" and r["phase"] == "ime-selection" for r in records())
                    checks["fcitx5_click_changes_candidate_composition"] = (report["ime_before_press"]["auxiliary"]
                                                                            != report["ime_after_click"]["auxiliary"])
                    # A candidate covering the neighbor may select only the
                    # first syllable; Return commits the remaining composition.
                    event("key", code=28, pressed=True)
                    event("key", code=28, pressed=False)
                    checks["fcitx5_candidate_commits_text"] = any(r.get("kind") == "ime-text" and any(ord(c) > 127 for c in r["text"]) for r in records())
                event("key", code=1, pressed=True)
                event("key", code=1, pressed=False)
                run(["fcitx5-remote", "--check", "-c"])

            prepare("titlebar-partial", [("D", 1304, 1256, 2136)], focus="D")
            click(2200, y=85)
            checks["partial_titlebar_only_requests_focus"] = (not events("titlebar-partial", buttons)
                and not json.loads(native("Status"))["entries"][0]["interactiveMove"]
                and any(r.get("kind") == "focus-request" and r["phase"] == "titlebar-partial" for r in records()))
            prepare("titlebar-visible", [("D", 652, 1256, 652)], focus="D")
            event("move", x=750, y=85)
            event("press")
            event("move", x=790, y=95)
            checks["visible_titlebar_uses_native_interactive_move"] = json.loads(native("Status"))["entries"][0]["interactiveMove"]
            event("release")
            checks["native_titlebar_move_releases_grab"] = (not json.loads(native("Status"))["entries"][0]["interactiveMove"]
                                                            and json.loads(native("Status"))["nativeButtons"] == 0)
            mark("system-resize")
            event("move", x=1000, y=300)
            event("press")
            event("move", x=1020, y=320)
            checks["native_interactive_resize_started"] = json.loads(native("Status"))["entries"][0]["interactiveResize"]
            event("release")
            checks["native_interactive_resize_releases_grab"] = (not json.loads(native("Status"))["entries"][0]["interactiveResize"]
                                                                 and json.loads(native("Status"))["nativeButtons"] == 0)

            prepare("close-during-press", [("A", 440, 1680, 440), ("C", 1304, 1256, 2136)])
            event("move", x=2200, y=300)
            event("press")
            call("/P0", "org.cc.CCNiriP0Fixture1.CloseClient", "CC_NIRI_P0_C", service="org.cc.CCNiriP0Fixture")
            time.sleep(0.1)
            event("release")
            drained = json.loads(native("Status"))
            checks["window_close_consumes_outstanding_release"] = (not events("close-during-press", buttons)
                and drained["pendingButtons"] == 0 and drained["nativeButtons"] == 0 and native("Reset"))

            # Load the existing build-tree Ring only in this private KWin. The
            # real desktop/installed artifact is never addressed or replaced.
            if not call("/Effects", "org.kde.kwin.Effects.loadEffect", "cc-niri-focus-ring"):
                raise RuntimeError("build-tree Native Ring failed to load in private compositor")
            prepare("ring-projection", [("A", 440, 1680, 2136)], mode="raw", focus="A")
            binding = report["steps"][-1]["binding"]
            eligibility = {"protocol": 1, "type": "focus-ring-eligibility", "sessionId": "p0-isolated-ring",
                           "generation": 1, "enabled": True, "targetOutput": "Virtual-0",
                           "workspaceId": binding["workspaceId"], "windows": binding["uuids"]}
            checks["real_ring_eligibility_accepted"] = call("/ccNiriFocusRing", "org.cc.NiriFocusRing1.PublishEligibility", json.dumps(eligibility))
            time.sleep(0.3)
            report["ring_status"] = json.loads(call("/ccNiriFocusRing", "org.cc.NiriFocusRing1.GetFocusRingStatus"))
            checks["real_ring_draws_using_shared_paint_frames"] = (report["ring_status"]["drawCount"] > 0
                                                                     and report["ring_status"]["sharedFrameSamples"] > 0
                                                                     and report["ring_status"]["coreBackend"] == "Rust")
            checks["real_ring_follows_projection_and_stays_on_primary"] = capture("ring-projection", {
                0: [(438, 300, "#000000"), (2135, 300, "nonblack")],
                1: [(0, 300, "#000000"), (100, 300, "#000000")]})
            prepare("ring-masked", [("A", 440, 1680, 2136)], mode="two-click", focus="A")
            time.sleep(0.2)
            report["masked_ring_status"] = json.loads(call("/ccNiriFocusRing", "org.cc.NiriFocusRing1.GetFocusRingStatus"))
            checks["input_mask_and_real_ring_can_coexist"] = (report["masked_ring_status"]["active"]
                and report["masked_ring_status"]["windowUuid"] == binding["uuids"][0]
                and capture("ring-masked", {0: [(2135, 300, "nonblack")],
                                            1: [(0, 300, "#000000")]}))
            call("/Effects", "org.kde.kwin.Effects.unloadEffect", "cc-niri-focus-ring")
            checks["private_ring_unloaded"] = call("/Effects", "org.kde.kwin.Effects.isEffectLoaded", "cc-niri-focus-ring") is False
            prepare("unload-masked", right)
            checks["unload_exercises_live_input_mask"] = json.loads(native("Status"))["masked"] == 1
            call("/Effects", "org.kde.kwin.Effects.unloadEffect", "cc-niri-p0-input-fixture")
            time.sleep(0.1)
            unloaded = next((r for r in records() if r.get("kind") == "native-fixture-unloaded"), {})
            checks["effect_unload_releases_input_masks_and_entries"] = (unloaded.get("masked") == 0
                                                                                  and unloaded.get("hiddenTestWindows") == 0
                                                                                  and unloaded.get("entries") == 0)
            report["status"] = "PASS_BASIC_TWO_CLICK_FIXTURE_ONLY" if all(checks.values()) else "FAIL_BASIC_INPUT_FIXTURE"
        except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError) as error:
            report["error"] = str(error)
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
            report["owned_processes_reaped"] = all(process.poll() is not None for process in processes)
    report["records"] = records()
    (destination / "input-results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": report["status"], "passed": sum(bool(v) for v in checks.values()),
                      "total": len(checks), "evidence": str(destination / "input-results.json")}))
    return 0 if report["status"] == "PASS_BASIC_TWO_CLICK_FIXTURE_ONLY" else 1


def isolated(destination, scale=1.0, ime=False):
    if not PLUGIN.is_file() or not RING.is_file():
        raise RuntimeError("build the P0 Native fixture and Ring first; no fallback to installed plugins")
    if any(file.stat().st_mtime_ns > PLUGIN.stat().st_mtime_ns
           for file in (ROOT / "test/fixtures/native-p0").iterdir() if file.is_file()):
        raise RuntimeError("P0 fixture artifact is older than its sources; rebuild before probing")
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cc-niri-p0-") as temporary:
        base = Path(temporary)
        for directory in ["config", "data", "cache", "state", "runtime"]:
            (base / directory).mkdir(mode=0o700)
        if ime:
            profile = base / "config/fcitx5/profile"
            profile.parent.mkdir()
            profile.write_text("[Groups/0]\nName=Default\nDefault Layout=us\nDefaultIM=pinyin\n\n"
                               "[Groups/0/Items/0]\nName=keyboard-us\nLayout=\n\n"
                               "[Groups/0/Items/1]\nName=pinyin\nLayout=\n\n[GroupOrder]\n0=Default\n")
        env = {key: os.environ[key] for key in ["PATH", "LANG"] if key in os.environ}
        if ime and "HOME" in os.environ:
            # Preserve the real HOME (never repurpose it). Fcitx requires it;
            # all writable config/data/cache/state/runtime paths remain XDG-isolated.
            env["HOME"] = os.environ["HOME"]
        env.update({"CC_NIRI_P0_ISOLATED_ROOT": str(base), "XDG_RUNTIME_DIR": str(base / "runtime"),
                    "XDG_CONFIG_HOME": str(base / "config"), "XDG_DATA_HOME": str(base / "data"),
                    "XDG_CACHE_HOME": str(base / "cache"), "XDG_STATE_HOME": str(base / "state"),
                    "XDG_DATA_DIRS": "/usr/local/share:/usr/share", "QT_QPA_PLATFORM": "offscreen",
                    "KWIN_COMPOSE": "O2",
                    "__EGL_VENDOR_LIBRARY_FILENAMES": "/usr/share/glvnd/egl_vendor.d/50_mesa.json",
                    "QT_PLUGIN_PATH": str(PLUGIN_DIR) + ":" + str(RING_DIR), "QT_FORCE_STDERR_LOGGING": "1",
                    "QT_LOGGING_RULES": "kwin_effects.debug=true"})
        args = ["dbus-run-session", "--", sys.executable, __file__, "--inside", "--output", str(destination.resolve()), "--scale", str(scale)]
        if ime:
            args.append("--ime")
        process = subprocess.Popen(args, env=env, start_new_session=True, text=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            stdout, stderr = process.communicate(timeout=28)
            exit_code = process.returncode
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                stdout, stderr = process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate(timeout=3)
            exit_code = 1
        (destination / "runner.json").write_text(json.dumps({"command": args, "exit_code": exit_code,
                                                            "stdout": stdout, "stderr": stderr}, indent=2) + "\n")
        print(stdout, end="")
        if exit_code:
            print(json.dumps({"status": "INCONCLUSIVE_OR_FAILED", "runner": str(destination / "runner.json")}))
        return exit_code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--isolated", action="store_true")
    mode.add_argument("--inside", action="store_true", help=argparse.SUPPRESS)
    mode.add_argument("--clients", action="store_true", help=argparse.SUPPRESS)
    mode.add_argument("--panel", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--output", type=Path, default=DESTINATION)
    parser.add_argument("--scale", type=float, choices=[1.0, 1.5], default=1.0)
    parser.add_argument("--ime", action="store_true", help="also test isolated Fcitx5/Pinyin candidate input")
    args = parser.parse_args()
    return panel() if args.panel else clients() if args.clients else inside(args.output, args.scale, args.ime) if args.inside else isolated(args.output, args.scale, args.ime)


if __name__ == "__main__":
    sys.exit(main())
