"""Isolated D-Bus test: mock KWin only, never the real desktop."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

if len(sys.argv) > 1 and sys.argv[1] == "--mock":
    import dbus
    import dbus.service
    import dbus.mainloop.glib
    from gi.repository import GLib
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    class KWin(dbus.service.Object):
        count = 5
        rows = 2
        @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="ss", out_signature="v")
        def Get(self, interface, property):
            assert interface == "org.kde.KWin.VirtualDesktopManager"
            return dbus.UInt32(getattr(self, str(property)), variant_level=1)
        @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="ssv", out_signature="")
        def Set(self, interface, property, value):
            assert interface == "org.kde.KWin.VirtualDesktopManager" and property == "rows"
            assert isinstance(value, dbus.UInt32), "rows must be unsigned inside a D-Bus variant"
            self.rows = int(value)
    bus = dbus.SessionBus()
    name = dbus.service.BusName("org.kde.KWin", bus)
    kwin = KWin(bus, "/VirtualDesktopManager")
    GLib.MainLoop().run()
    sys.exit()

binary = str(Path(sys.argv[1]).resolve())
def call(dest, path, method, *args):
    return subprocess.check_output(["gdbus", "call", "--session", "--dest", dest,
        "--object-path", path, "--method", method, *args], text=True, stderr=subprocess.DEVNULL).strip()
def ensure(count):
    return call("org.cc.CCNiriBridge", "/CCNiriBridge", "org.cc.CCNiriBridge1.EnsureVerticalDesktopLayout", str(count))
def rows():
    return call("org.kde.KWin", "/VirtualDesktopManager", "org.freedesktop.DBus.Properties.Get",
        "org.kde.KWin.VirtualDesktopManager", "rows")
with tempfile.TemporaryDirectory(prefix="cc-niri-layout-") as directory:
    bridge = subprocess.Popen([binary], env=dict(os.environ, XDG_STATE_HOME=directory),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    mock = None
    try:
        for _ in range(100):
            try:
                call("org.cc.CCNiriBridge", "/CCNiriBridge", "org.cc.CCNiriBridge1.GetState")
                break
            except subprocess.CalledProcessError:
                time.sleep(.02)
        assert ensure(0) == "(false,)"
        assert ensure(5) == "(false,)", "absent KWin must fail without changing Bridge state"
        mock = subprocess.Popen([sys.executable, __file__, "--mock"])
        for _ in range(100):
            try:
                assert "uint32 2" in rows()
                break
            except subprocess.CalledProcessError:
                time.sleep(.02)
        assert ensure(4) == "(false,)", "stale queued count cannot change current grid"
        assert "uint32 2" in rows()
        assert ensure(5) == "(true,)"
        assert "uint32 5" in rows()
        assert ensure(5) == "(true,)", "already vertical is idempotent"
        assert call("org.cc.CCNiriBridge", "/CCNiriBridge", "org.cc.CCNiriBridge1.GetState") == "('',)"
        print("PASS isolated DBus vertical desktop rows, unsigned variant, stale count, idempotence and unavailable KWin")
    finally:
        if mock:
            mock.terminate(); mock.wait(timeout=5)
        bridge.terminate(); bridge.wait(timeout=5)
